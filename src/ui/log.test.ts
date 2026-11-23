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

import { approvalLoad, approvalSqueeze, canWork, createDept, manageLoad, queueDays, recentFlow, assignStaff, stepDay } from "../sim";

describe("画面に見せる事実の数字", () => {
  it("制作部は、部下13人に対して管理の目安は9人", () => {
    const w = createInitialWorld(1);
    const ml = manageLoad(w, w.stepOwner.produce)!;
    expect(ml.subordinates).toBe(13);
    expect(ml.capacity).toBe(9);
  });
  it("社長の直下に作った部署の職員は、作業できない", () => {
    const w = createInitialWorld(1);
    const made = createDept(w, "別", null);
    if (!made.ok || made.id === undefined) throw new Error("部署が作れません");
    const newId = made.id;
    const s = w.staff.find((x) => x.deptId === w.stepOwner.produce && !w.depts.some((d) => d.headId === x.id))!;
    assignStaff(w, s.id, newId);
    expect(canWork(w, newId)).toBe(false);
    expect(canWork(w, w.stepOwner.produce)).toBe(true);
  });
  it("承認を部署長にすると、承認者の処理の目安が社長より小さい", () => {
    const w = createInitialWorld(1);
    w.approval.produce = "head";
    const head = approvalLoad(w, "produce")!;
    w.approval.produce = "above";
    const pres = approvalLoad(w, "produce")!;
    expect(head.perDay).toBeLessThan(pres.perDay);
    w.approval.produce = "none";
    expect(approvalLoad(w, "produce")).toBeNull();
  });
  it("承認待ちが増えると、管理に使える時間が減ったことが分かる(承認を先に取る)", () => {
    const w = createInitialWorld(1);
    const sub = createDept(w, "下", w.stepOwner.produce);
    if (!sub.ok) throw new Error("部署が作れません");
    // 制作部の部下を管理の目安ぎりぎり(9人)にしてから、承認待ちをためる
    const head = w.depts.find((d) => d.id === w.stepOwner.produce)!.headId!;
    const members = w.staff.filter((x) => x.deptId === w.stepOwner.produce && x.id !== head);
    for (const m of members.slice(0, members.length - 9)) assignStaff(w, m.id, w.stepOwner.estimate);
    w.approval.produce = "head";
    expect(approvalSqueeze(w, w.stepOwner.produce)!.squeezed).toBe(false);
    for (let i = 0; i < 20; i++) stepDay(w);
    const sq = approvalSqueeze(w, w.stepOwner.produce)!;
    expect(sq.waiting).toBeGreaterThan(0);
    expect(sq.reserve).toBeGreaterThan(0);
  });
  it("直近7日の発生・完了と、待ちを片づける日数が出る", () => {
    const w = createInitialWorld(1);
    for (let i = 0; i < 10; i++) stepDay(w);
    const f = recentFlow(w);
    expect(f.arrived).toBeGreaterThan(0);
    const jobs = w.jobs.filter((j) => j.phase === "queued");
    expect(queueDays(w, jobs, w.stepOwner.produce)).toBeGreaterThanOrEqual(0);
  });
});

import { flowCompare, flowRising, queueChange } from "../sim";
import { CHECK_SEEDS } from "../bot/bots";

describe("異変に気づくための数字", () => {
  it("28日たつまでは、前の14日と比べない/繁忙期に入ると、発生が前の14日より増える", () => {
    const early = createInitialWorld(2);
    for (let i = 0; i < 20; i++) stepDay(early);
    expect(flowCompare(early).enough).toBe(false);
    expect(flowRising(early)).toBe(false);
    // 49日目:直近14日(36〜49日)がすべて繁忙期、その前の14日(22〜35日)は繁忙期の前。5シードの合計で比べる
    let recent = 0;
    let before = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = createInitialWorld(seed);
      for (let i = 0; i < 49; i++) stepDay(w);
      const f = flowCompare(w);
      expect(f.enough).toBe(true);
      recent += f.recent;
      before += f.before;
    }
    expect(recent).toBeGreaterThan(before);
  });
  it("手がかりは、繁忙期のあいだのほうが平常時より、はっきり多く出る(雑音に埋もれない)", () => {
    // 組織は変えない(発生は組織と無関係)。繁忙期の中(50〜65日目)と、平常時(15〜35日目と80日目以降)で、出る日の割合を比べる
    let hit = 0;
    let hitN = 0;
    let calm = 0;
    let calmN = 0;
    for (const seed of [1, 2, 3, 4, 5, ...CHECK_SEEDS]) {
      const w = createInitialWorld(seed);
      for (let i = 0; i < 90; i++) {
        stepDay(w);
        if (w.day >= 50 && w.day <= 65) {
          hitN++;
          if (flowRising(w)) hit++;
        } else if ((w.day >= 28 && w.day <= 35) || w.day >= 80) {
          calmN++;
          if (flowRising(w)) calm++;
        }
      }
    }
    expect(hit / hitN).toBeGreaterThan((calm / calmN) * 1.5);
  });
  it("待ちの増減は、記録が足りないと0で、たまると正になる", () => {
    const w = createInitialWorld(2);
    expect(queueChange(w, w.stepOwner.produce)).toBe(0);
    for (let i = 0; i < 12; i++) stepDay(w);
    expect(Number.isInteger(queueChange(w, w.stepOwner.produce))).toBe(true);
  });
});
