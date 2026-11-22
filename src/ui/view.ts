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

/** 待ちの棒グラフは、この件数で満タンにする(これ以上たまると端まで赤や黄で埋まる) */
const BAR_FULL = 30;

function stepOf(j: Job): Step {
  const route = JOB_KINDS[j.kind].route;
  return route[Math.min(j.stepIdx, route.length - 1)].step;
}

/** 部署ごとの、作業の順番待ちの業務(承認待ちは別に数える) */
function queuesByDept(w: World): { queue: Record<number, Job[]>; approval: number; working: number } {
  const queue: Record<number, Job[]> = {};
  let approval = 0;
  let working = 0;
  for (const j of w.jobs) {
    if (j.phase === "approval") approval++;
    else if (j.phase === "queued") {
      if (j.assignee !== null) working++;
      else (queue[w.stepOwner[stepOf(j)]] ||= []).push(j);
    }
  }
  return { queue, approval, working };
}

/** 待ちの棒: 余裕あり(緑)・期限が近い(黄)・期限をすぎた(赤)を、件数に比例した幅で並べる */
function queueBar(jobs: Job[], day: number): string {
  let ok = 0;
  let near = 0;
  let late = 0;
  for (const j of jobs) {
    if (j.deadlineDay < day + 1) late++;
    else if (j.deadlineDay - day <= 2) near++;
    else ok++;
  }
  const scale = Math.max(jobs.length, BAR_FULL);
  const seg = (n: number, cls: string): string =>
    n > 0 ? `<i class="${cls}" style="width:${(n / scale) * 100}%"></i>` : "";
  return `<div class="bar2" role="img" aria-label="待ち ${jobs.length}件(期限をすぎた ${late}件、期限が近い ${near}件)">${seg(late, "late")}${seg(near, "near")}${seg(ok, "ok")}</div>`;
}

const PERSON = '<svg viewBox="0 0 10 12" aria-hidden="true"><circle cx="5" cy="3" r="2.4"/><path d="M1 12a4 4 0 0 1 8 0z"/></svg>';

function deptNode(w: World, d: Dept, q: Record<number, Job[]>, selected: number | null): string {
  const members = w.staff.filter((s) => s.deptId === d.id);
  const steps = STEPS.filter((s) => w.stepOwner[s] === d.id).map((s) => STEP_LABEL[s]);
  const jobs = q[d.id] ?? [];
  const late = jobs.filter((j) => j.deadlineDay < w.day + 1).length;
  const open = selected === d.id;
  const headStaff = d.headId === null ? null : getStaff(w, d.headId);
  const head = headStaff
    ? `<span class="person head"><span class="ico">${PERSON}</span>${esc(headStaff.name)}<em>部署長</em></span>`
    : `<span class="person vacant"><span class="ico">${PERSON}</span>空席<em>部署長</em></span>`;
  const others = members.filter((m) => m.id !== d.headId);
  const crowd = others.map((m) => `<span class="ico" title="${esc(m.name)}">${PERSON}</span>`).join("");
  const byKind = (["small", "large", "rush"] as const)
    .map((k) => `${JOB_KINDS[k].label} ${jobs.filter((j) => j.kind === k).length}件`)
    .join(" / ");
  const detail = open
    ? `<div class="detail"><div>待ちの内訳: ${byKind}</div><div>期限をすぎたもの ${late}件</div>
        <div class="names">${others.map((m) => `<span>${esc(m.name)}</span>`).join("")}</div></div>`
    : "";
  const children = w.depts.filter((c) => c.parentId === d.id);
  const kids = children.length ? `<div class="kids">${children.map((c) => deptNode(w, c, q, selected)).join("")}</div>` : "";
  return `<div class="tn"><button class="card ${open ? "sel" : ""}" data-dept="${d.id}" aria-expanded="${open}">
      <span class="row1"><b>${esc(d.name)}</b>${steps.map((x) => `<span class="tag">${x}</span>`).join("")}<span class="n">${members.length}人</span></span>
      ${head}
      <span class="crowd">${crowd}</span>
      ${queueBar(jobs, w.day)}
      <span class="row3"><span>待ち <b>${jobs.length}</b>件</span>${late ? `<span class="lt">期限すぎ ${late}件</span>` : ""}</span>
    </button>${detail}${kids}</div>`;
}

/** 仕事の流れ: 工程の順に、受け持つ部署と待ちの件数を矢印でつなぐ */
function flowStrip(w: World, q: Record<number, Job[]>): string {
  const cells = STEPS.map((st) => {
    const owner = w.depts.find((d) => d.id === w.stepOwner[st]);
    const n = (q[w.stepOwner[st]] ?? []).filter((j) => stepOf(j) === st).length;
    return `<div class="fc"><b>${STEP_LABEL[st]}</b><span>${owner ? esc(owner.name) : "—"}</span><em class="${n >= 10 ? "jam" : ""}">${n}件待ち</em></div>`;
  });
  return `<div class="flow">${cells.join('<span class="arw">›</span>')}</div>`;
}

