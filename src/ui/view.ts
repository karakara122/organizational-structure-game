// 画面の表示だけを作る部分。計算はしない(計算は src/sim/)。
// 用語は docs/仕様書.md 6-2 の表の言葉だけを使う。
import {
  JOB_KINDS,
  STEP_LABEL,
  STEPS,
  TUNING,
  approvalLoad,
  canWork,
  causeSummary,
  finalOnTimeRate,
  baselineFor,
  FLOW_HINT,
  flowCompare,
  flowRising,
  lateDays,
  lateJobs,
  getStaff,
  manageEffect,
  approvalSqueeze,
  manageLoad,
  manageTimeNeeded,
  subordinateCount,
  isScenarioOver,
  isWithin,
  onTimeRate,
  payroll,
  queueChange,
  queueDays,
  recentFlow,
  verdict,
} from "../sim";
import type { Dept, Job, Step, World } from "../sim";

export type Speed = "pause" | "normal" | "fast";

/** 画面の状態(計算には関係しない、見せ方だけの状態) */
export interface UiState {
  speed: Speed;
  /** 選んでいる部署 */
  selected: number | null;
  /** 選んでいる職員(複数選べる) */
  picked: number[];
  /** 元に戻せる操作があるか */
  canUndo: boolean;
  /** none=ふつう / move=選んだ職員の移し先を選ぶ / reparent=選んだ部署の上の部署を選ぶ */
  mode: "none" | "reparent";
  /** 遅れた業務の一覧を開いているか/開いている業務 */
  showLate: boolean;
  openJob: number | null;
  /** 「最初からやりなおす」の確認中か */
  confirmReset: boolean;
  /** 自動でコピーできなかったときに見せる記録の文字 */
  copyText: string | null;
  /** 直前の操作の結果 */
  notice: { ok: boolean; text: string } | null;
}

const APPROVAL_LABEL = { none: "承認なし", head: "部署長", above: "その上の上司" } as const;

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const pct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** 待ちの棒グラフは、残りの作業量が「職員1人あたり この日数ぶん」で満タンになる(これ以上は端まで埋まる) */
const BAR_FULL_DAYS = 5;

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

/** 待ちの棒: 余裕あり(緑)・期限が近い(黄)・期限をすぎた(赤)を、残りの作業量に比例した幅で並べる */
function queueBar(jobs: Job[], day: number, workers: number): string {
  let ok = 0;
  let near = 0;
  let late = 0;
  let nLate = 0;
  let nNear = 0;
  for (const j of jobs) {
    if (j.deadlineDay < day + 1) {
      late += j.remaining;
      nLate++;
    } else if (j.deadlineDay - day <= 2) {
      near += j.remaining;
      nNear++;
    } else ok += j.remaining;
  }
  const total = late + near + ok;
  // 作業する職員がいないのに待ちがあるときは、端まで埋める
  const full = Math.max(1, workers) * BAR_FULL_DAYS;
  const scale = workers === 0 && total > 0 ? total : Math.max(total, full);
  const seg = (n: number, cls: string): string =>
    n > 0 ? `<i class="${cls}" style="width:${(n / scale) * 100}%"></i>` : "";
  return `<div class="bar2" role="img" aria-label="待ち ${jobs.length}件(期限をすぎた ${nLate}件、期限が近い ${nNear}件)">${seg(late, "late")}${seg(near, "near")}${seg(ok, "ok")}</div>`;
}

