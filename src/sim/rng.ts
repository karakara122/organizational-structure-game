// 運(乱数)。同じ引数からは必ず同じ値が出る(固定シード)。
// 順番に引く方式にしないので、プレイヤーの操作が違っても、同じ業務の同じ工程のミスは同じ運になる。

/** 引数から 0以上1未満 の値を作る(32ビットの混ぜ合わせ) */
export function rand01(...nums: number[]): number {
  let h = 0x811c9dc5;
  for (const n of nums) {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 平均 lambda のポアソン分布(1日の業務の発生件数に使う) */
export function poisson(lambda: number, seed: number, ...tag: number[]): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  for (;;) {
    k++;
    p *= rand01(seed, ...tag, k);
    if (p <= limit) return k - 1;
  }
}

/** 乱数の使い道の印(ぶつからないように番号を分ける) */
export const TAG = {
  arrival: 1,
  mistake: 2,
  approvalFind: 3,
  name: 4,
  history: 5,
} as const;
