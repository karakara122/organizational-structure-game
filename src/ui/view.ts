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

/** 画面の状態(計算には関係しない、見せ方だけの状態) */
export interface UiState {
  speed: Speed;
  /** 選んでいる部署 */
  selected: number | null;
  /** 選んでいる職員 */
  picked: number | null;
  /** none=ふつう / move=選んだ職員の移し先を選ぶ / reparent=選んだ部署の上の部署を選ぶ */
  mode: "none" | "move" | "reparent";
  /** 直前の操作の結果 */
  notice: { ok: boolean; text: string } | null;
}

const APPROVAL_LABEL = { none: "承認なし", head: "部署長", above: "その上の上司" } as const;

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

function deptNode(w: World, d: Dept, q: Record<number, Job[]>, ui: UiState): string {
  const members = w.staff.filter((s) => s.deptId === d.id);
  const jobs = q[d.id] ?? [];
  const late = jobs.filter((j) => j.deadlineDay < w.day + 1).length;
  const headStaff = d.headId === null ? null : getStaff(w, d.headId);
  const head = headStaff
    ? `<span class="hd"><span class="ico">${PERSON}</span>${esc(headStaff.name.split(" ")[0])}</span>`
    : `<span class="hd vac"><span class="ico">${PERSON}</span>空席</span>`;
  const children = w.depts.filter((c) => c.parentId === d.id);
  const kids = children.length ? `<div class="kids">${children.map((c) => deptNode(w, c, q, ui)).join("")}</div>` : "";
  const target = ui.mode !== "none" && !(ui.mode === "reparent" && ui.selected === d.id) ? "target" : "";
  return `<div class="tn"><button class="card ${ui.selected === d.id ? "sel" : ""} ${target}" data-dept="${d.id}" data-drag="dept" data-id="${d.id}" data-label="${esc(d.name)}" aria-label="${esc(d.name)}">
      <b>${esc(d.name)}</b>
      ${head}
      <span class="n">${members.length}人</span>
      ${queueBar(jobs, w.day)}
      <span class="q ${late ? "lt" : ""}">待ち ${jobs.length}</span>
    </button>${kids}</div>`;
}

function staffPanel(w: World, id: number): string {
  const s = w.staff.find((x) => x.id === id);
  if (!s) return "";
  const d = w.depts.find((x) => x.id === s.deptId);
  const isHeadNow = d?.headId === s.id;
  const sk = STEPS.map((st) => `${STEP_LABEL[st]} ${s.skills[st]}`).join(" ・ ");
  const ramp = s.rampUntil > w.day ? ` ・ 習熟中(あと${s.rampUntil - w.day}日)` : "";
  return `<div class="spanel"><div><b>${esc(s.name)}</b>${isHeadNow ? "(部署長)" : ""}</div>
    <div class="sk">専門 ${sk} ・ 管理 ${s.manage}${ramp}</div>
    <div class="acts"><button class="act" data-act="move">ほかの部署へ移す</button>
      <button class="act" data-act="${isHeadNow ? "unhead" : "head"}">${isHeadNow ? "部署長をやめる" : "部署長にする"}</button></div></div>`;
}

/** 選んだ部署の内訳と操作(木の下に出す) */
function deptDetail(w: World, id: number, q: Record<number, Job[]>, ui: UiState): string {
  const d = w.depts.find((x) => x.id === id);
  if (!d) return "";
  const members = w.staff.filter((s) => s.deptId === d.id);
  const steps = STEPS.filter((s) => w.stepOwner[s] === d.id).map((s) => STEP_LABEL[s]);
  const jobs = q[id] ?? [];
  const late = jobs.filter((j) => j.deadlineDay < w.day + 1).length;
  const byKind = (["small", "large", "rush"] as const)
    .map((k) => `${JOB_KINDS[k].label} ${jobs.filter((j) => j.kind === k).length}件`)
    .join(" / ");
  const names = members
    .map(
      (m) =>
        `<button class="chip ${m.id === d.headId ? "hdn" : ""} ${ui.picked === m.id ? "pk" : ""}" data-staff="${m.id}" data-drag="staff" data-id="${m.id}" data-label="${esc(m.name)}"><span class="ico">${PERSON}</span>${esc(m.name)}${m.id === d.headId ? "(部署長)" : ""}</button>`,
    )
    .join("");
  const picked = ui.picked !== null && members.some((m) => m.id === ui.picked) ? staffPanel(w, ui.picked) : "";
  return `<section class="detail"><b>${esc(d.name)}</b> ${steps.length ? `・ 受け持ち ${steps.join("・")}` : "・ 受け持ちの工程なし"}
    <div>待ち ${jobs.length}件(${byKind})。期限をすぎたもの ${late}件。</div>
    <div class="names">${names || "職員はいません"}</div>
    ${members.length ? '<div class="hint">職員をタップすると能力と操作が出ます。部署のカードにドラッグして移せます(同じ部署のカードに落とすと部署長になります)。</div>' : ""}
    ${picked}
    <div class="acts dacts">
      <span class="newd"><input id="newname" value="新しい部署" maxlength="10" aria-label="新しい部署の名前"><button class="act" data-act="create">この下に部署を作る</button></span>
      <button class="act" data-act="reparent">上の部署を変える</button>
      <button class="act" data-act="delete">この部署を無くす</button>
    </div></section>`;
}

