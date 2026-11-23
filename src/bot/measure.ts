import { createInitialWorld, delayBreakdown, onTimeRate, payroll, verdict, type World } from "../sim";
import { detectStuck, playScenario, STANDARD_PROFILE, type Bot } from "./bots";

export interface Measured {
  bot: string;
  /** 90日目の期限内完了率(シードごと) */
  rates: number[];
  mean: number;
  min: number;
  max: number;
  verdicts: Record<"success" | "close" | "fail", number>;
  payroll: number;
  /** 遅れの内訳(日数の合計)のうち、承認待ちが占める割合 */
  approvalShare: number;
  stuck: string | null;
}

/** 標準の設定(シード5つ・90日)で、ボットを測る。seeds を渡すと、そのシードで測る(検証用は CHECK_SEEDS) */
export function measureBot(bot: Bot, seeds: readonly number[] = STANDARD_PROFILE.seeds): Measured {
  const rates: number[] = [];
  const verdicts = { success: 0, close: 0, fail: 0 };
  let approvalShare = 0;
  let payrollNow = 0;
  let stuck: string | null = null;
  for (const seed of seeds) {
    const w: World = createInitialWorld(seed);
    playScenario(w, bot);
    const r = w.records[w.records.length - 1]!.onTimeRate ?? 0;
    rates.push(r);
    payrollNow = payroll(w);
    verdicts[verdict(w, payrollNow)]++;
    const d = delayBreakdown(w);
    const total = d.work + d.queue + d.approval + d.handoff + d.rework;
    approvalShare += total === 0 ? 0 : d.approval / total;
    stuck ??= detectStuck(w)?.reason ?? null;
  }
  const n = rates.length;
  return {
    bot: bot.name,
    rates,
    mean: rates.reduce((a, b) => a + b, 0) / n,
    min: Math.min(...rates),
    max: Math.max(...rates),
    verdicts,
    payroll: payrollNow,
    approvalShare: approvalShare / n,
    stuck,
  };
}

/** 引き継ぎ時の期限内完了率(シードごとの平均) */
export function startRate(): number {
  const seeds = STANDARD_PROFILE.seeds;
  return seeds.reduce((a, s) => a + (onTimeRate(createInitialWorld(s)) ?? 0), 0) / seeds.length;
}
