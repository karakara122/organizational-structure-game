// 自動で遊ぶ(ボット)。ゲームの数字を測るための道具で、ゲーム本体には入らない。
// 標準の設定は STANDARD_PROFILE の1つだけ。新しい設定を足すときは、ここと bot.test.ts にも登録する。
import {
  assignStaff,
  createDept,
  flowCompare,
  flowRising,
  isWithin,
  setApproval,
  setHead,
  stepDay,
  STEPS,
  SURGES,
  TUNING,
  type ApprovalChoice,
  type World,
} from "../sim";

export interface Bot {
  name: string;
  /** 毎日、1日の計算の前に呼ばれる。操作はここで行う */
  act(w: World): void;
}

/** 標準の設定(測るときは、いつもこれを使う) */
export const STANDARD_PROFILE = {
  seeds: [1, 2, 3, 4, 5],
  days: TUNING.scenarioDays,
  /** 「人を動かす」ボットが行動する間隔(日) */
  moverEveryDays: 5,
} as const;

/**
 * 検証用のシード(2026-11-23)。数字は標準のシード5つで調整し、ここでは確かめるだけにする(5つに合わせ込んでいないかを見る)。
 * 標準のシードより難しく、見本の直し方の放置は成功が2/20ほど。
 */
export const CHECK_SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => 101 + i);

export function playScenario(w: World, bot: Bot, days: number = STANDARD_PROFILE.days): void {
  for (let i = 0; i < days; i++) {
    bot.act(w);
    stepDay(w);
  }
}

/** 何もしない */
export const idleBot: Bot = { name: "何もしない", act() {} };

/** 待ちの多い部署へ、待ちの少ない部署から職員を1人ずつ動かす */
export const moverBot: Bot = {
  name: "待ちの多い部署へ人を動かす",
  act(w) {
    if (w.day === 0 || w.day % STANDARD_PROFILE.moverEveryDays !== 0) return;
    const last = w.records[w.records.length - 1];
    if (!last) return;
    // 工程の担当部署ごとの、職員1人あたりの待ち
    const owners = [...new Set(STEPS.map((s) => w.stepOwner[s]))];
    const load = owners.map((id) => {
      const workers = w.staff.filter(
        (s) => isWithin(w, s.deptId, id) && !w.depts.some((d) => d.headId === s.id),
      ).length;
      return { id, perWorker: (last.queueByDept[id] ?? 0) / Math.max(1, workers), workers };
    });
    load.sort((a, b) => b.perWorker - a.perWorker);
    const busiest = load[0]!;
    const calmest = load[load.length - 1]!;
    if (busiest.id === calmest.id || busiest.perWorker < 1 || calmest.workers <= 2) return;
    if (busiest.perWorker < calmest.perWorker * 2) return;
    const mover = w.staff.find(
      (s) => s.deptId === calmest.id && !w.depts.some((d) => d.headId === s.id),
    );
    if (mover) assignStaff(w, mover.id, busiest.id);
  },
};

/** 工程ごとの承認を設定する */
export function setApprovals(w: World, a: ApprovalChoice, b: ApprovalChoice, c: ApprovalChoice): void {
  setApproval(w, "estimate", a);
  setApproval(w, "produce", b);
  setApproval(w, "inspect", c);
}

/** 制作部の下に部署を1つ作り、職員6人(うち1人が部署長)を移す */
export function splitProduction(w: World, size = 6): void {
  const prod = w.depts.find((d) => d.id === w.stepOwner.produce)!;
  const members = w.staff.filter((s) => s.deptId === prod.id && s.id !== prod.headId).slice(0, size);
  const made = createDept(w, "制作B", prod.id);
  if (!made.ok || made.id === undefined) return;
  for (const m of members) assignStaff(w, m.id, made.id);
  if (members[0]) setHead(w, made.id, members[0].id);
}

/** 「うまく直す」見本:見積は承認なし、制作は社長が承認、検査は部署長が承認。制作部を2つに分ける */
export const solverBot: Bot = {
  name: "見本の直し方",
  act(w) {
    if (w.day !== 0) return;
    setApprovals(w, "none", "above", "head");
    splitProduction(w);
  },
};

/**
 * 「見本の直し+繁忙期に対応」:見本の直し方のあと、繁忙期の始まりに、営業部の制作が得意な職員2人を制作部へ動かし、
 * 繁忙期が終わったら営業部へ戻す。繁忙期は params.ts の SURGES から読む(ボットは、繁忙期を知っている前提)。
 */
