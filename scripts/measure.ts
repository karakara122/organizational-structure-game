// 測定の表を出す:npm run measure
import { CHECK_SEEDS, idleBot, loopholeBots, moverBot, observerBot, reactBot, solverBot, STANDARD_PROFILE } from "../src/bot/bots";
import { measureBot, startRate } from "../src/bot/measure";
import { JOB_KINDS, SURGES, TUNING } from "../src/sim";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const rows = [idleBot, moverBot, solverBot, reactBot, observerBot, ...loopholeBots].map((b) => measureBot(b));

console.log(`# 測定結果\n`);
console.log(`標準の設定:シード ${STANDARD_PROFILE.seeds.join("・")}、${STANDARD_PROFILE.days}日。数字は90日目の期限内完了率(最後の30日に期限をむかえた業務)。\n`);
console.log(`引き継ぎ時の期限内完了率(平均):${pct(startRate())}\n`);
console.log("| 操作 | 平均 | 最低〜最高 | 成功/惜しい/失敗 | 承認待ちの割合 | 止まった |");
console.log("|---|---|---|---|---|---|");
for (const m of rows) {
  console.log(
    `| ${m.bot} | ${pct(m.mean)} | ${pct(m.min)}〜${pct(m.max)} | ${m.verdicts.success}/${m.verdicts.close}/${m.verdicts.fail} | ${pct(m.approvalShare)} | ${m.stuck ?? "-"} |`,
  );
}
console.log(`\n業務の発生(件/日):${Object.values(JOB_KINDS).map((k) => `${k.label} ${k.ratePerDay}`).join("、")}`);
console.log(`ミスの確率 = ${TUNING.mistakeBase} − 専門能力×${TUNING.mistakePerSkill}、承認1件 ${TUNING.approvalTime}人日、管理 ${TUNING.manageTimePerSubordinate}人日/部下、管理の効きの下限 ${TUNING.manageEffectFloor}、部署長の給与 ${TUNING.salaryHead}`);

console.log(`繁忙期:${SURGES.map((s) => `${JOB_KINDS[s.kind].label} ${s.fromDay}〜${s.toDay}日目に ${s.multiplier}倍`).join("、")}`);

console.log(`\n検証用のシード(${CHECK_SEEDS.length}個:${CHECK_SEEDS[0]}〜${CHECK_SEEDS[CHECK_SEEDS.length - 1]})。調整には使わず、標準のシードに合わせ込んでいないかを見る。\n`);
console.log("| 操作 | 平均 | 最低〜最高 | 成功/惜しい/失敗 |");
console.log("|---|---|---|---|");
for (const b of [idleBot, solverBot, reactBot, observerBot]) {
  const m = measureBot(b, CHECK_SEEDS);
  console.log(`| ${m.bot} | ${pct(m.mean)} | ${pct(m.min)}〜${pct(m.max)} | ${m.verdicts.success}/${m.verdicts.close}/${m.verdicts.fail} |`);
}