/** 待ちを片づけるのにかかる日数の目安の文字 */
function daysText(w: World, jobs: Job[], ownerId: number): string {
  if (jobs.length === 0) return "";
  const d = queueDays(w, jobs, ownerId);
  return d === Infinity ? "人なし" : `${d < 10 ? d.toFixed(1) : Math.round(d)}日`;
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
  const target = (ui.mode === "reparent" || ui.picked.length > 0) && ui.selected !== d.id ? "target" : "";
  // 移す操作の途中は、各カードに「どこへ」を書く
  const here = ui.picked.some((id) => members.some((m) => m.id === id));
  const mv =
    ui.picked.length > 0
      ? `<span class="mv ${here ? "src" : ""}">${here ? "移動元" : "ここへ移動"}</span>`
      : ui.mode === "reparent"
        ? `<span class="mv ${ui.selected === d.id ? "src" : ""}">${ui.selected === d.id ? "動かす部署" : "この下へ"}</span>`
        : "";
  // 部署長の管理時間が足りないとき(部下が多すぎる)だけ、印を出す。事実の表示で、提案ではない
  const overloaded =
    headStaff !== null && manageEffect(manageTimeNeeded(subordinateCount(w, d.id), headStaff.manage)) < 1;
  const workers = members.filter((m) => m.id !== d.headId).length;
  const idle = workers > 0 && !canWork(w, d.id);
  const owned = STEPS.some((st) => w.stepOwner[st] === d.id);
  const qc = queueChange(w, d.id);
  const qcBadge = qc >= 1 ? `<span class="qc ${qc >= 6 ? "hi" : qc >= 3 ? "mid" : ""}" title="直近3日の待ちの増減">+${qc}</span>` : "";
  const bw = w.staff.filter((s) => isWithin(w, s.deptId, d.id) && !w.depts.some((x) => x.headId === s.id)).length;
  return `<div class="tn"><button class="card ${ui.selected === d.id ? "sel" : ""} ${target}" data-dept="${d.id}" aria-label="${esc(d.name)}">
      ${mv}${qcBadge}<b>${esc(d.name)}</b>
      ${head}
      <span class="n">${members.length}人</span>${overloaded ? '<span class="ovl" title="部署長の管理時間が足りません">管理不足</span>' : ""}${idle ? '<span class="ovl idle" title="担当する工程の下にいないため、職員は作業していません">作業なし</span>' : ""}
      ${queueBar(jobs, w.day, bw)}
      <span class="q ${late ? "lt" : ""}"><span>待ち ${jobs.length}</span>${owned && jobs.length ? ` <span class="qd">${daysText(w, jobs, d.id)}</span>` : ""}</span>
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
    <div class="sk">移す先の部署のカードをタップすると移ります。</div>
    <div class="acts"><button class="act" data-act="${isHeadNow ? "unhead" : "head"}">${isHeadNow ? "部署長をやめる" : "部署長にする"}</button></div></div>`;
}

/** 部署の状態を、数字で説明する(事実の表示。直し方の提案は出さない) */
function facts(w: World, d: Dept): string {
  const out: string[] = [];
  const ml = manageLoad(w, d.id);
  if (ml) {
    const over = ml.subordinates > ml.capacity;
    out.push(
      `<div class="fact ${over ? "warn" : ""}">管理: 部署長の部下 ${ml.subordinates}人 / 管理できる目安 ${ml.capacity}人${over ? "。目安を超えていて、部署の職員の能率が下がっています" : ""}</div>`,
    );
  } else {
    out.push('<div class="fact warn">部署長が空席です。部署の職員の能率が下がっています</div>');
  }
  const sq = approvalSqueeze(w, d.id);
  if (sq?.squeezed) {
    out.push(
      `<div class="fact warn">承認待ち ${sq.waiting}件のために、部署長は先に約${sq.reserve.toFixed(1)}日分を承認に使っています。管理に使える時間が減り、部署の職員の能率が下がっています</div>`,
    );
  }
  const workers = w.staff.filter((s) => s.deptId === d.id && s.id !== d.headId).length;
  if (workers > 0 && !canWork(w, d.id)) {
    out.push(
      '<div class="fact warn">この部署は、担当する工程の下にいないため、職員は作業していません</div>',
    );
  }
  return out.join("");
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
        `<button class="chip ${m.id === d.headId ? "hdn" : ""} ${ui.picked.includes(m.id) ? "pk" : ""}" data-staff="${m.id}"><span class="ico">${PERSON}</span>${esc(m.name)}${m.id === d.headId ? "(部署長)" : ""}</button>`,
    )
    .join("");
  const pickedHere = ui.picked.filter((id) => members.some((m) => m.id === id));
  const picked =
    pickedHere.length === 1
      ? staffPanel(w, pickedHere[0]!)
      : pickedHere.length > 1
        ? `<div class="spanel"><div><b>${pickedHere.length}人</b>を選んでいます</div>
            <div class="acts"><span class="sk">移す先の部署のカードをタップすると、まとめて移ります。</span><button class="act" data-act="clear">選びなおす</button></div></div>`
        : "";
  return `<aside class="sheet" aria-label="${esc(d.name)}の職員と操作"><button class="close" data-act="close" aria-label="閉じる">×</button><section class="detail"><b>${esc(d.name)}</b> ${steps.length ? `・ 受け持ち ${steps.join("・")}` : "・ 受け持ちの工程なし"}
    <div>待ち ${jobs.length}件(${byKind})。期限をすぎたもの ${late}件。${jobs.length ? (queueDays(w, jobs, d.id) === Infinity ? "作業する職員がいません。" : `片づけるのに約${daysText(w, jobs, d.id)}(残りの作業量 ÷ 作業する職員の人数)。`) : ""}</div>
    ${facts(w, d)}
    ${STEPS.filter((st) => w.stepOwner[st] === d.id).map((st) => stepRow(w, q, st)).join("")}
    ${picked}
    <div class="names">${names || "職員はいません"}</div>
    ${members.length ? '<div class="hint">職員をタップすると選べます(続けてタップすると、複数人を選べます)。選んだあと、移す先の部署のカードをタップすると移ります。</div>' : ""}
    <div class="acts dacts">
      <span class="newd"><input id="newname" value="新部署${w.nextDeptId}" maxlength="10" aria-label="新しい部署の名前"><button class="act" data-act="create">この下に部署を作る</button></span>
      <button class="act" data-act="reparent">上の部署を変える</button>
      <button class="act" data-act="delete">この部署を無くす</button>
    </div></section></aside>`;
}

