import { rand01, TAG } from "./rng";
import { TUNING, type Step } from "./params";
import type { Dept, Staff, World } from "./types";
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
      const skills: Record<Step, number> = { estimate: 1, produce: 1, inspect: 1 };
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
  return w;
}