function resultView(w: World): string {
  const v = verdict(w, payroll(w));
  const label = { success: "成功", close: "惜しい", fail: "失敗" }[v];
  const over = payroll(w) > w.payrollCap + 1e-9;
  return `<section class="result ${v}"><h2>${label}</h2>
    <p>最後の30日間の期限内完了率 <b>${pct(finalOnTimeRate(w))}</b>(目標 80%)</p>
    <p>人件費 ${payroll(w).toFixed(1)} / 上限 ${w.payrollCap.toFixed(1)}${over ? "(上限を超えています)" : ""}</p>
    <button class="primary" data-act="restart">もう一度はじめる</button></section>`;
}

export function render(w: World, speed: Speed, selected: number | null): string {
  const { queue, approval, working } = queuesByDept(w);
  const over = isScenarioOver(w);
  const last = w.records[w.records.length - 1];
  const rate = last ? last.onTimeRate : onTimeRate(w); // 始める前は、今の会社の状態を見せる
  const roots = w.depts.filter((d) => d.parentId === null);
  const day = Math.min(w.day, TUNING.scenarioDays);
  const pay = payroll(w);
  const ontrack = rate !== null && rate >= 0.8;
  const btn = (sp: Speed, label: string): string =>
    `<button data-speed="${sp}" class="${speed === sp ? "on" : ""}" ${over ? "disabled" : ""}>${label}</button>`;
  const allLate = Object.values(queue).reduce((a, js) => a + js.filter((j) => j.deadlineDay < w.day + 1).length, 0);
  return `
  <header class="top">
    <div class="kpi">
      <div class="rate ${ontrack ? "good" : "bad"}"><small>期限内完了率</small><b>${pct(rate)}</b><small>目標 80%</small></div>
      <div class="side"><div>${day}日目 / ${TUNING.scenarioDays}日</div>
        <div class="pay ${pay > w.payrollCap + 1e-9 ? "bad" : ""}">人件費 ${pay.toFixed(1)} / ${w.payrollCap.toFixed(1)}</div></div>
    </div>
    <progress max="${TUNING.scenarioDays}" value="${day}"></progress>
    <div class="speed">${btn("pause", "一時停止")}${btn("normal", "通常")}${btn("fast", "高速")}</div>
  </header>
  <main>
    <div class="tiles"><div><b>${working}</b>作業中</div><div><b>${approval}</b>承認待ち</div><div class="${allLate ? "lt" : ""}"><b>${allLate}</b>期限すぎ</div></div>
    <h2 class="sec">仕事の流れ</h2>
    ${flowStrip(w, queue)}
    <h2 class="sec">組織</h2>
    <div class="legend"><i class="ok"></i>余裕あり<i class="near"></i>期限が近い<i class="late"></i>期限をすぎた(待ちの棒)</div>
    <div class="president"><span class="ico">${PERSON}</span>社長</div>
    <div class="kids roots">${roots.map((d) => deptNode(w, d, queue, selected)).join("")}</div>
    <p class="hint">部署をタップすると、待ちの内訳と職員の名前が出ます。</p>
    ${over ? resultView(w) : ""}
  </main>`;
}