/** 承認の状態(事実の表示) */
function approvalInfo(w: World, st: Step): string {
  const a = approvalLoad(w, st);
  if (!a) return "";
  const jam = a.waiting > a.perDay * 2;
  return `<div class="afact ${jam ? "warn" : ""}">承認待ち ${a.waiting}件 ・ 承認する${esc(a.who)}が管理を保ったまま1日に処理できる目安 ${a.perDay}件</div>`;
}

/** 期限内完了率の推移(小さなグラフ) */
function trend(w: World): string {
  const pts = w.records.filter((r) => r.onTimeRate !== null);
  if (pts.length < 2) return "";
  const W = 300;
  const H = 44;
  const x = (d: number): number => (d / TUNING.scenarioDays) * W;
  const y = (r: number): number => H - 2 - r * (H - 4);
  const line = pts.map((r) => `${x(r.day).toFixed(1)},${y(r.onTimeRate!).toFixed(1)}`).join(" ");
  // 灰色の線: 何もしなかった場合(同じシードで最初の組織のまま)。今の日までだけ描く
  const base = baselineFor(w.seed);
  const bpts = w.records
    .map((r, i) => ({ day: r.day, rate: base.rates[i] ?? null }))
    .filter((p) => p.rate !== null);
  const bline = bpts.map((p) => `${x(p.day).toFixed(1)},${y(p.rate!).toFixed(1)}`).join(" ");
  const bsvg = bpts.length >= 2 ? `<polyline points="${bline}" class="bl"/>` : "";
  return `<div class="trendh">期限内完了率の推移(点線は目標80%・灰色は何もしなかった場合)</div><svg class="trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="期限内完了率の推移(点線は目標80%、灰色は何もしなかった場合)"><line x1="0" x2="${W}" y1="${y(0.8)}" y2="${y(0.8)}" class="goal"/>${bsvg}<polyline points="${line}" class="ln"/></svg>`;
}

/** 工程1つぶんの行: 受け持つ部署・承認の方法・待ちの件数を見せ、その場で変えられる */
function stepRow(w: World, q: Record<number, Job[]>, st: Step): string {
  {
    const n = (q[w.stepOwner[st]] ?? []).filter((j) => stepOf(j) === st).length;
    const deptOpts = w.depts
      .map((d) => `<option value="${d.id}" ${d.id === w.stepOwner[st] ? "selected" : ""}>${esc(d.name)}</option>`)
      .join("");
    const apprOpts = (["none", "head", "above"] as const)
      .map((c) => `<option value="${c}" ${c === w.approval[st] ? "selected" : ""}>${APPROVAL_LABEL[c]}</option>`)
      .join("");
    return `<div class="srow"><b>${STEP_LABEL[st]}</b>
      <label>担当<select data-owner="${st}">${deptOpts}</select></label>
      <label>承認<select data-appr="${st}">${apprOpts}</select></label>
      <em class="${n >= 10 ? "jam" : ""}">待ち ${n}件</em>${approvalInfo(w, st)}</div>`;
  }
}

