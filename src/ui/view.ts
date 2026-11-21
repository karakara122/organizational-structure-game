// 画面の表示だけを作る部分。計算はしない(計算は src/sim/)。
// 用語は docs/仕様書.md 6-2 の表の言葉だけを使う。
import {
  JOB_KINDS,
  STEP_LABEL,
  STEPS,
  TUNING,
  finalOnTimeRate,
  getStaff,
  isScenarioOver,
  onTimeRate,
  payroll,
  verdict,
} from "../sim";
import type { Dept, Job, Step, World } from "../sim";

export type Speed = "pause" | "normal" | "fast";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const pct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** 粒を最大この数まで描く。超えた分は「+◯」と書く */
const MAX_DOTS = 40;

function stepOf(j: Job): Step {
  const route = JOB_KINDS[j.kind].route;
  return route[Math.min(j.stepIdx, route.length - 1)].step;
}

/** 部署ごとの、作業の順番待ちの業務(承認待ちは別に数える) */
function queuesByDept(w: World): { queue: Record<number, Job[]>; approval: number } {
  const queue: Record<number, Job[]> = {};
  let approval = 0;
  for (const j of w.jobs) {
    if (j.phase === "approval") {
      approval++;
      continue;
    }
    if (j.phase !== "queued") continue;
    (queue[w.stepOwner[stepOf(j)]] ||= []).push(j);
  }
  return { queue, approval };
}

function jobDot(j: Job, day: number): string {
  const late = j.deadlineDay < day + 1;
  const near = !late && j.deadlineDay - day <= 2;
  const cls = late ? "late" : near ? "near" : "ok";
  const title = `${JOB_KINDS[j.kind].label} 期限 ${j.deadlineDay}日目`;
  return `<i class="job ${cls} ${j.kind}" title="${esc(title)}"></i>`;
}

function deptBox(w: World, d: Dept, q: Record<number, Job[]>, selected: number | null): string {
  const members = w.staff.filter((s) => s.deptId === d.id);
  const steps = STEPS.filter((s) => w.stepOwner[s] === d.id).map((s) => STEP_LABEL[s]);
  const jobs = q[d.id] ?? [];
  const sorted = [...jobs].sort((a, b) => a.deadlineDay - b.deadlineDay);
  const dots = sorted.slice(0, MAX_DOTS).map((j) => jobDot(j, w.day)).join("");
  const more = jobs.length > MAX_DOTS ? `<span class="more">+${jobs.length - MAX_DOTS}</span>` : "";
  const staffDots = members
    .map((s) => `<i class="staff ${s.id === d.headId ? "head" : ""}" title="${esc(s.name)}${s.id === d.headId ? "(部署長)" : ""}"></i>`)
    .join("");
  const head = d.headId === null ? "部署長 空席" : `部署長 ${esc(getStaff(w, d.headId).name)}`;
  const children = w.depts.filter((c) => c.parentId === d.id);
  const sub = children.length
    ? `<div class="children">${children.map((c) => deptBox(w, c, q, selected)).join("")}</div>`
    : "";
  return `<div class="node"><div class="dept ${selected === d.id ? "sel" : ""}" data-dept="${d.id}">
    <div class="dname">${esc(d.name)} <small>${members.length}人</small></div>
    <div class="dsub">${head}${steps.length ? ` ・ 受け持ち: ${steps.join("・")}` : ""}</div>
    <div class="staffs">${staffDots}</div>
    <div class="queue" title="作業の順番待ち">${dots}${more}<small class="qn">待ち ${jobs.length}件</small></div>
  </div>${sub}</div>`;
}

function deptDetail(w: World, id: number, q: Record<number, Job[]>): string {
  const d = w.depts.find((x) => x.id === id);
  if (!d) return "";
  const jobs = q[id] ?? [];
  const byKind = (["small", "large", "rush"] as const)
    .map((k) => `${JOB_KINDS[k].label} ${jobs.filter((j) => j.kind === k).length}件`)
    .join(" / ");
  const late = jobs.filter((j) => j.deadlineDay < w.day + 1).length;
  return `<div class="detail"><b>${esc(d.name)}</b> の作業の順番待ち: ${jobs.length}件(${byKind})。期限をすぎたもの ${late}件。</div>`;
}

function resultView(w: World): string {
  const v = verdict(w, payroll(w));
  const label = { success: "成功", close: "惜しい", fail: "失敗" }[v];
  const over = payroll(w) > w.payrollCap + 1e-9;
  return `<div class="result ${v}"><h2>${label}</h2>
    <p>最後の30日間の期限内完了率: <b>${pct(finalOnTimeRate(w))}</b>(目標 80%)</p>
    <p>人件費: ${payroll(w).toFixed(1)} / 上限 ${w.payrollCap.toFixed(1)}${over ? "(上限を超えています)" : ""}</p>
    <button data-act="restart">もう一度はじめる</button></div>`;
}

