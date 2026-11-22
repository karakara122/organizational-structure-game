// プレイ記録を、チャットに貼れる文字にする(仕様書 8章)。計算はしない。
import { JOB_KINDS, STEPS, STEP_LABEL, TUNING, causeSummary, finalOnTimeRate, getStaff, isScenarioOver, payroll, verdict } from "../sim";
import type { World } from "../sim";
import type { LogEntry } from "./save";

const APPROVAL = { none: "承認なし", head: "部署長", above: "その上の上司" } as const;
const pct = (r: number | null): string => (r === null ? "なし" : `${Math.round(r * 100)}%`);

export function formatLog(w: World, log: LogEntry[]): string {
  const out: string[] = [];
  const rate = w.records.length ? w.records[w.records.length - 1]!.onTimeRate : null;
  out.push("# 組織構造ゲーム プレイ記録");
  out.push(`シード ${w.seed} / ${w.day}日目 / 期限内完了率 ${pct(rate)} / 人件費 ${payroll(w).toFixed(1)}(上限 ${w.payrollCap.toFixed(1)})`);
  if (isScenarioOver(w)) {
    const v = { success: "成功", close: "惜しい", fail: "失敗" }[verdict(w, payroll(w))];
    out.push(`結果: ${v}(最後の30日間の期限内完了率 ${pct(finalOnTimeRate(w))})`);
  }

  out.push("", "## 今の組織");
  const walk = (parent: number | null, depth: number): void => {
    for (const d of w.depts.filter((x) => x.parentId === parent)) {
      const members = w.staff.filter((s) => s.deptId === d.id);
      const head = d.headId === null ? "空席" : getStaff(w, d.headId).name;
      const owns = STEPS.filter((s) => w.stepOwner[s] === d.id).map((s) => STEP_LABEL[s]);
      out.push(`${"  ".repeat(depth)}- ${d.name}: ${members.length}人 / 部署長 ${head}${owns.length ? ` / 担当 ${owns.join("・")}` : ""}`);
      walk(d.id, depth + 1);
    }
  };
  out.push("社長");
  walk(null, 1);
  out.push(`承認: ${STEPS.map((s) => `${STEP_LABEL[s]}=${APPROVAL[w.approval[s]]}`).join(" / ")}`);

  const c = causeSummary(w);
  out.push("", `## 遅れの原因(直近${TUNING.windowDays}日に期限をむかえて遅れた業務 ${c.count}件の、かかった日数の合計)`);
  out.push(`作業 ${c.days.work} / 順番待ち ${c.days.queue} / 承認待ち ${c.days.approval} / 受け渡し ${c.days.handoff} / やり直し ${c.days.rework}`);

  out.push("", "## 操作と速度の記録");
  if (log.length === 0) out.push("(まだありません)");
  for (const e of log) out.push(`${e.day}日目 [${e.kind}] ${e.text}`);

  out.push("", "## 日ごとの数字");
  out.push("日,発生,完了,未完了,承認待ち,期限内完了率,人件費");
  for (const r of w.records) {
    out.push(`${r.day},${r.arrived},${r.completed},${r.open},${r.approvalWaiting},${pct(r.onTimeRate)},${r.payroll.toFixed(1)}`);
  }
  out.push("", `(業務の種類: ${Object.values(JOB_KINDS).map((k) => k.label).join("・")})`);
  return out.join("\n");
}
