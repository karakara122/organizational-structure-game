import { TUNING } from "./params";
import type { World } from "./types";

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