export function render(w: World, speed: Speed, selected: number | null): string {
  const { queue, approval } = queuesByDept(w);
  const over = isScenarioOver(w);
  const last = w.records[w.records.length - 1];
  const rate = last ? last.onTimeRate : onTimeRate(w); // 始める前は、今の会社の状態を見せる
  const roots = w.depts.filter((d) => d.parentId === null);
  const btn = (s: Speed, label: string): string =>
    `<button data-speed="${s}" class="${speed === s ? "on" : ""}" ${over ? "disabled" : ""}>${label}</button>`;
  const pay = payroll(w);
  return `
  <header class="bar">
    <span class="title">組織構造ゲーム</span>
    <span>${Math.min(w.day, TUNING.scenarioDays)}日目 / ${TUNING.scenarioDays}日</span>
    <span class="big">期限内完了率 ${pct(rate)} <small>(目標 80%)</small></span>
    <span>人件費 ${pay.toFixed(1)} / 上限 ${w.payrollCap.toFixed(1)}</span>
    <span class="speed">${btn("pause", "一時停止")}${btn("normal", "通常")}${btn("fast", "高速")}</span>
  </header>
  <section class="chart">
    <div class="company">社長 → ${roots.map((d) => deptBox(w, d, queue, selected)).join("")}</div>
    <div class="legend"><i class="job ok"></i>余裕あり <i class="job near"></i>期限が近い <i class="job late"></i>期限をすぎた
      ・ 承認待ち ${approval}件 ・ 粒1つ = 業務1件</div>
    ${selected !== null ? deptDetail(w, selected, queue) : '<div class="detail">部署をクリックすると、待ちの内訳が出ます。</div>'}
  </section>
  ${over ? resultView(w) : ""}`;
}

export const STYLE = `
:root{--bg:#f6f7f9;--fg:#1d2330;--card:#fff;--line:#cfd5df;--ok:#3a8f5c;--near:#d99a1c;--late:#c8392f;--acc:#2f5fb3}
@media (prefers-color-scheme:dark){:root{--bg:#161a22;--fg:#e6e9ef;--card:#212733;--line:#3a4252;--ok:#58b57e;--near:#e5b04a;--late:#e0605a;--acc:#6f9be3}}
body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,sans-serif}
.bar{display:flex;flex-wrap:wrap;gap:.6rem 1.4rem;align-items:center;padding:.7rem 1rem;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0}
.title{font-weight:700}.big{font-size:1.2rem;font-weight:700}
.speed button,.result button{margin-right:.3rem;padding:.35rem .8rem;border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;cursor:pointer}
.speed button.on{background:var(--acc);color:#fff;border-color:var(--acc)}
.chart{padding:1rem;overflow-x:auto}
.company{display:flex;align-items:flex-start;gap:.8rem}
.node{display:flex;flex-direction:column;gap:.6rem}
.children{display:flex;gap:.6rem;padding-left:1rem;border-left:2px solid var(--line)}
.dept{background:var(--card);border:2px solid var(--line);border-radius:8px;padding:.5rem .7rem;min-width:11rem;max-width:20rem;cursor:pointer}
.dept.sel{border-color:var(--acc)}
.dname{font-weight:700}.dsub{font-size:.78rem;opacity:.75;margin:.15rem 0}
.staffs{display:flex;flex-wrap:wrap;gap:3px;margin:.3rem 0}
.staff{width:10px;height:10px;border-radius:50%;background:var(--acc);display:inline-block}
.staff.head{background:transparent;border:2px solid var(--acc);box-sizing:border-box}
.queue{display:flex;flex-wrap:wrap;gap:2px;align-items:center;min-height:14px;border-top:1px dashed var(--line);padding-top:.3rem}
.job{width:8px;height:8px;border-radius:2px;display:inline-block}
.job.large{width:11px;height:11px}.job.rush{border-radius:50%}
.job.ok{background:var(--ok)}.job.near{background:var(--near)}.job.late{background:var(--late)}
.qn,.more{margin-left:.4rem;font-size:.75rem}
.legend,.detail{margin-top:.8rem;font-size:.85rem}.legend .job{margin:0 .2rem 0 .6rem}
.result{margin:1rem;padding:1rem 1.4rem;border-radius:10px;background:var(--card);border:2px solid var(--line)}
.result.success{border-color:var(--ok)}.result.close{border-color:var(--near)}.result.fail{border-color:var(--late)}
`;