/** 業務の流れ: 工程の順に、受け持つ部署・承認の方法・待ちの件数を見せ、その場で変えられる */
function stepSettings(w: World, q: Record<number, Job[]>): string {
  const rows = STEPS.map((st) => stepRow(w, q, st));
  return `<section class="steps"><h2 class="sec">業務の流れ(見積 → 制作 → 検査)</h2>${rows.join("")}</section>`;
}

const CAUSES = [
  ["work", "作業", "--c-work"],
  ["queue", "順番待ち", "--c-queue"],
  ["approval", "承認待ち", "--c-appr"],
  ["handoff", "受け渡し", "--c-hand"],
  ["rework", "やり直し", "--c-redo"],
] as const;

function jobDetail(j: Job): string {
  const k = JOB_KINDS[j.kind];
  const where =
    j.doneDay !== null
      ? `${j.doneDay}日目に完了`
      : `まだ終わっていません(今は${STEP_LABEL[stepOf(j)]}の${j.phase === "approval" ? "承認待ち" : "段階"})`;
  const cells = CAUSES.map(([key, label, color]) => `<span><i style="background:var(${color})"></i>${label} ${j.days[key]}日</span>`).join("");
  return `<div class="jd"><div>${k.label} #${j.id} ・ ${j.arrivedDay}日目に発生 ・ 期限 ${j.deadlineDay}日目 ・ ${where}</div>
    <div class="jdd">${cells}</div>
    <div>客からの差し戻し ${j.returns}回 ・ 承認で見つかったミス ${j.caught}回</div></div>`;
}

