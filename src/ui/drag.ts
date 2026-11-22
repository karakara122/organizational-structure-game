// ドラッグ&ドロップ(画面の操作だけ。計算は src/sim/ の actions が行う)。
// マウス: 少し動かすと始まる。タッチ: 長押し(0.3秒)で始まる(ふつうのスクロールと区別するため)。
// 始まる印は data-drag="staff|dept|step"、落とせる所は data-dept と data-root。

export type DragSource = { kind: "staff" | "dept" | "step"; id: string };
export type DropTarget = { kind: "dept"; id: number } | { kind: "root" };

const MOUSE_MOVE_PX = 6;
const TOUCH_HOLD_MS = 300;
const TOUCH_CANCEL_PX = 10;

export interface DragHandle {
  /** ドラッグが始まっているか(この間の指を離す操作は、タップとして扱わない) */
  readonly active: boolean;
  /** 指を置いてから離すまでの間か。この間は画面を描き直さない(押している物が消えると、指の動きが届かなくなるため) */
  readonly busy: boolean;
}

export function setupDrag(
  app: HTMLElement,
  onDrop: (src: DragSource, target: DropTarget) => void,
  onEnd: () => void,
  labelOf: (src: DragSource, label: string) => string = (_s, l) => l,
): DragHandle {
  let pending: { src: DragSource; label: string; x: number; y: number; pointerId: number; touch: boolean; timer?: number } | null = null;
  let ghost: HTMLElement | null = null;
  let hover: Element | null = null;
  const handle = {
    active: false,
    get busy(): boolean {
      return pending !== null;
    },
  };

  const start = (x: number, y: number): void => {
    if (!pending) return;
    handle.active = true;
    app.classList.add("dragging");
    ghost = document.createElement("div");
    ghost.className = "ghost";
    ghost.textContent = labelOf(pending.src, pending.label);
    document.body.appendChild(ghost);
    move(x, y);
    raf = requestAnimationFrame(autoScroll);
  };

  // 画面の上下の端に近づけたら、自動でスクロールする(ドラッグ中は指でスクロールできないため)
  let lastY = 0;
  let raf = 0;
  const EDGE_PX = 90;
  const autoScroll = (): void => {
    if (!handle.active) return;
    const top = EDGE_PX + 40; // 上は、固定の帯のぶん広く取る
    if (lastY < top) window.scrollBy(0, -Math.max(4, Math.ceil((top - lastY) / 3)));
    else if (!document.querySelector(".sheet") && lastY > window.innerHeight - EDGE_PX) window.scrollBy(0, Math.max(4, Math.ceil((lastY - (window.innerHeight - EDGE_PX)) / 3)));
    // スクロールで下にある物が変わるので、落とし先の強調も付け直す
    move(lastX, lastY);
    raf = requestAnimationFrame(autoScroll);
  };
  let lastX = 0;

  const targetAt = (x: number, y: number): Element | null => {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest("[data-dept],[data-root]") : null;
  };

  const move = (x: number, y: number): void => {
    if (!ghost) return;
    lastX = x;
    lastY = y;
    ghost.style.left = `${x}px`;
    ghost.style.top = `${y}px`;
    const t = targetAt(x, y);
    if (t !== hover) {
      hover?.classList.remove("drop");
      t?.classList.add("drop");
      hover = t;
    }
  };

  const cleanup = (): void => {
    cancelAnimationFrame(raf);
    if (pending?.timer) window.clearTimeout(pending.timer);
    pending = null;
    ghost?.remove();
    ghost = null;
    hover?.classList.remove("drop");
    hover = null;
    app.classList.remove("dragging");
    handle.active = false;
  };

  app.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-drag]");
    if (!el) return;
    const touch = e.pointerType !== "mouse";
    pending = {
      src: { kind: el.dataset.drag as DragSource["kind"], id: el.dataset.id ?? "" },
      label: el.dataset.label ?? el.textContent?.trim() ?? "",
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      touch,
    };
    if (touch) {
      const x = e.clientX;
      const y = e.clientY;
      pending.timer = window.setTimeout(() => start(x, y), TOUCH_HOLD_MS);
    }
  });

  document.addEventListener("pointermove", (e) => {
    if (!pending || e.pointerId !== pending.pointerId) return;
    if (handle.active) {
      move(e.clientX, e.clientY);
      return;
    }
    const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
    if (pending.touch) {
      // 長押しの前に動いた = スクロール。ドラッグにしない
      if (dist > TOUCH_CANCEL_PX) {
        cleanup();
        onEnd();
      }
    } else if (dist > MOUSE_MOVE_PX) {
      start(e.clientX, e.clientY);
    }
  });

  document.addEventListener("pointerup", (e) => {
    if (!pending || e.pointerId !== pending.pointerId) return;
    if (handle.active) {
      const src = pending.src;
      const t = targetAt(e.clientX, e.clientY) as HTMLElement | null;
      cleanup();
      if (t) {
        if (t.dataset.root !== undefined) onDrop(src, { kind: "root" });
        else if (t.dataset.dept !== undefined) onDrop(src, { kind: "dept", id: Number(t.dataset.dept) });
      }
      onEnd();
    } else {
      cleanup();
      onEnd();
    }
  });

  document.addEventListener("pointercancel", () => {
    if (pending) {
      cleanup();
      onEnd();
    }
  });

  // ドラッグ中は、画面のスクロールを止める(タッチ)
  document.addEventListener(
    "touchmove",
    (e) => {
      if (handle.active) e.preventDefault();
    },
    { passive: false },
  );
  // 長押しのメニューや文字の選択を出さない
  app.addEventListener("contextmenu", (e) => {
    if ((e.target as HTMLElement).closest("[data-drag]")) e.preventDefault();
  });

  return handle;
}