/** 業務の流れ: 工程の順に、受け持つ部署・承認の方法・待ちの件数を見せ、その場で変えられる */
function stepSettings(w: World, q: Record<number, Job[]>): string {
  const rows = STEPS.map((st) => {
    const n = (q[w.stepOwner[st]] ?? []).filter((j) => stepOf(j) === st).length;
    const deptOpts = w.depts
      .map((d) => `<option value="${d.id}" ${d.id === w.stepOwner[st] ? "selected" : ""}>${esc(d.name)}</option>`)
      .join("");
    const apprOpts = (["none", "head", "above"] as const)
      .map((c) => `<option value="${c}" ${c === w.approval[st] ? "selected" : ""}>${APPROVAL_LABEL[c]}</option>`)
      .join("");
    return `<div class="srow"><b class="grip" data-drag="step" data-id="${st}" data-label="${STEP_LABEL[st]}の担当" title="部署のカードに落とすと、担当になります">⠿ ${STEP_LABEL[st]}</b>
      <label>担当<select data-owner="${st}">${deptOpts}</select></label>
      <label>承認<select data-appr="${st}">${apprOpts}</select></label>
      <em class="${n >= 10 ? "jam" : ""}">待ち ${n}件</em></div>`;
  });
  return `<section class="steps"><h2 class="sec">業務の流れ(見積 → 制作 → 検査)</h2>${rows.join("")}</section>`;
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

export function render(w: World, ui: UiState): string {
  const { speed, selected } = ui;
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
  const pickedStaff = ui.picked === null ? null : w.staff.find((x) => x.id === ui.picked);
  const banner =
    ui.mode === "move" && pickedStaff
      ? `<div class="banner">${esc(pickedStaff.name)} を移す先の部署をタップ <button class="act" data-act="cancel">やめる</button></div>`
      : ui.mode === "reparent" && selected !== null
        ? `<div class="banner">${esc(w.depts.find((d) => d.id === selected)?.name ?? "")} の上の部署をタップ(一番上にするなら「社長」) <button class="act" data-act="cancel">やめる</button></div>`
        : "";
  const notice = ui.notice ? `<div class="notice ${ui.notice.ok ? "okn" : "ngn"}" role="status">${esc(ui.notice.text)}</div>` : "";
  const presTag = ui.mode === "reparent" ? "button" : "span";
  return `
  <header class="top">
    <div class="kpi">
      <div class="rate ${ontrack ? "good" : "bad"}"><b>${pct(rate)}</b><small>期限内完了率<br>目標 80%</small></div>
      <div class="side"><div>${day} / ${TUNING.scenarioDays}日</div>
        <div class="pay ${pay > w.payrollCap + 1e-9 ? "bad" : ""}">人件費 ${pay.toFixed(1)}/${w.payrollCap.toFixed(1)}</div></div>
      <div class="speed">${btn("pause", "停止")}${btn("normal", "通常")}${btn("fast", "高速")}</div>
    </div>
    <progress max="${TUNING.scenarioDays}" value="${day}"></progress>
  </header>
  <main>
    ${banner}
    <div class="chart"><div class="tn rootn"><${presTag} class="president ${ui.mode === "reparent" ? "target" : ""}" data-root="1"><span class="ico">${PERSON}</span>社長</${presTag}>
      <div class="kids">${roots.map((d) => deptNode(w, d, queue, ui)).join("")}</div></div></div>
    <div class="legend"><i class="ok"></i>余裕あり<i class="near"></i>期限が近い<i class="late"></i>期限をすぎた(待ちの棒)</div>
    ${notice}
    ${selected !== null ? deptDetail(w, selected, queue, ui) : '<p class="hint">部署をタップすると、職員と操作が出ます。職員・部署・工程名は、部署のカードにドラッグして落とせます。</p>'}
    ${stepSettings(w, queue)}
    <p class="status">作業中 <b>${working}</b>件 ・ 承認待ち <b>${approval}</b>件 ・ <span class="${allLate ? "lt" : ""}">期限すぎ <b>${allLate}</b>件</span></p>
    ${over ? resultView(w) : ""}
  </main>`;
}

export const STYLE = `
:root{--bg:#f5f6f8;--fg:#1c2230;--sub:#5d6678;--card:#fff;--line:#d3d8e1;--ok:#3a8f5c;--near:#d99a1c;--late:#c8392f;--acc:#2f5fb3;--onacc:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141820;--fg:#e8ebf1;--sub:#9aa3b5;--card:#20262f;--line:#38404f;--ok:#58b57e;--near:#e5b04a;--late:#e0605a;--acc:#6f9be3;--onacc:#10151d;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#141820;--fg:#e8ebf1;--sub:#9aa3b5;--card:#20262f;--line:#38404f;--ok:#58b57e;--near:#e5b04a;--late:#e0605a;--acc:#6f9be3;--onacc:#10151d;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;font-size:15px;line-height:1.5}
#app{max-width:34rem;margin:0 auto}
.top{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:.4rem max(16px,env(safe-area-inset-left,0px)) 0 max(16px,env(safe-area-inset-right,0px))}
.kpi{display:flex;align-items:center;gap:.4rem}
.rate{display:flex;align-items:center;gap:.3rem}.rate small{white-space:nowrap}.rate b{font-size:1.5rem;line-height:1.1;font-variant-numeric:tabular-nums}
.rate small,.side{color:var(--sub);font-size:.68rem;line-height:1.25}.rate.good b{color:var(--ok)}.rate.bad b{color:var(--late)}
.side{flex:1;white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}.pay.bad{color:var(--late);font-weight:700}
progress{display:block;width:100%;height:3px;margin:.35rem 0 0;accent-color:var(--acc)}
.speed{display:flex;gap:.2rem}
button{font:inherit;color:var(--fg)}
.speed button{white-space:nowrap;flex-shrink:0;min-height:36px;padding:0 .4rem;font-size:.8rem;border:1px solid var(--line);background:var(--card);border-radius:8px}
.speed button.on{background:var(--acc);color:var(--onacc);border-color:var(--acc);font-weight:700}
.speed button:disabled{opacity:.5}
main{padding:.6rem max(16px,env(safe-area-inset-left,0px)) 2rem max(16px,env(safe-area-inset-right,0px))}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;text-align:center;font-size:.8rem;color:var(--sub)}
.tiles div{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.4rem}
.tiles b{display:block;font-size:1.3rem;color:var(--fg);font-variant-numeric:tabular-nums}.tiles .lt b{color:var(--late)}
.sec{font-size:1rem;margin:1.2rem 0 .3rem}
.legend{display:flex;flex-wrap:wrap;gap:.2rem .8rem;align-items:center;font-size:.7rem;color:var(--sub);margin:.2rem 0 .4rem;justify-content:center}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:.25rem}
.ok{background:var(--ok)}.near{background:var(--near)}.late{background:var(--late)}
.flow{display:flex;align-items:stretch;gap:.2rem;margin-top:.6rem}.status{font-size:.8rem;color:var(--sub);margin:.4rem 0}.status b{color:var(--fg)}
.fc{flex:1;min-width:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.2rem .3rem;text-align:center;display:flex;flex-direction:column;font-size:.7rem;color:var(--sub);line-height:1.3}
.fc b{color:var(--fg);font-size:.8rem}.fc em{font-style:normal;font-variant-numeric:tabular-nums}.fc em.jam{color:var(--late);font-weight:700}
.arw{align-self:center;color:var(--sub);font-size:1rem}
.ico{display:inline-block;width:12px;height:14px;color:var(--acc)}.ico svg{width:100%;height:100%;fill:currentColor;display:block}
.chart{overflow-x:auto;padding:.4rem 0 .4rem;min-height:10.5rem}
.chart>.tn{width:max-content;margin:0 auto}
.president{display:inline-flex;align-items:center;gap:.4rem;background:var(--acc);color:var(--onacc);border-radius:999px;padding:.25rem .9rem;font-weight:700}
.president .ico{color:var(--onacc)}
/* ピラミッド型の木: 親を上、子を横に並べて線でつなぐ */
.tn{display:flex;flex-direction:column;align-items:center;position:relative;padding:14px 4px 0}
.rootn{padding-top:0}
.kids{display:flex;justify-content:center;position:relative}
.kids::before{content:"";position:absolute;top:0;left:50%;height:14px;border-left:2px solid var(--line)}
.kids>.tn::before,.kids>.tn::after{content:"";position:absolute;top:0;width:50%;height:14px;border-top:2px solid var(--line)}
.kids>.tn::before{right:50%}.kids>.tn::after{left:50%;border-left:2px solid var(--line)}
.kids>.tn:only-child::before,.kids>.tn:only-child::after{display:none}
.kids>.tn:first-child::before,.kids>.tn:last-child::after{border:0 none}
.kids>.tn:last-child::before{border-right:2px solid var(--line);border-radius:0 6px 0 0}
.kids>.tn:first-child::after{border-radius:6px 0 0 0}
.kids>.tn:only-child{padding-top:14px}
.card{display:flex;flex-direction:column;align-items:center;gap:.2rem;width:6.6rem;background:var(--card);border:2px solid var(--line);border-radius:10px;padding:.4rem .3rem;cursor:pointer;min-height:44px;font-size:.78rem}
.card b{font-size:.9rem}.card.sel{border-color:var(--acc)}
.card .n{color:var(--sub);font-size:.72rem}.card .q{font-size:.78rem;font-variant-numeric:tabular-nums}.lt{color:var(--late);font-weight:700}
.hd{display:inline-flex;align-items:center;gap:.2rem;font-size:.78rem;font-weight:700}.hd.vac{color:var(--late)}.hd.vac .ico{color:var(--late)}
.bar2{display:flex;height:8px;width:100%;border-radius:4px;overflow:hidden;background:var(--line)}.bar2 i{display:block;height:100%}
.detail{margin-top:.4rem;padding:.6rem .8rem;background:var(--card);border:1px solid var(--line);border-radius:8px;font-size:.85rem}
.names{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.4rem}.names>span{display:inline-flex;align-items:center;gap:.2rem;border:1px solid var(--line);border-radius:12px;padding:0 .5rem}.names .hdn{border-color:var(--acc);font-weight:700}
.card.target,.president.target{outline:2px dashed var(--acc);outline-offset:2px;cursor:pointer}
button.president{border:0;font:inherit}
.chip{display:inline-flex;align-items:center;gap:.2rem;border:1px solid var(--line);border-radius:14px;padding:.2rem .6rem;background:var(--card);min-height:32px;cursor:pointer}
.chip.hdn{border-color:var(--acc);font-weight:700}.chip.pk{background:var(--acc);color:var(--onacc);border-color:var(--acc)}.chip.pk .ico{color:var(--onacc)}
.names{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.4rem}
.spanel{margin-top:.5rem;padding:.5rem;border:1px solid var(--acc);border-radius:8px}.sk{font-size:.78rem;color:var(--sub)}
.acts{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}.dacts{border-top:1px dashed var(--line);padding-top:.5rem}
.act{min-height:40px;padding:0 .8rem;border:1px solid var(--line);background:var(--card);border-radius:8px;cursor:pointer;font-size:.85rem}
.newd{display:flex;gap:.3rem;flex-wrap:wrap;width:100%}.newd input{flex:1;min-width:6rem;min-height:40px;border:1px solid var(--line);border-radius:8px;padding:0 .5rem;font:inherit;background:var(--card);color:var(--fg)}
.banner{position:sticky;top:3.4rem;z-index:4;background:var(--acc);color:var(--onacc);padding:.4rem .6rem;border-radius:8px;margin-bottom:.4rem;font-size:.85rem;display:flex;gap:.5rem;align-items:center;justify-content:space-between}
.banner .act{min-height:32px;color:var(--fg)}
.notice{margin:.3rem 0;padding:.4rem .6rem;border-radius:8px;font-size:.85rem;border:1px solid var(--line);background:var(--card)}.okn{border-color:var(--ok)}.ngn{border-color:var(--late);color:var(--late)}
.steps .sec{font-size:.9rem}
.srow{display:grid;grid-template-columns:3rem 1fr 1fr;gap:.3rem .5rem;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.4rem .5rem;margin-bottom:.4rem;font-size:.8rem}
.srow label{display:flex;flex-direction:column;color:var(--sub);font-size:.7rem}
.srow select{min-height:36px;font:inherit;font-size:.85rem;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
.srow em{grid-column:2/4;font-style:normal;color:var(--sub);font-variant-numeric:tabular-nums}.srow em.jam{color:var(--late);font-weight:700}
.card[data-drag],.chip[data-drag],.grip{cursor:grab;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.dragging .card,.dragging .president{outline:2px dashed var(--line);outline-offset:2px}
.dragging .drop{outline:3px solid var(--acc)!important;background:color-mix(in srgb,var(--acc) 15%,var(--card))}
.ghost{position:fixed;z-index:50;pointer-events:none;transform:translate(-50%,-120%);background:var(--acc);color:var(--onacc);padding:.3rem .7rem;border-radius:14px;font-size:.85rem;box-shadow:0 4px 12px #0004;white-space:nowrap}
.grip{display:inline-block}
.hint{font-size:.8rem;color:var(--sub)}
.result{margin-top:1rem;padding:1rem 1.2rem;border-radius:10px;background:var(--card);border:2px solid var(--line)}
.result h2{margin:0 0 .4rem}.result.success{border-color:var(--ok)}.result.close{border-color:var(--near)}.result.fail{border-color:var(--late)}
.primary{width:100%;min-height:48px;border:0;border-radius:8px;background:var(--acc);color:var(--onacc);font-weight:700;cursor:pointer}
`;