export const reactBot: Bot = (() => {
  const moved: number[] = [];
  return {
    name: "見本の直し+繁忙期に対応",
    act(w) {
      const surge = SURGES[0];
      if (w.day === 0) {
        setApprovals(w, "none", "above", "head");
        splitProduction(w);
        moved.length = 0;
      }
      if (!surge) return;
      const sales = w.stepOwner.estimate;
      if (w.day === surge.fromDay - 1) {
        const pick = w.staff
          .filter((s) => s.deptId === sales && !w.depts.some((d) => d.headId === s.id))
          .sort((a, b) => b.skills.produce - a.skills.produce)
          .slice(0, 2);
        for (const s of pick) {
          moved.push(s.id);
          assignStaff(w, s.id, w.stepOwner.produce);
        }
      }
      if (w.day === surge.toDay) for (const id of moved) assignStaff(w, id, sales);
    },
  };
})();

/**
 * 見本の直しのあと、**繁忙期の日付を知らずに**、画面に出る手がかり(直近の発生が増えた表示)だけで動く。
 * 表示が出たら営業部の制作が得意な2人を制作部へ動かし、10日たって発生が前の期間以下に戻ったら営業部へ戻す。
 * 「日付を知って対応」との差が、気づく難しさ(気づくのが遅れた分)を表す。
 */
export const observerBot: Bot = (() => {
  const moved: number[] = [];
  let movedDay = -1;
  return {
    name: "見本の直し+画面の手がかりだけで対応",
    act(w) {
      if (w.day === 0) {
        setApprovals(w, "none", "above", "head");
        splitProduction(w);
        moved.length = 0;
        movedDay = -1;
      }
      const sales = w.stepOwner.estimate;
      if (movedDay < 0 && flowRising(w)) {
        movedDay = w.day;
        const pick = w.staff
          .filter((s) => s.deptId === sales && !w.depts.some((d) => d.headId === s.id))
          .sort((a, b) => b.skills.produce - a.skills.produce)
          .slice(0, 2);
        for (const s of pick) {
          moved.push(s.id);
          assignStaff(w, s.id, w.stepOwner.produce);
        }
      }
      if (moved.length > 0 && w.day - movedDay >= 10) {
        const f = flowCompare(w);
        if (f.recent <= f.before) {
          for (const id of moved) assignStaff(w, id, sales);
          moved.length = 0;
        }
      }
    },
  };
})();

/** 抜け道を探す:極端な形を、最初の1回だけ試す。各項目は、1つの操作だけを変えたもの */
export interface LoopholePlan {
  name: string;
  apply(w: World): void;
}

export const LOOPHOLE_PLANS: LoopholePlan[] = [
  { name: "承認を全部なしにする", apply: (w) => setApprovals(w, "none", "none", "none") },
  { name: "承認を全部、部署長にする", apply: (w) => setApprovals(w, "head", "head", "head") },
  {
    name: "制作部の下に部署を作って分ける(承認はそのまま)",
    apply: (w) => splitProduction(w),
  },
  {
    name: "営業部の職員3人を制作部へ動かす",
    apply: (w) => {
      const sales = w.staff.filter((s) => s.deptId === 1 && !w.depts.some((d) => d.headId === s.id));
      for (const m of sales.slice(0, 3)) assignStaff(w, m.id, w.stepOwner.produce);
    },
  },
  {
    name: "部署長を全員、空席にする",
    apply: (w) => {
      for (const d of w.depts) setHead(w, d.id, null);
    },
  },
  {
    name: "部署を上限まで増やして、全部に部署長を置く",
    apply: (w) => {
      while (w.depts.length < TUNING.maxDepts) {
        const made = createDept(w, "追加", null);
        if (!made.ok || made.id === undefined) break;
        const s = w.staff.find((x) => !w.depts.some((d) => d.headId === x.id));
        if (!s) break;
        assignStaff(w, s.id, made.id);
        setHead(w, made.id, s.id);
      }
    },
  },
];

export const loopholeBots: Bot[] = LOOPHOLE_PLANS.map((p) => ({
  name: p.name,
  act(w) {
    if (w.day === 0) p.apply(w);
  },
}));

/** 「止まった」を探す:完了が15日続けて0なのに、業務がたまっている日。理由つきで返す */
export function detectStuck(w: World): { day: number; reason: string } | null {
  let run = 0;
  for (const r of w.records) {
    run = r.completed === 0 && r.open > 0 ? run + 1 : 0;
    if (run >= 15) {
      return {
        day: r.day,
        reason: `完了が15日続けて0。承認待ち ${r.approvalWaiting}件、たまった業務 ${r.open}件`,
      };
    }
  }
  return null;
}
