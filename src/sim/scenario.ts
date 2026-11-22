import { poisson, rand01, TAG } from "./rng";
import { JOB_KIND_LIST, JOB_KINDS, TUNING, type Step } from "./params";
import type { Dept, Job, Staff, World } from "./types";
import { payroll } from "./org";

/** 架空の名前(実在の人物と結びつかない組み合わせを自動で作る) */
const FAMILY = ["青木", "石川", "上野", "江口", "小野", "梶原", "北村", "久保", "河野", "斎藤", "園田", "高梨", "辻本", "永井", "野村", "浜田", "平野", "福島", "松岡", "三浦", "村上", "森下", "八木", "山口", "和田"];
const GIVEN = ["あおい", "いつき", "うみ", "えま", "かい", "さく", "しおん", "すず", "そら", "ちひろ", "なぎ", "のぞみ", "はると", "ひなた", "まこと", "みお", "ゆう", "りく", "れん", "わかな"];

function makeName(seed: number, index: number): string {
  const f = FAMILY[index % FAMILY.length]!;
  const g = GIVEN[Math.floor(rand01(seed, TAG.name, index) * GIVEN.length)]!;
  return `${f} ${g}`;
}

/** 専門能力のならび(平均が3)。部署ごとにずらして使う */
const PRIMARY_SKILL_PATTERN = [3, 2, 4, 3, 3, 2, 4, 3];
const MANAGE_PATTERN = [3, 2, 3, 4, 3, 2, 4, 3];

/** 主な分野以外の専門能力(仮の値)。能力2は能率0.67なので、人を動かす意味はあるが、損もある */
const OTHER_FIELD_SKILL = 2;

interface DeptPlan {
  name: string;
  field: Step;
  count: number;
}

/** 最初の会社(仕様書 4章):社長+職員25人(部署長3人を含む)、部署は3つ */
const PLAN: DeptPlan[] = [
  { name: "営業部", field: "estimate", count: 6 },
  { name: "制作部", field: "produce", count: 14 },
  { name: "検査部", field: "inspect", count: 5 },
];

export function createInitialWorld(seed = 1): World {
  const depts: Dept[] = [];
  const staff: Staff[] = [];
  let staffId = 1;

  PLAN.forEach((plan, di) => {
    const deptId = di + 1;
    let headId: number | null = null;
    for (let i = 0; i < plan.count; i++) {
      const skills: Record<Step, number> = {
        estimate: OTHER_FIELD_SKILL,
        produce: OTHER_FIELD_SKILL,
        inspect: OTHER_FIELD_SKILL,
      };
      skills[plan.field] = PRIMARY_SKILL_PATTERN[(i + di * 3) % PRIMARY_SKILL_PATTERN.length]!;
      const isHeadOfDept = i === 0;
      staff.push({
        id: staffId,
        name: makeName(seed, staffId - 1),
        deptId,
        skills,
        // 最初の部署長は管理能力3にそろえる(式の確認をしやすくするため)
        manage: isHeadOfDept ? 3 : MANAGE_PATTERN[(i + di) % MANAGE_PATTERN.length]!,
        rampUntil: 0,
      });
      if (isHeadOfDept) headId = staffId;
      staffId++;
    }
    depts.push({ id: deptId, name: plan.name, parentId: null, headId });
  });

  const w: World = {
    seed,
    day: 0,
    staff,
    depts,
    presidentManage: TUNING.presidentManage,
    arrivalScale: 1,
    stepOwner: { estimate: 1, produce: 2, inspect: 3 },
    // 最初は、全工程の承認が社長に集まる(部署長の上の上司=社長)
    approval: { estimate: "above", produce: "above", inspect: "above" },
    jobs: [],
    finished: [],
    nextJobId: 1,
    nextStaffId: staffId,
    nextDeptId: PLAN.length + 1,
    payrollCap: 0,
    records: [],
  };
  w.payrollCap = payroll(w) * TUNING.payrollCapRatio;
  addHandover(w);
  return w;
}

/** 引き継ぎ時の期限内完了率の目安(仕様書 4章「約60%」)。過去30日の記録をこの割合で作る */
export const HANDOVER_ON_TIME = 0.6;

function emptyDays() {
  return { work: 0, queue: 0, approval: 0, handoff: 0, rework: 0 };
}

/**
 * 会社を引き継いだ時点の状態を作る:過去の業務の記録と、いまたまっている業務。
 * 過去30日に期限をむかえた業務は、約60%が期限内(=引き継ぎ時の完了率)。
 * 期限がこれからの業務は、半分が途中(たまっている)、半分は期限内に完了済み。
 * 日付が負の数の業務は「引き継ぐ前」に発生したもの。
 */
function addHandover(w: World): void {
  const maxLimit = Math.max(...JOB_KIND_LIST.map((k) => JOB_KINDS[k].limitDays));
  JOB_KIND_LIST.forEach((kind, ki) => {
    const spec = JOB_KINDS[kind];
    for (let a = -(maxLimit + TUNING.windowDays); a <= 0; a++) {
      const deadline = a + spec.limitDays;
      if (deadline < -(TUNING.windowDays - 1)) continue; // 数えない期間の業務は作らない
      const n = poisson(spec.ratePerDay, w.seed, TAG.history, a, ki);
      for (let i = 0; i < n; i++) {
        const r = (k: number) => rand01(w.seed, TAG.history, a, ki, i, k);
        const base: Job = {
          id: w.nextJobId++,
          kind,
          arrivedDay: a,
          deadlineDay: deadline,
          stepIdx: spec.route.length - 1,
          remaining: 0,
          availableOn: 1,
          assignee: null,
          phase: "done",
          pendingFlaw: false,
          flaws: [],
          redo: null,
          reworking: false,
          attempt: 0,
          doneDay: null,
          days: emptyDays(),
          workedToday: false,
          returns: 0,
          caught: 0,
        };
        if (deadline <= 0) {
          const onTime = r(1) < HANDOVER_ON_TIME;
          base.doneDay = onTime
            ? Math.max(a, deadline - Math.floor(r(2) * 3))
            : Math.min(0, deadline + 1 + Math.floor(r(2) * 4));
          w.finished.push(base);
        } else if (r(1) < 0.5) {
          const idx = Math.floor(r(2) * spec.route.length);
          base.phase = "queued";
          base.stepIdx = idx;
          base.remaining = spec.route[idx]!.work * (0.3 + 0.7 * r(3));
          w.jobs.push(base);
        } else {
          base.doneDay = Math.max(a, Math.min(0, deadline - 1 - Math.floor(r(2) * 3)));
          w.finished.push(base);
        }
      }
    }
  });
}
