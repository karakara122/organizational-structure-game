// 「何もしなかった場合」:同じシードで、最初の組織のまま90日進めた記録。画面で、自分の組織との比較に使う(計算には使わない)。
// 乱数は引数から決まる(src/sim/rng.ts)ので、業務の発生は組織に関係なく同じ。比較は公平になる。
import { createInitialWorld } from "./scenario";
import { stepDay } from "./step";
import { TUNING } from "./params";

export interface Baseline {
  /** 日ごとの期限内完了率(records と同じ並び。day=1 の記録が index 0)。まだ対象の業務が無い日は null */
  rates: (number | null)[];
  /** 90日目の期限内完了率(最後の30日に期限をむかえた業務) */
  final: number | null;
}

const cache = new Map<number, Baseline>();

export function baselineFor(seed: number): Baseline {
  const hit = cache.get(seed);
  if (hit) return hit;
  const w = createInitialWorld(seed);
  for (let i = 0; i < TUNING.scenarioDays; i++) stepDay(w);
  const rates = w.records.map((r) => r.onTimeRate);
  const b: Baseline = { rates, final: rates.length ? rates[rates.length - 1]! : null };
  cache.set(seed, b);
  return b;
}
