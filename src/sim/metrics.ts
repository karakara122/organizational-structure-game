import { FLOW_HINT, JOB_KINDS, STEPS, TUNING, type Step } from "./params";
import { approvalReserve } from "./step";
import type { Job, World } from "./types";
import {
  getDept,
  getStaff,
  headOrAbove,
  isWithin,
  manageTimeNeeded,
  presidentSubordinateCount,
  subordinateCount,
} from "./org";

/** シナリオの結果(仕様書 4章):最後の30日に期限をむかえた業務の期限内完了率 */
export function finalOnTimeRate(w: World): number | null {
  const last = w.records[w.records.length - 1];
  return last ? last.onTimeRate : null;
}

export type Verdict = "success" | "close" | "fail";

/** 成功/惜しい/失敗の境目(仮の値。仕様書 4章) */
export const VERDICT_LINES = { success: 0.8, close: 0.65 } as const;

export function verdict(w: World, payrollNow: number): Verdict {
  const rate = finalOnTimeRate(w);
  if (rate === null || payrollNow > w.payrollCap + 1e-9) return "fail";
  if (rate >= VERDICT_LINES.success) return "success";
  if (rate >= VERDICT_LINES.close) return "close";
  return "fail";
}

/** 90日の終わりか */
export function isScenarioOver(w: World): boolean {
  return w.day >= TUNING.scenarioDays;
}

/** 遅れた業務の内訳の合計(日数)。原因の表示・ボットの測定に使う */
export function delayBreakdown(w: World): Record<"work" | "queue" | "approval" | "handoff" | "rework", number> {
  const sum = { work: 0, queue: 0, approval: 0, handoff: 0, rework: 0 };
  for (const j of [...w.jobs, ...w.finished]) {
    sum.work += j.days.work;
    sum.queue += j.days.queue;
    sum.approval += j.days.approval;
    sum.handoff += j.days.handoff;
    sum.rework += j.days.rework;
  }
  return sum;
}

/** 遅れた業務(期限内完了率の対象のうち、期限に間に合わなかったもの)。遅れの大きい順 */
export function lateJobs(w: World, day: number = w.day): Job[] {
  const from = day - TUNING.windowDays + 1;
  const late: Job[] = [];
  for (const j of [...w.jobs, ...w.finished]) {
    if (j.deadlineDay < from || j.deadlineDay > day) continue;
    if (j.doneDay !== null && j.doneDay <= j.deadlineDay) continue;
    late.push(j);
  }
  return late.sort((a, b) => lateDays(b, day) - lateDays(a, day));
}

/** 何日遅れたか(まだ終わっていなければ、今日までの遅れ) */
export function lateDays(j: Job, day: number): number {
  return (j.doneDay ?? day) - j.deadlineDay;
}

/** 遅れた業務の、かかった日数の内訳の合計(仕様書 5章「原因の表示」) */
export function causeSummary(w: World, day: number = w.day): { count: number; days: Record<"work" | "queue" | "approval" | "handoff" | "rework", number> } {
  const days = { work: 0, queue: 0, approval: 0, handoff: 0, rework: 0 };
  const jobs = lateJobs(w, day);
  for (const j of jobs) {
    days.work += j.days.work;
    days.queue += j.days.queue;
    days.approval += j.days.approval;
    days.handoff += j.days.handoff;
    days.rework += j.days.rework;
  }
  return { count: jobs.length, days };
}

// ---- 画面に事実を見せるための数字(計算には使わない。仕様書 5章) ----

/** 部署長が管理できる部下の目安の人数(管理に使える時間 1.0 ÷ 部下1人あたりの管理時間) */
export function manageCapacity(manage: number): number {
  return Math.floor(
    (TUNING.timePerDay * manage) / (TUNING.manageTimePerSubordinate * TUNING.normalSkill) + 1e-9,
  );
}

/** 部署長の部下の数と、管理できる目安の人数。部署長が空席なら null */
export function manageLoad(w: World, deptId: number): { subordinates: number; capacity: number } | null {
  const d = getDept(w, deptId);
  if (d.headId === null) return null;
  return { subordinates: subordinateCount(w, deptId), capacity: manageCapacity(getStaff(w, d.headId).manage) };
}

/**
 * 部署長が、承認に先に使う時間と、管理に必要な時間。承認のせいで管理に使える時間が足りなくなっているとき squeezed が true。
 * 部署長が空席なら null
 */
