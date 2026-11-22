import { describe, expect, it } from "vitest";
import { causeSummary, createInitialWorld, lateDays, lateJobs, runDays } from "../sim";
import { formatLog } from "./log";

describe("遅れの原因とプレイ記録", () => {
  const w = createInitialWorld(1);
  runDays(w, 90);

  it("遅れた業務は、遅れの大きい順に並び、内訳の合計が合う", () => {
    const jobs = lateJobs(w);
    expect(jobs.length).toBeGreaterThan(0);
    for (let i = 1; i < jobs.length; i++) {
      expect(lateDays(jobs[i - 1]!, w.day)).toBeGreaterThanOrEqual(lateDays(jobs[i]!, w.day));
    }
    const c = causeSummary(w);
    expect(c.count).toBe(jobs.length);
    expect(c.days.work).toBe(jobs.reduce((a, j) => a + j.days.work, 0));
    expect(c.days.queue).toBe(jobs.reduce((a, j) => a + j.days.queue, 0));
  });

  it("期限内に終わった業務は、遅れた業務に入らない", () => {
    for (const j of lateJobs(w)) {
      expect(j.doneDay === null || j.doneDay > j.deadlineDay).toBe(true);
    }
  });

  it("記録の文字に、組織・遅れの原因・操作・日ごとの数字が入る", () => {
    const text = formatLog(w, [{ day: 3, kind: "操作", text: "テストの操作" }]);
    expect(text).toContain("## 今の組織");
    expect(text).toContain("## 遅れの原因");
    expect(text).toContain("3日目 [操作] テストの操作");
    const rows = text.split("## 日ごとの数字")[1]!.trim().split("\n").filter((l) => /^\d+,/.test(l));
    expect(rows.length).toBe(w.records.length);
  });

  it("客からの差し戻し・承認で見つかった回数が、記録される", () => {
    const all = [...w.jobs, ...w.finished];
    expect(all.some((j) => j.returns > 0 || j.caught > 0)).toBe(true);
  });
});