export const STYLE = `
:root{--bg:#f5f6f8;--fg:#1c2230;--sub:#5d6678;--card:#fff;--line:#d3d8e1;--ok:#3a8f5c;--near:#d99a1c;--late:#c8392f;--acc:#2f5fb3;--onacc:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141820;--fg:#e8ebf1;--sub:#9aa3b5;--card:#20262f;--line:#38404f;--ok:#58b57e;--near:#e5b04a;--late:#e0605a;--acc:#6f9be3;--onacc:#10151d;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#141820;--fg:#e8ebf1;--sub:#9aa3b5;--card:#20262f;--line:#38404f;--ok:#58b57e;--near:#e5b04a;--late:#e0605a;--acc:#6f9be3;--onacc:#10151d;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;font-size:15px;line-height:1.5}
#app{max-width:34rem;margin:0 auto}
.top{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:.6rem max(16px,env(safe-area-inset-left,0px)) .6rem max(16px,env(safe-area-inset-right,0px))}
.kpi{display:flex;justify-content:space-between;align-items:center;gap:1rem}
.rate{display:flex;flex-direction:column}.rate b{font-size:2.2rem;line-height:1.1;font-variant-numeric:tabular-nums}
.rate small,.side{color:var(--sub);font-size:.8rem}.rate.good b{color:var(--ok)}.rate.bad b{color:var(--late)}
.side{text-align:right;font-variant-numeric:tabular-nums}.pay.bad{color:var(--late);font-weight:700}
progress{width:100%;height:6px;margin:.5rem 0;accent-color:var(--acc)}
.speed{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem}
button{font:inherit;color:var(--fg)}
.speed button{min-height:44px;border:1px solid var(--line);background:var(--card);border-radius:8px}
.speed button.on{background:var(--acc);color:var(--onacc);border-color:var(--acc);font-weight:700}
.speed button:disabled{opacity:.5}
main{padding:.8rem max(16px,env(safe-area-inset-left,0px)) 2rem max(16px,env(safe-area-inset-right,0px))}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;text-align:center;font-size:.8rem;color:var(--sub)}
.tiles div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.4rem}
.tiles b{display:block;font-size:1.3rem;color:var(--fg);font-variant-numeric:tabular-nums}.tiles .lt b{color:var(--late)}
.sec{font-size:1rem;margin:1.2rem 0 .3rem}
.legend{display:flex;flex-wrap:wrap;gap:.2rem .8rem;align-items:center;font-size:.78rem;color:var(--sub);margin-bottom:.5rem}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:.25rem}
.ok{background:var(--ok)}.near{background:var(--near)}.late{background:var(--late)}
.flow{display:flex;align-items:stretch;gap:.2rem}
.fc{flex:1;min-width:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.4rem;text-align:center;display:flex;flex-direction:column;font-size:.78rem;color:var(--sub)}
.fc b{color:var(--fg);font-size:.95rem}.fc em{font-style:normal;font-variant-numeric:tabular-nums}.fc em.jam{color:var(--late);font-weight:700}
.arw{align-self:center;color:var(--sub);font-size:1.4rem}
.ico{display:inline-block;width:14px;height:16px;color:var(--acc)}.ico svg{width:100%;height:100%;fill:currentColor;display:block}
.president{display:inline-flex;align-items:center;gap:.4rem;background:var(--acc);color:var(--onacc);border-radius:999px;padding:.25rem .9rem;font-weight:700}
.president .ico{color:var(--onacc)}
.kids{margin-left:12px;padding-left:0}
.kids.roots{margin-left:0}
.kids>.tn{position:relative;padding-left:20px;border-left:2px solid var(--line)}
.kids.roots>.tn{margin-left:20px}
.kids>.tn::before{content:"";position:absolute;left:-2px;top:0;width:20px;height:24px;border-bottom:2px solid var(--line)}
.kids>.tn:last-child{border-left-color:transparent}
.kids>.tn:last-child::before{border-left:2px solid var(--line);border-bottom-left-radius:8px}
.tn .tn{margin-top:0}
.tag{font-size:.7rem;border:1px solid var(--line);border-radius:6px;padding:0 .35rem;color:var(--sub);margin-left:.3rem}
.row1{align-items:center;flex-wrap:wrap;gap:.2rem}.row1 .n{margin-left:auto}
.person{display:inline-flex;align-items:center;gap:.3rem;font-size:.85rem}
.person.head{font-weight:700}.person.head .ico{width:18px;height:20px}
.person em{font-style:normal;font-size:.7rem;border:1px solid var(--acc);color:var(--acc);border-radius:6px;padding:0 .3rem}
.person.vacant{color:var(--late)}.person.vacant .ico{color:var(--late);opacity:.6}
.crowd{display:flex;flex-wrap:wrap;gap:2px}
.card{display:flex;flex-direction:column;gap:.3rem;width:100%;text-align:left;background:var(--card);border:2px solid var(--line);border-radius:10px;padding:.6rem .8rem;margin-bottom:.5rem;cursor:pointer;min-height:44px}
.card.sel{border-color:var(--acc)}
.row1{display:flex}.row2{font-size:.8rem;color:var(--sub)}.n{color:var(--sub)}
.row3{display:flex;justify-content:space-between;font-size:.85rem;font-variant-numeric:tabular-nums}.lt{color:var(--late);font-weight:700}
.bar2{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--line)}.bar2 i{display:block;height:100%}
.detail{margin:-.2rem 0 .6rem;padding:.5rem .8rem;background:var(--card);border:1px dashed var(--line);border-radius:8px;font-size:.85rem}
.names{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.4rem}.names span{border:1px solid var(--line);border-radius:12px;padding:0 .5rem}.names .hd{border-color:var(--acc);font-weight:700}
.hint{font-size:.8rem;color:var(--sub)}
.result{margin-top:1rem;padding:1rem 1.2rem;border-radius:10px;background:var(--card);border:2px solid var(--line)}
.result h2{margin:0 0 .4rem}.result.success{border-color:var(--ok)}.result.close{border-color:var(--near)}.result.fail{border-color:var(--late)}
.primary{width:100%;min-height:48px;border:0;border-radius:8px;background:var(--acc);color:var(--onacc);font-weight:700;cursor:pointer}
`;
