import { GAME_TITLE } from "./config";
import {
  assignStaff,
  createDept,
  createInitialWorld,
  deleteDept,
  getStaff,
  finalOnTimeRate,
  isScenarioOver,
  setApproval,
  setHead,
  setParent,
  setStepOwner,
  stepDay,
  STEP_LABEL,
} from "./sim";
import type { ActionResult, ApprovalChoice, Step, World } from "./sim";
import { formatLog } from "./ui/log";
import { clearSave, loadGame, saveGame } from "./ui/save";
import type { LogEntry } from "./ui/save";
import { STYLE, render } from "./ui/view";
import type { Speed, UiState } from "./ui/view";

/** 標準のシード(仮)。決め方は遊んでから相談する。 */
const SEED = 1;
/** 1日進める間隔(ミリ秒) */
const INTERVAL: Record<Speed, number | null> = { pause: null, normal: 700, fast: 120 };

const app = document.getElementById("app");
if (app) {
  document.title = GAME_TITLE;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);

  // 保存してあれば続きから。なければ最初から
  const saved = loadGame();
  let world: World = saved?.world ?? createInitialWorld(SEED);
  const log: LogEntry[] = saved?.log ?? [];
  const ui: UiState = {
    speed: "pause",
    selected: null,
    picked: [],
    canUndo: false,
    mode: "none",
    notice: saved && saved.world.day > 0 ? { ok: true, text: `前回の続きです(${saved.world.day}日目)。` } : null,
    showLate: false,
    openJob: null,
    confirmReset: false,
    copyText: null,
  };
  const logAdd = (kind: LogEntry["kind"], text: string): void => {
    log.push({ day: world.day, kind, text });
    if (log.length > 2000) log.shift();
  };
  const persist = (): void => saveGame(world, log);
  if (!saved) logAdd("開始", `シード ${SEED} で最初から`);

  // 元に戻す: 組織の形(職員の所属・部署・担当・承認)だけを、直前の状態に戻す。進んだ日数や業務は戻らない
  type OrgSnap = Pick<World, "staff" | "depts" | "stepOwner" | "approval" | "nextDeptId">;
  const undoStack: OrgSnap[] = [];
  const snapOrg = (): OrgSnap =>
    structuredClone({ staff: world.staff, depts: world.depts, stepOwner: world.stepOwner, approval: world.approval, nextDeptId: world.nextDeptId });
  /** 組織を変える操作は、ここを通す(成功したときだけ、元に戻せるよう記録する) */
  const change = (fn: () => ActionResult, okText: string): ActionResult => {
    const before = snapOrg();
    const r = fn();
    if (r.ok) {
      undoStack.push(before);
      if (undoStack.length > 30) undoStack.shift();
      ui.canUndo = true;
    }
    say(r, okText);
    return r;
  };
  let timer: number | undefined;
  let resultShown = false;

  const typing = (): boolean => {
    const a = document.activeElement;
    return !!a && app.contains(a) && (a.tagName === "SELECT" || a.tagName === "INPUT");
  };
  /** 入力や選択の途中は、画面を描き直さない(日は進み続ける) */
  /** 組織図の幅が画面より広いときは、縮めて収める(下限0.6。それでも広ければ横にスクロール) */
  const fitChart = (): void => {
    const chart = app.querySelector<HTMLElement>(".chart");
    const inner = chart?.firstElementChild as HTMLElement | null;
    if (!chart || !inner) return;
    inner.style.zoom = "";
    const need = inner.scrollWidth;
    const have = chart.clientWidth;
    if (need > have) inner.style.zoom = String(Math.max(0.6, have / need));
  };
  const draw = (): void => {
    if (typing()) return;
    app.innerHTML = render(world, ui);
    fitChart();
    // 90日が終わったとき、結果が見える所まで1回だけスクロールする
    const over = isScenarioOver(world);
    if (over && !resultShown) app.querySelector(".result")?.scrollIntoView({ block: "center", behavior: "smooth" });
    resultShown = over;
  };
  const schedule = (): void => {
    window.clearInterval(timer);
    const ms = INTERVAL[ui.speed];
    if (ms === null) return;
    timer = window.setInterval(() => {
      if (isScenarioOver(world)) {
        ui.speed = "pause";
        schedule();
      } else {
        stepDay(world);
        if (isScenarioOver(world)) logAdd("結果", `90日が終わりました(期限内完了率 ${Math.round((finalOnTimeRate(world) ?? 0) * 100)}%)`);
        persist();
      }
      draw();
    }, ms);
  };

  const say = (r: ActionResult, okText: string): void => {
    ui.notice = r.ok ? { ok: true, text: okText } : { ok: false, text: r.reason };
    logAdd(r.ok ? "操作" : "失敗", ui.notice.text);
  };
  const deptName = (id: number): string => world.depts.find((d) => d.id === id)?.name ?? "";

  /** 職員(複数でもよい)を部署に移す */
  const moveStaff = (ids: number[], toDeptId: number): void => {
    const movers = ids.filter((id) => getStaff(world, id).deptId !== toDeptId);
    if (movers.length === 0) {
      ui.notice = { ok: false, text: "もう、その部署にいます" };
      return;
    }
    const who = movers.length === 1 ? getStaff(world, movers[0]!).name : `${movers.length}人`;
    change(() => {
      for (const id of movers) {
        const r = assignStaff(world, id, toDeptId);
        if (!r.ok) return r;
      }
      return { ok: true };
    }, `${who}を${deptName(toDeptId)}に移しました(数日は慣れるまで能率が下がります)`);
  };

  /** タップされたものに応じて、操作する */
  const handle = (t: HTMLElement): boolean => {
    const sp = t.closest<HTMLElement>("[data-speed]");
    if (sp) {
      ui.speed = sp.dataset.speed as Speed;
      logAdd("速度", { pause: "停止", normal: "通常", fast: "高速" }[ui.speed]);
      schedule();
      return true;
    }
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "restart" || act === "reset-yes") {
      world = createInitialWorld(SEED);
      log.length = 0;
      logAdd("開始", `シード ${SEED} で最初から`);
      Object.assign(ui, { speed: "pause", selected: null, picked: [], canUndo: false, mode: "none", notice: null, showLate: false, openJob: null, confirmReset: false, copyText: null });
      undoStack.length = 0;
      clearSave();
      persist();
      schedule();
      return true;
    }
    if (act === "reset") {
      ui.confirmReset = true;
      return true;
    }
    if (act === "reset-no") {
      ui.confirmReset = false;
      return true;
    }
    if (act === "late") {
      ui.showLate = !ui.showLate;
      ui.openJob = null;
      return true;
    }
    if (act === "copylog") {
      const text = formatLog(world, log);
      const lines = text.split("\n").length;
      const fallback = (): void => {
        ui.speed = "pause"; // 選んだ文字が、描き直しで消えないように止める
        schedule();
        ui.copyText = text;
        draw();
      };
      try {
        void navigator.clipboard.writeText(text).then(
          () => {
            ui.copyText = null;
            ui.notice = { ok: true, text: `記録をコピーしました(${lines}行)。チャットに貼ってください。` };
            draw();
          },
          fallback,
        );
      } catch {
        fallback();
      }
      return true;
    }
    if (act === "close") {
      ui.selected = null;
      ui.picked = [];
      ui.mode = "none";
      return true;
    }
    if (act === "cancel") {
      ui.mode = "none";
      return true;
    }
    if (act === "undo") {
      const prev = undoStack.pop();
      if (prev) {
        Object.assign(world, prev);
        ui.notice = { ok: true, text: "1つ前の組織の形に戻しました" };
        logAdd("操作", "1つ前の組織の形に戻しました");
        ui.picked = [];
        if (ui.selected !== null && !world.depts.some((d) => d.id === ui.selected)) ui.selected = null;
      }
      ui.canUndo = undoStack.length > 0;
      return true;
    }
    if (act === "clear") {
      ui.picked = [];
      return true;
    }
    if ((act === "head" || act === "unhead") && ui.picked.length === 1) {
      const s = getStaff(world, ui.picked[0]!);
      change(
        () => setHead(world, s.deptId, act === "head" ? s.id : null),
        act === "head" ? `${s.name}を${deptName(s.deptId)}の部署長にしました` : `${deptName(s.deptId)}の部署長を空席にしました`,
      );
      return true;
    }
    if (act === "create" && ui.selected !== null) {
      const input = document.getElementById("newname") as HTMLInputElement | null;
      const name = (input?.value ?? "").trim() || `新部署${world.nextDeptId}`;
      // 作ったあとも、今の部署を開いたままにする(続けて職員を移せるように)
      change(() => createDept(world, name, ui.selected!), `「${name}」を${deptName(ui.selected)}の下に作りました`);
      return true;
    }
    if (act === "reparent" && ui.selected !== null) {
      ui.mode = "reparent";
      ui.notice = null;
      return true;
    }
    if (act === "delete" && ui.selected !== null) {
      const name = deptName(ui.selected);
      const r = change(() => deleteDept(world, ui.selected!), `${name}を無くしました`);
      if (r.ok) ui.selected = null;
      return true;
    }
    if (t.closest("[data-root]") && ui.mode === "reparent" && ui.selected !== null) {
      const sel = ui.selected;
      change(() => setParent(world, sel, null), `${deptName(sel)}を一番上(社長の直下)にしました`);
      ui.mode = "none";
      return true;
    }
    const jb = t.closest<HTMLElement>("[data-job]");
    if (jb) {
      const id = Number(jb.dataset.job);
      ui.openJob = ui.openJob === id ? null : id;
      return true;
    }
    const st = t.closest<HTMLElement>("[data-staff]");
    if (st) {
      // タップするたびに、選ぶ/選ぶのをやめる(複数人を選べる)
      const id = Number(st.dataset.staff);
      ui.picked = ui.picked.includes(id) ? ui.picked.filter((x) => x !== id) : [...ui.picked, id];
      ui.mode = "none";
      return true;
    }
    const d = t.closest<HTMLElement>("[data-dept]");
    if (d) {
      const id = Number(d.dataset.dept);
      // 職員を選んであるときは、別の部署のカードをタップすると、そこへ移す(元の部署は開いたまま)
      if (ui.picked.length > 0 && id !== ui.selected) {
        moveStaff(ui.picked, id);
        ui.picked = [];
        return true;
      }
      if (ui.picked.length > 0 && id === ui.selected) return true;
      if (ui.mode === "reparent" && ui.selected !== null) {
        if (id === ui.selected) return true;
        const sel = ui.selected;
        change(() => setParent(world, sel, id), `${deptName(sel)}を${deptName(id)}の下に置きました`);
        ui.mode = "none";
        return true;
      }
      ui.notice = null;
      if (ui.selected !== id) ui.picked = [];
      ui.selected = id;
      return true;
    }
    return false;
  };

  // 日が進んで画面が描き直されても押し損ねないよう、指を離した時点で操作する
  app.addEventListener("pointerup", (e) => {
    if (e.button !== 0) return;
    // 入力欄の外をタップしたら、入力を終わらせる(入力中は画面を描き直さないため)
    const a = document.activeElement as HTMLElement | null;
    if (a && (a.tagName === "INPUT" || a.tagName === "SELECT") && !(e.target as HTMLElement).closest("input,select")) a.blur();
    if (handle(e.target as HTMLElement)) {
      persist();
      draw();
    }
  });
  // キーボード(Enter)は click で受ける。マウス・タッチの click は pointerup で済んでいる
  app.addEventListener("click", (e) => {
    if (e.detail === 0 && handle(e.target as HTMLElement)) {
      persist();
      draw();
    }
  });
  app.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.owner) {
      const step = el.dataset.owner as Step;
      change(() => setStepOwner(world, step, Number(el.value)), `${STEP_LABEL[step]}の担当を${deptName(Number(el.value))}にしました`);
    } else if (el.dataset.appr) {
      const step = el.dataset.appr as Step;
      change(() => setApproval(world, step, el.value as ApprovalChoice), `${STEP_LABEL[step]}の承認を変えました`);
    } else return;
    el.blur();
    persist();
    draw();
  });
  draw();
}
