import { TUNING } from "./params";
import type { Job, World } from "./types";

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
