import { GAME_TITLE } from "./config";
import { createInitialWorld, isScenarioOver, stepDay } from "./sim";
import type { World } from "./sim";
import { STYLE, render } from "./ui/view";
import type { Speed } from "./ui/view";

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
  let speed: Speed = "pause"; // 始めるときは一時停止
  let selected: number | null = null;
  let timer: number | undefined;

  const draw = (): void => {
    app.innerHTML = render(world, speed, selected);
  };
  const schedule = (): void => {
    window.clearInterval(timer);
    const ms = INTERVAL[speed];
    if (ms === null) return;
    timer = window.setInterval(() => {
      if (isScenarioOver(world)) {
        speed = "pause";
        schedule();
      } else {
        stepDay(world);
      }
      draw();
    }, ms);
  };

  app.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const sp = t.closest<HTMLElement>("[data-speed]");
    if (sp) {
      speed = sp.dataset.speed as Speed;
      schedule();
    } else if (t.closest("[data-act=restart]")) {
      world = createInitialWorld(SEED);
      speed = "pause";
      selected = null;
      schedule();
    } else {
      const d = t.closest<HTMLElement>("[data-dept]");
      if (d) selected = Number(d.dataset.dept);
    }
    draw();
  });
  draw();
}
