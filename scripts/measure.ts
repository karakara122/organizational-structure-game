// 測定の表を出す:npm run measure
import { idleBot, loopholeBots, moverBot, solverBot, STANDARD_PROFILE } from "../src/bot/bots";
import { measureBot, startRate } from "../src/bot/measure";
import { JOB_KINDS, TUNING } from "../src/sim";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const rows = [idleBot, moverBot, solverBot, ...loopholeBots].map(measureBot);

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