/** 遅れの原因(仕様書 5章)。かかった日数の内訳を見せるだけで、直し方は出さない */
function causeSection(w: World, ui: UiState): string {
  const { count, days } = causeSummary(w);
  if (count === 0) {
    return `<section class="cause"><h2 class="sec">遅れの原因</h2><p class="hint">直近30日に期限をむかえた業務で、遅れたものはありません。</p></section>`;
  }
  const total = CAUSES.reduce((a, [key]) => a + days[key], 0) || 1;
  const bar = CAUSES.map(([key, , color]) => (days[key] > 0 ? `<i style="width:${(days[key] / total) * 100}%;background:var(${color})"></i>` : "")).join("");
  const rows = CAUSES.map(
    ([key, label, color]) =>
      `<div class="cr"><span><i style="background:var(${color})"></i>${label}</span><b>${Math.round((days[key] / total) * 100)}%</b><em>1件あたり ${(days[key] / count).toFixed(1)}日</em></div>`,
  ).join("");
  const list = ui.showLate
    ? `<div class="ll">${lateJobs(w)
        .slice(0, 10)
        .map(
          (j) =>
            `<button class="lj ${ui.openJob === j.id ? "open" : ""}" data-job="${j.id}">${JOB_KINDS[j.kind].label} #${j.id} ・ 期限 ${j.deadlineDay}日目 ・ ${lateDays(j, w.day)}日遅れ${j.doneDay === null ? "(未完了)" : ""}</button>${ui.openJob === j.id ? jobDetail(j) : ""}`,
        )
        .join("")}${count > 10 ? `<p class="hint">遅れの大きい10件だけ出しています(全部で${count}件)。</p>` : ""}</div>`
    : "";
  return `<section class="cause"><h2 class="sec">遅れの原因</h2>
    <p class="hint">直近30日に期限をむかえて遅れた業務 ${count}件の、かかった日数の内訳です。</p>
    <div class="cbar" role="img" aria-label="遅れた業務のかかった日数の内訳">${bar}</div>${rows}
    <button class="act" data-act="late">${ui.showLate ? "遅れた業務を閉じる" : `遅れた業務を見る(${count}件)`}</button>${list}</section>`;
}

function footer(ui: UiState): string {
  const reset = ui.confirmReset
    ? `<span class="confirm">最初からやりなおしますか?<button class="act" data-act="reset-yes">はい</button><button class="act" data-act="reset-no">いいえ</button></span>`
    : `<button class="act" data-act="reset">最初からやりなおす</button>`;
  const text =
    ui.copyText !== null
      ? `<textarea id="logtext" readonly rows="8" aria-label="プレイ記録">${esc(ui.copyText)}</textarea><p class="hint">自動でコピーできなかったので、ここを全部選んでコピーしてください。</p>`
      : "";
  return `<footer class="foot"><button class="act" data-act="copylog">記録をコピー</button>${reset}${text}</footer>`;
}

/** 自分の組織と、「何もしなかった場合」(同じシードで最初の組織のまま)の比較 */
function compareView(w: World): string {
  const mine = finalOnTimeRate(w);
  const base = baselineFor(w.seed).final;
  if (mine === null || base === null) return "";
  const diff = Math.round((mine - base) * 100);
  const sign = diff > 0 ? `+${diff}` : `${diff}`;
  const word = diff > 0 ? "あなたの組織のほうが良くなりました" : diff < 0 ? "何もしないほうが良い結果でした" : "同じ結果でした";
  return `<p class="cmp">何もしなかった場合(同じ注文・最初の組織のまま): <b>${pct(base)}</b> → あなたの組織 <b>${pct(mine)}</b>(${sign}ポイント。${word})</p>`;
}

function resultView(w: World): string {
  const v = verdict(w, payroll(w));
  const label = { success: "成功", close: "惜しい", fail: "失敗" }[v];
  const over = payroll(w) > w.payrollCap + 1e-9;
  return `<section class="result ${v}"><h2>${label}</h2>
    <p>最後の30日間の期限内完了率 <b>${pct(finalOnTimeRate(w))}</b>(目標 80%)</p>
    <p>人件費 ${payroll(w).toFixed(1)} / 上限 ${w.payrollCap.toFixed(1)}${over ? "(上限を超えています)" : ""}</p>
    ${compareView(w)}
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
  const pickedNames = ui.picked.map((id) => w.staff.find((x) => x.id === id)?.name ?? "");
  const banner =
    pickedNames.length > 0 && ui.mode !== "reparent"
      ? `<div class="banner">${pickedNames.length === 1 ? esc(pickedNames[0]!) : `${pickedNames.length}人`} を移す先の部署をタップ <button class="act" data-act="clear">やめる</button></div>`
      : ui.mode === "reparent" && selected !== null
        ? `<div class="banner">${esc(w.depts.find((d) => d.id === selected)?.name ?? "")} の上の部署をタップ(一番上にするなら「社長」) <button class="act" data-act="cancel">やめる</button></div>`
        : "";
  const undoBtn = ui.canUndo ? ` <button class="act undo" data-act="undo">元に戻す</button>` : "";
  const notice = ui.notice
    ? `<div class="notice ${ui.notice.ok ? "okn" : "ngn"}" role="status"><span>${esc(ui.notice.text)}</span>${undoBtn}</div>`
    : ui.canUndo
      ? `<div class="undo-only">${undoBtn}</div>`
      : "";
  const fc = flowCompare(w);
  const surge = flowRising(w)
    ? `<div class="flowup" role="status">直近${FLOW_HINT.days}日の発生 ${fc.recent}件(前の${FLOW_HINT.days}日 ${fc.before}件) ↑</div>`
    : "";
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
  <main class="${selected !== null ? "has-sheet" : ""}">
    ${banner}
    ${surge}
    <div class="chart"><div class="tn rootn"><${presTag} class="president ${ui.mode === "reparent" ? "target" : ""}" data-root="1"><span class="ico">${PERSON}</span>社長</${presTag}>
      <div class="kids">${roots.map((d) => deptNode(w, d, queue, ui)).join("")}</div></div></div>
    <div class="legend"><i class="ok"></i>余裕あり<i class="near"></i>期限が近い<i class="late"></i>期限をすぎた(待ちの棒)</div>
    ${notice}
    ${selected !== null ? "" : '<p class="hint">部署をタップすると、下から職員と操作が出ます。職員を選んで、移す先の部署をタップすると移せます。</p>'}
    ${stepSettings(w, queue)}
    ${causeSection(w, ui)}
    ${trend(w)}
    <p class="status">直近7日: 発生 <b>${recentFlow(w).arrived}</b>件 ・ 完了 <b>${recentFlow(w).completed}</b>件</p>
    <p class="status">作業中 <b>${working}</b>件 ・ 承認待ち <b>${approval}</b>件 ・ <span class="${allLate ? "lt" : ""}">期限すぎ <b>${allLate}</b>件</span></p>
    ${over ? resultView(w) : ""}
    ${footer(ui)}
  </main>
  ${selected !== null ? deptDetail(w, selected, queue, ui) : ""}`;
}

export const STYLE = `
:root{--bg:#f5f6f8;--fg:#1c2230;--sub:#5d6678;--card:#fff;--line:#d3d8e1;--ok:#3a8f5c;--near:#d99a1c;--late:#c8392f;--acc:#2f5fb3;--onacc:#fff;--c-work:#5b7fb8;--c-queue:#d98a2b;--c-appr:#8a63b8;--c-hand:#2f9a96;--c-redo:#c4527a}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141820;--fg:#e8ebf1;--sub:#9aa3b5;--card:#20262f;--line:#38404f;--ok:#58b57e;--near:#e5b04a;--late:#e0605a;--acc:#6f9be3;--onacc:#10151d;--c-work:#7ea0d8;--c-queue:#e8a550;--c-appr:#a98ad6;--c-hand:#52bdb8;--c-redo:#dd7a9c;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#141820;--fg:#e8ebf1;--sub:#9aa3b5;--card:#20262f;--line:#38404f;--ok:#58b57e;--near:#e5b04a;--late:#e0605a;--acc:#6f9be3;--onacc:#10151d;--c-work:#7ea0d8;--c-queue:#e8a550;--c-appr:#a98ad6;--c-hand:#52bdb8;--c-redo:#dd7a9c;color-scheme:dark}
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
.card{position:relative}.card .qc{position:absolute;top:2px;right:4px;font-size:.7rem;color:var(--sub);font-variant-numeric:tabular-nums}.card .qc.mid{color:#fff;background:var(--near);border-radius:6px;padding:0 .3rem;font-weight:700}.card .qc.hi{color:#fff;background:var(--late);border-radius:6px;padding:0 .3rem;font-weight:700}.card .q>span{white-space:nowrap}.card .qd{color:var(--sub);font-size:.72rem}.flowup{margin:.3rem 0;padding:.35rem .6rem;border:1px solid var(--late);border-radius:8px;font-size:.85rem;font-weight:700;color:var(--late);background:var(--card)}
.card .n{color:var(--sub);font-size:.72rem}.card .q{font-size:.78rem;font-variant-numeric:tabular-nums}.lt{color:var(--late);font-weight:700}
.hd{display:inline-flex;align-items:center;gap:.2rem;font-size:.78rem;font-weight:700}.hd.vac{color:var(--late)}.hd.vac .ico{color:var(--late)}
.bar2{display:flex;height:8px;width:100%;border-radius:4px;overflow:hidden;background:var(--line)}.bar2 i{display:block;height:100%}
.detail{margin-top:.4rem;padding:.6rem .8rem;background:var(--card);border:1px solid var(--line);border-radius:8px;font-size:.85rem}
.names{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.4rem}.names>span{display:inline-flex;align-items:center;gap:.2rem;border:1px solid var(--line);border-radius:12px;padding:0 .5rem}.names .hdn{border-color:var(--acc);font-weight:700}
.card.target,.president.target{outline:2px dashed var(--acc);outline-offset:2px;cursor:pointer}
button.president{border:0;font:inherit}
.chip{display:inline-flex;align-items:center;gap:.2rem;border:1px solid var(--line);border-radius:14px;padding:.2rem .6rem;background:var(--card);min-height:40px;cursor:pointer}
.chip.hdn{border-color:var(--acc);font-weight:700}.chip.pk{background:var(--acc);color:var(--onacc);border-color:var(--acc)}.chip.pk .ico{color:var(--onacc)}
.names{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.4rem}
.spanel{margin-top:.5rem;padding:.5rem;border:1px solid var(--acc);border-radius:8px}.sk{font-size:.78rem;color:var(--sub)}
.acts{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}.dacts{border-top:1px dashed var(--line);padding-top:.5rem}
.act{min-height:40px;padding:0 .8rem;border:1px solid var(--line);background:var(--card);border-radius:8px;cursor:pointer;font-size:.85rem}
.newd{display:flex;gap:.3rem;flex-wrap:wrap;width:100%}.newd input{flex:1;min-width:6rem;min-height:40px;border:1px solid var(--line);border-radius:8px;padding:0 .5rem;font:inherit;background:var(--card);color:var(--fg)}
.banner{position:sticky;top:3.4rem;z-index:4;background:var(--acc);color:var(--onacc);padding:.4rem .6rem;border-radius:8px;margin-bottom:.4rem;font-size:.85rem;display:flex;gap:.5rem;align-items:center;justify-content:space-between}
.banner .act{min-height:32px;color:var(--fg)}
.notice{display:flex;gap:.5rem;align-items:center;justify-content:space-between;margin:.3rem 0;padding:.4rem .6rem;border-radius:8px;font-size:.85rem;border:1px solid var(--line);background:var(--card)}.okn{border-color:var(--ok)}.ngn{border-color:var(--late);color:var(--late)}
.steps .sec{font-size:.9rem}
.srow{display:grid;grid-template-columns:3rem 1fr 1fr;gap:.3rem .5rem;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.4rem .5rem;margin-bottom:.4rem;font-size:.8rem}
.srow label{display:flex;flex-direction:column;color:var(--sub);font-size:.7rem}
.srow select{min-height:36px;font:inherit;font-size:.85rem;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
.srow em{grid-column:2/4;font-style:normal;color:var(--sub);font-variant-numeric:tabular-nums}.srow em.jam{color:var(--late);font-weight:700}
.undo-only{margin:.3rem 0}
.undo{min-height:32px;white-space:nowrap}
.mv{font-size:.66rem;color:var(--acc);font-weight:700}.mv.src{color:var(--sub)}
.ovl{font-size:.64rem;color:var(--onacc);background:var(--late);border-radius:6px;padding:0 .3rem}
.ovl.idle{background:var(--sub)}
.srow .afact{grid-column:2/4;font-size:.72rem;color:var(--sub)}.afact.warn{color:var(--late);font-weight:700}
.fact{font-size:.8rem;color:var(--sub);margin:.15rem 0}.fact.warn{color:var(--late);font-weight:700}
.trendh{font-size:.75rem;color:var(--sub);margin-top:.5rem}.trend{display:block;width:100%;height:44px;margin:.4rem 0 0}.trend .ln{fill:none;stroke:var(--fg);stroke-width:1.6;vector-effect:non-scaling-stroke}.trend .bl{fill:none;stroke:var(--sub);stroke-width:1.4;opacity:.7;vector-effect:non-scaling-stroke}.trend .goal{stroke:var(--sub);stroke-dasharray:4 3;stroke-width:1;vector-effect:non-scaling-stroke}
main.has-sheet{padding-bottom:50vh}
.sheet{box-sizing:border-box;position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:100%;max-width:34rem;max-height:46vh;overflow-y:auto;z-index:6;background:var(--card);border-top:2px solid var(--acc);border-radius:14px 14px 0 0;box-shadow:0 -6px 18px #0003;padding:.5rem max(16px,env(safe-area-inset-left,0px)) calc(.8rem + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-right,0px))}
.sheet .detail{margin:0;border:0;padding:0;background:transparent}
.close{position:sticky;top:0;float:right;min-width:40px;min-height:40px;border:1px solid var(--line);border-radius:50%;background:var(--card);font-size:1.3rem;line-height:1;cursor:pointer}
.cause .cbar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--line);margin:.3rem 0}.cbar i{display:block;height:100%}
.cr{display:grid;grid-template-columns:1fr 3rem auto;gap:.5rem;align-items:center;font-size:.85rem;padding:.1rem 0}.cr i,.jdd i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:.35rem}.cr b{text-align:right}.cr em{font-style:normal;color:var(--sub);font-size:.78rem}
.ll{margin-top:.4rem;display:flex;flex-direction:column;gap:.3rem}
.lj{text-align:left;min-height:40px;border:1px solid var(--line);background:var(--card);border-radius:8px;padding:.3rem .6rem;font-size:.82rem;cursor:pointer}.lj.open{border-color:var(--acc)}
.jd{border:1px dashed var(--line);border-radius:8px;padding:.5rem .6rem;font-size:.82rem;display:flex;flex-direction:column;gap:.3rem}.jdd{display:flex;flex-wrap:wrap;gap:.2rem .8rem}
.foot{margin-top:1.2rem;padding-top:.8rem;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.foot textarea{width:100%;box-sizing:border-box;font-size:.75rem;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:8px}
.confirm{display:inline-flex;gap:.4rem;align-items:center;font-size:.85rem}
.hint{font-size:.8rem;color:var(--sub)}
.result{margin-top:1rem;padding:1rem 1.2rem;border-radius:10px;background:var(--card);border:2px solid var(--line)}
.result .cmp{font-size:.9rem}.result h2{margin:0 0 .4rem}.result.success{border-color:var(--ok)}.result.close{border-color:var(--near)}.result.fail{border-color:var(--late)}
.primary{width:100%;min-height:48px;border:0;border-radius:8px;background:var(--acc);color:var(--onacc);font-weight:700;cursor:pointer}
`;
