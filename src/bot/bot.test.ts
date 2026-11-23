import { describe, expect, it } from "vitest";
import { arrivalMultiplier, createInitialWorld, onTimeRate, payroll, stepDay, SURGES, TUNING, verdict } from "../sim";
import {
  detectStuck,
  idleBot,
  loopholeBots,
  moverBot,
  observerBot,
  CHECK_SEEDS,
  playScenario,
  reactBot,
  solverBot,
  STANDARD_PROFILE,
} from "./bots";
import { createDept, setStepOwner } from "../sim";
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

  it("見本の直し方で放置すると、繁忙期のせいで成功と失敗の境目になる(成功は5シード中2〜3)", () => {
    const m = measureBot(solverBot);
    expect(m.verdicts.success).toBeGreaterThanOrEqual(2);
    expect(m.verdicts.success).toBeLessThanOrEqual(3);
    expect(m.stuck).toBeNull();
  });

  it("繁忙期に途中で対応すると、放置より10ポイント以上良くなる(途中の操作に意味がある)", () => {
    const react = measureBot(reactBot);
    const hold = measureBot(solverBot);
    expect(react.mean - hold.mean).toBeGreaterThanOrEqual(0.1);
    expect(react.stuck).toBeNull();
  });

  it("日付を知らず、画面の手がかりだけで対応しても、放置より良い(標準のシードでも検証用のシードでも)。日付を知る対応よりは少し劣る", () => {
    for (const seeds of [STANDARD_PROFILE.seeds, CHECK_SEEDS]) {
      const hold = measureBot(solverBot, seeds);
      const watch = measureBot(observerBot, seeds);
      const know = measureBot(reactBot, seeds);
      expect(watch.mean - hold.mean).toBeGreaterThanOrEqual(0.03);
      expect(know.mean).toBeGreaterThan(watch.mean);
    }
  });

  it("繁忙期の間は、その種類の業務の発生が増える(5シードの合計)", () => {
    const sg = SURGES[0]!;
    expect(arrivalMultiplier(sg.kind, sg.fromDay - 1)).toBe(1);
    expect(arrivalMultiplier(sg.kind, sg.fromDay)).toBe(sg.multiplier);
    expect(arrivalMultiplier(sg.kind, sg.toDay)).toBe(sg.multiplier);
    expect(arrivalMultiplier(sg.kind, sg.toDay + 1)).toBe(1);
    const count = (from: number, to: number): number => {
      let n = 0;
      for (const seed of STANDARD_PROFILE.seeds) {
        const w = createInitialWorld(seed);
        for (let d = 1; d <= to; d++) {
          const r = stepDay(w);
          if (d >= from) n += r.arrived;
        }
      }
      return n;
    };
    const len = sg.toDay - sg.fromDay + 1;
    // 繁忙期のある期間の発生は、すぐ前の同じ長さの期間より多い
    expect(count(sg.fromDay, sg.toDay)).toBeGreaterThan(count(sg.fromDay - len, sg.fromDay - 1));
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

  it("「止まった」を検出して理由を返す(制作の担当を、職員のいない部署にすると止まる)", () => {
    const stuckBot = {
      name: "制作の担当を空の部署にする",
      act(w: ReturnType<typeof createInitialWorld>) {
        if (w.day !== 0) return;
        const made = createDept(w, "空の部署", null);
        if (!made.ok || made.id === undefined) throw new Error("部署を作れない");
        setStepOwner(w, "produce", made.id);
      },
    };
    const w = createInitialWorld(1);
    playScenario(w, stuckBot);
    expect(detectStuck(w)?.reason).toContain("完了が15日続けて0");
  });

  it("承認を全部、部署長にしても、承認は先に時間を取るので止まらず、見本の直し方よりは悪い", () => {
    const all = loopholeBots.find((b) => b.name.includes("全部、部署長"))!;
    const w = createInitialWorld(1);
    playScenario(w, all);
    expect(detectStuck(w)).toBeNull();
    expect(measureBot(all).mean).toBeLessThan(measureBot(solverBot).mean);
  });
});
