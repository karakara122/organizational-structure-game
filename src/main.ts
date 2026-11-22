import { GAME_TITLE } from "./config";
import {
  assignStaff,
  createDept,
  createInitialWorld,
  deleteDept,
  getStaff,
  isScenarioOver,
  setApproval,
  setHead,
  setParent,
  setStepOwner,
  stepDay,
  STEP_LABEL,
} from "./sim";
import type { ActionResult, ApprovalChoice, Step, World } from "./sim";
import { setupDrag } from "./ui/drag";
import type { DragSource, DropTarget } from "./ui/drag";
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

  let world: World = createInitialWorld(SEED);
  const ui: UiState = { speed: "pause", selected: null, picked: [], canUndo: false, mode: "none", notice: null };

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
    if (typing() || drag.busy) return;
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
      }
      draw();
    }, ms);
  };

  const say = (r: ActionResult, okText: string): void => {
    ui.notice = r.ok ? { ok: true, text: okText } : { ok: false, text: r.reason };
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
      schedule();
      return true;
    }
    const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "restart") {
      world = createInitialWorld(SEED);
      Object.assign(ui, { speed: "pause", selected: null, picked: [], canUndo: false, mode: "none", notice: null });
      undoStack.length = 0;
      schedule();
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
    if (act === "move" && ui.picked.length > 0) {
      ui.mode = "move";
      ui.notice = null;
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
      if (ui.mode === "move" && ui.picked.length > 0) {
        moveStaff(ui.picked, id);
        ui.mode = "none";
        ui.picked = [];
        return true; // 元の部署を開いたままにする
      }
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

  /** ドラッグして落としたときの操作 */
  const onDrop = (src: DragSource, target: DropTarget): void => {
    if (src.kind === "staff") {
      if (target.kind !== "dept") return;
      const sid = Number(src.id);
      // 選んである職員をつかんだときは、選んである全員を運ぶ
      const ids = ui.picked.includes(sid) ? ui.picked : [sid];
      const s = getStaff(world, sid);
      if (ids.length === 1 && s.deptId === target.id) {
        change(() => setHead(world, target.id, s.id), `${s.name}を${deptName(target.id)}の部署長にしました`);
      } else {
        moveStaff(ids, target.id);
        ui.picked = [];
      }
      // 動かした元の部署を開いたままにする
    } else if (src.kind === "dept") {
      const id = Number(src.id);
      if (target.kind === "root") change(() => setParent(world, id, null), `${deptName(id)}を一番上(社長の直下)にしました`);
      else if (target.id === id) return;
      else change(() => setParent(world, id, target.id), `${deptName(id)}を${deptName(target.id)}の下に置きました`);
    } else {
      const step = src.id as Step;
      if (target.kind !== "dept") return;
      change(() => setStepOwner(world, step, target.id), `${STEP_LABEL[step]}の担当を${deptName(target.id)}にしました`);
    }
    ui.mode = "none";
  };
  const drag = setupDrag(app, onDrop, () => draw(), (src, label) => (src.kind === "staff" && ui.picked.length > 1 && ui.picked.includes(Number(src.id)) ? `${ui.picked.length}人` : label));

  // 日が進んで画面が描き直されても押し損ねないよう、指を離した時点で操作する
  app.addEventListener("pointerup", (e) => {
    if (e.button !== 0 || drag.active) return;
    if (handle(e.target as HTMLElement)) draw();
  });
  // キーボード(Enter)は click で受ける。マウス・タッチの click は pointerup で済んでいる
  app.addEventListener("click", (e) => {
    if (e.detail === 0 && handle(e.target as HTMLElement)) draw();
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
    draw();
  });
  draw();
}