export function approvalSqueeze(
  w: World,
  deptId: number,
): { waiting: number; reserve: number; need: number; squeezed: boolean } | null {
  const d = getDept(w, deptId);
  if (d.headId === null) return null;
  const need = manageTimeNeeded(subordinateCount(w, deptId), getStaff(w, d.headId).manage);
  const reserve = approvalReserve(w, String(d.headId));
  // 管理だけで手一杯のとき(need > 1)は、「管理の目安超え」の表示があるので、ここでは数えない
  const squeezed = need <= TUNING.timePerDay && reserve > TUNING.timePerDay - need + 1e-9;
  return { waiting: Math.round(reserve / TUNING.approvalTime), reserve, need, squeezed };
}

/** その部署の職員が、作業できる工程があるか(工程の担当部署の下にいるか) */
export function canWork(w: World, deptId: number): boolean {
  return STEPS.some((st) => isWithin(w, deptId, w.stepOwner[st]));
}

/** 工程の承認:承認者の名前、承認者が1日に処理できる件数の目安、承認待ちの件数。承認なしなら null */
export function approvalLoad(
  w: World,
  step: Step,
): { who: string; perDay: number; waiting: number } | null {
  const mode = w.approval[step];
  if (mode === "none") return null;
  const owner = getDept(w, w.stepOwner[step]);
  const a = headOrAbove(w, mode === "head" ? owner.id : owner.parentId);
  const need =
    a.kind === "president"
      ? manageTimeNeeded(presidentSubordinateCount(w), w.presidentManage)
      : manageTimeNeeded(subordinateCount(w, headDeptOf(w, a.staff.id)), a.staff.manage);
  const perDay = Math.max(0, Math.floor((TUNING.timePerDay - need) / TUNING.approvalTime + 1e-9));
  const waiting = w.jobs.filter(
    (j) =>
      j.phase === "approval" &&
      JOB_KINDS[j.kind].route[Math.min(j.stepIdx, JOB_KINDS[j.kind].route.length - 1)]!.step === step,
  ).length;
  return { who: a.kind === "president" ? "社長" : a.staff.name, perDay, waiting };
}

function headDeptOf(w: World, staffId: number): number {
  return w.depts.find((d) => d.headId === staffId)!.id;
}

/** その部署(の担当する工程)の待ちを、職員が何日で片づけるかの目安 = 残りの作業量 ÷ 作業する職員の人数 */
export function queueDays(w: World, jobs: Job[], ownerDeptId: number): number {
  const workers = w.staff.filter(
    (s) => isWithin(w, s.deptId, ownerDeptId) && !w.depts.some((d) => d.headId === s.id),
  ).length;
  const work = jobs.reduce((a, j) => a + j.remaining, 0);
  return workers === 0 ? Infinity : work / workers;
}

/** 直近 days 日の、業務の発生・完了の件数 */
export function recentFlow(w: World, days = 7): { arrived: number; completed: number } {
  const rs = w.records.slice(-days);
  return { arrived: rs.reduce((a, r) => a + r.arrived, 0), completed: rs.reduce((a, r) => a + r.completed, 0) };
}

/** 直近 days 日と、その前の days 日の、業務の発生の件数(画面の「発生が増えた」の手がかり用。長さは FLOW_HINT.days) */
export function flowCompare(w: World, days: number = FLOW_HINT.days): { recent: number; before: number; enough: boolean } {
  const n = w.records.length;
  const sum = (a: number, b: number): number => w.records.slice(a, b).reduce((x, r) => x + r.arrived, 0);
  return { recent: sum(Math.max(0, n - days), n), before: sum(Math.max(0, n - 2 * days), Math.max(0, n - days)), enough: n >= 2 * days };
}

/** 発生が増えた手がかりを出すか(直近の発生が、前の同じ長さの期間の FLOW_HINT.ratio 倍以上) */
export function flowRising(w: World): boolean {
  const f = flowCompare(w);
  return f.enough && f.before > 0 && f.recent >= f.before * FLOW_HINT.ratio;
}

/** 部署の待ちの、直近 days 日での増減(記録が足りないとき・新しい部署は 0) */
export function queueChange(w: World, deptId: number, days = 3): number {
  const n = w.records.length;
  if (n <= days) return 0;
  const now = w.records[n - 1]!.queueByDept[deptId];
  const then = w.records[n - 1 - days]!.queueByDept[deptId];
  return now === undefined || then === undefined ? 0 : now - then;
}
