// 自動保存(ブラウザの中)。保存先の名前は src/config.ts の SAVE_KEY。名前に版の番号を入れない。
// 保存する形が変わったときは、中の format を見て、古いものは捨てる。
import { SAVE_KEY } from "../config";
import type { World } from "../sim";

export interface LogEntry {
  day: number;
  kind: "開始" | "操作" | "失敗" | "速度" | "結果";
  text: string;
}

const FORMAT = 1;

interface Saved {
  format: number;
  world: World;
  log: LogEntry[];
}

/** 保存したものを読む。無い・壊れている・形が古いときは null */
export function loadGame(): { world: World; log: LogEntry[] } | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Saved>;
    const w = d.world;
    if (d.format !== FORMAT || !w || typeof w.day !== "number" || !Array.isArray(w.staff) || !Array.isArray(w.depts) || !Array.isArray(w.jobs)) {
      return null;
    }
    return { world: w, log: Array.isArray(d.log) ? d.log : [] };
  } catch {
    return null;
  }
}

export function saveGame(world: World, log: LogEntry[]): void {
  try {
    const data: Saved = { format: FORMAT, world, log };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // 保存できない環境(プライベートモードなど)でも、遊べるようにしておく
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // 何もしない
  }
}
