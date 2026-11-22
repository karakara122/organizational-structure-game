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
  const ui: UiState = { speed: "pause", selected: null, picked: null, mode: "none", notice: null };
  let timer: number | undefined;

  const typing = (): boolean => {
    const a = document.activeElement;
    return !!a && app.contains(a) && (a.tagName === "SELECT" || a.tagName === "INPUT");
  };
  /** 入力や選択の途中は、画面を描き直さない(日は進み続ける) */
  const draw = (): void => {
    if (typing()) return;
    app.innerHTML = render(world, ui);
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
      Object.assign(ui, { speed: "pause", selected: null, picked: null, mode: "none", notice: null });
      schedule();
      return true;
    }
    if (act === "cancel") {
      ui.mode = "none";
      return true;
    }
    if (act === "move" && ui.picked !== null) {
      ui.mode = "move";
      ui.notice = null;
      return true;
    }
    if ((act === "head" || act === "unhead") && ui.picked !== null) {
      const s = getStaff(world, ui.picked);
      const r = setHead(world, s.deptId, act === "head" ? s.id : null);
      say(r, act === "head" ? `${s.name}を${deptName(s.deptId)}の部署長にしました` : `${deptName(s.deptId)}の部署長を空席にしました`);
      return true;
    }
    if (act === "create" && ui.selected !== null) {
      const input = document.getElementById("newname") as HTMLInputElement | null;
      const name = (input?.value ?? "").trim() || "新しい部署";
      const r = createDept(world, name, ui.selected);
      say(r, `「${name}」を${deptName(ui.selected)}の下に作りました`);
      if (r.ok && r.id !== undefined) ui.selected = r.id;
      return true;
    }
    if (act === "reparent" && ui.selected !== null) {
      ui.mode = "reparent";
      ui.notice = null;
      return true;
    }
    if (act === "delete" && ui.selected !== null) {
      const name = deptName(ui.selected);
      const r = deleteDept(world, ui.selected);
      say(r, `${name}を無くしました`);
      if (r.ok) ui.selected = null;
      return true;
    }
    if (t.closest("[data-root]") && ui.mode === "reparent" && ui.selected !== null) {
      say(setParent(world, ui.selected, null), `${deptName(ui.selected)}を一番上(社長の直下)にしました`);
      ui.mode = "none";
      return true;
    }
    const st = t.closest<HTMLElement>("[data-staff]");
    if (st) {
      ui.picked = ui.picked === Number(st.dataset.staff) ? null : Number(st.dataset.staff);
      ui.mode = "none";
      return true;
    }
    const d = t.closest<HTMLElement>("[data-dept]");
    if (d) {
      const id = Number(d.dataset.dept);
      if (ui.mode === "move" && ui.picked !== null) {
        const s = getStaff(world, ui.picked);
        say(assignStaff(world, s.id, id), `${s.name}を${deptName(id)}に移しました(数日は慣れるまで能率が下がります)`);
        ui.mode = "none";
        ui.picked = null;
      } else if (ui.mode === "reparent" && ui.selected !== null) {
        if (id === ui.selected) return true;
        say(setParent(world, ui.selected, id), `${deptName(ui.selected)}を${deptName(id)}の下に置きました`);
        ui.mode = "none";
        return true;
      } else {
        ui.notice = null;
        if (ui.picked !== null && getStaff(world, ui.picked).deptId !== id) ui.picked = null;
      }
      ui.selected = id;
      return true;
    }
    return false;
  };

  // 日が進んで画面が描き直されても押し損ねないよう、指を離した時点で操作する
  app.addEventListener("pointerup", (e) => {
    if (e.button !== 0) return;
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
      say(setStepOwner(world, step, Number(el.value)), `${STEP_LABEL[step]}の担当を${deptName(Number(el.value))}にしました`);
    } else if (el.dataset.appr) {
      const step = el.dataset.appr as Step;
      setApproval(world, step, el.value as ApprovalChoice);
      ui.notice = { ok: true, text: `${STEP_LABEL[step]}の承認を変えました` };
    } else return;
    el.blur();
    draw();
  });
  draw();
}
