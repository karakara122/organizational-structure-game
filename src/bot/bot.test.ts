import { describe, expect, it } from "vitest";
import { createInitialWorld, onTimeRate, payroll, TUNING, verdict } from "../sim";
import {
  detectStuck,
  idleBot,
  loopholeBots,
  moverBot,
  playScenario,
  solverBot,
  STANDARD_PROFILE,
} from "./bots";
import { measureBot, startRate } from "./measure";

describe("標準の設定", () => {
  it("シード5つ・90日・5日ごとに行動する(変えたら、この確認と docs/ボットの回し方.md も直す)", () => {
    expect(STANDARD_PROFILE.seeds).toEqual([1, 2, 3, 4, 5]);
    expect(STANDARD_PROFILE.days).toBe(90);
    expect(STANDARD_PROFILE.moverEveryDays).toBe(5);
  });
});

// 仕様書 4章・8章の確認。数字(つまみ)を変えたら、ここが落ちないかを見る。
describe("ゲームとして成り立つか(標準の設定で測る)", () => {
  it("引き継ぎ時の期限内完了率は、約60%(50〜70%)", () => {
    expect(startRate()).toBeGreaterThan(0.5);
    expect(startRate()).toBeLessThan(0.7);
  });

  it("何もしないと、失敗する(平均65%未満)", () => {
    const m = measureBot(idleBot);
    expect(m.mean).toBeLessThan(0.65);
    expect(m.verdicts.success).toBe(0);
  });

  it("うまく直せば、成功する(見本の直し方は、全部のシードで成功)", () => {
    const m = measureBot(solverBot);
    expect(m.verdicts.success).toBe(STANDARD_PROFILE.seeds.length);
    expect(m.stuck).toBeNull();
  });

  it("1つの操作だけで全部解決する抜け道が無い(極端な形はどれも、平均80%未満)", () => {
    for (const bot of loopholeBots) {
      const m = measureBot(bot);
      expect(m.mean, bot.name).toBeLessThan(0.8);
    }
  });

  it("人件費の上限は、実際に効く:見本の直し方は、あと少ししか部署長を増やせない", () => {
    const w = createInitialWorld(1);
    playScenario(w, solverBot, 1);
    // 見本の直し方のあと、上限までの余裕は、部署長を増やす分(+2.0)より小さい
    expect(w.payrollCap - payroll(w)).toBeLessThan(TUNING.salaryHead - TUNING.salaryStaff);
  });

  it("主要な数字が0や100%に張り付いていない(見本の直し方の途中経過)", () => {
    const w = createInitialWorld(1);
    playScenario(w, solverBot, 45);
    const rate = onTimeRate(w)!;
    expect(rate).toBeGreaterThan(0.05);
    expect(rate).toBeLessThan(0.999);
  });

  it("何もしないと、承認待ちが社長のところにたまる", () => {
    const w = createInitialWorld(1);
    playScenario(w, idleBot, 45);
    expect(w.records[w.records.length - 1]!.approvalWaiting).toBeGreaterThan(5);
  });

  it("人を動かすボットは、結果を良くしない(人を動かすだけでは解決しない)", () => {
    const mover = measureBot(moverBot);
    expect(mover.mean).toBeLessThan(measureBot(solverBot).mean);
  });

  it("成功・惜しい・失敗の判定が、人件費の上限をこえると失敗になる", () => {
    const w = createInitialWorld(1);
    playScenario(w, solverBot);
    expect(verdict(w, w.payrollCap + 1)).toBe("fail");
  });

  it("「止まった」を検出して理由を返す(承認を全部部署長にすると、制作部が承認できず止まる)", () => {
    const stuckBot = loopholeBots.find((b) => b.name.includes("全部、部署長"))!;
    const w = createInitialWorld(1);
    playScenario(w, stuckBot);
    expect(detectStuck(w)?.reason).toContain("完了が15日続けて0");
  });
});
