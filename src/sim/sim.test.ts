import { describe, expect, it } from "vitest";
import {
  assignStaff,
  createDept,
  createInitialWorld,
  deleteDept,
  manageEffect,
  manageTimeNeeded,
  payroll,
  poisson,
  rand01,
  runDays,
  setApproval,
  setHead,
  setParent,
  setStepOwner,
  stepDay,
  STEPS,
  TUNING,
  type Job,
  type World,
} from "./index";
import { TAG } from "./rng";

/** 小さな会社:部署1つ、職員n人(能力は全分野 skill)、部署長1人。発生は止める */
function tinyWorld(opts: { staff: number; skill?: number; head?: boolean; seed?: number }): World {
  const w = createInitialWorld(opts.seed ?? 1);
  const skill = opts.skill ?? 3;
  w.arrivalScale = 0;
  w.jobs = [];
  w.finished = [];
  w.nextJobId = 1;
  w.depts = [{ id: 1, name: "テスト部", parentId: null, headId: opts.head === false ? null : 1 }];
  w.staff = [];
  for (let i = 1; i <= opts.staff + 1; i++) {
    w.staff.push({
      id: i,
      name: `職員${i}`,
      deptId: 1,
      skills: { estimate: skill, produce: skill, inspect: skill },
      manage: 3,
      rampUntil: 0,
    });
  }
  if (opts.head === false) w.staff.pop();
  w.stepOwner = { estimate: 1, produce: 1, inspect: 1 };
  w.approval = { estimate: "none", produce: "none", inspect: "none" };
  w.payrollCap = 1000;
  return w;
}

function addJob(w: World, over: Partial<Job> = {}): Job {
  const job: Job = {
    id: w.nextJobId++,
    kind: "small",
    arrivedDay: 1,
    deadlineDay: 11,
    stepIdx: 1,
    remaining: 2,
    availableOn: 1,
    assignee: null,
    phase: "queued",
    pendingFlaw: false,
    flaws: [],
    redo: null,
    reworking: false,
    attempt: 0,
    doneDay: null,
    days: { work: 0, queue: 0, approval: 0, handoff: 0, rework: 0 },
    workedToday: false,
    returns: 0,
    caught: 0,
    ...over,
  };
  w.jobs.push(job);
  return job;
}

/** この業務のミスの運が、全部「ミスなし」になるシード(能力 skill のとき)を探す */
function seedWithoutMistakes(jobId: number, skill: number, rolls: number): number {
  const p = Math.max(0, TUNING.mistakeBase - TUNING.mistakePerSkill * skill);
  for (let seed = 1; seed < 5000; seed++) {
    let ok = true;
    for (let step = 0; step < 3 && ok; step++) {
      for (let attempt = 0; attempt < rolls; attempt++) {
        if (rand01(seed, TAG.mistake, jobId, step, attempt) < p) ok = false;
      }
    }
    if (ok) return seed;
  }
  throw new Error("シードが見つかりません");
}

describe("乱数", () => {
  it("同じ引数なら同じ値で、0以上1未満、平均はおよそ0.5", () => {
    expect(rand01(1, 2, 3)).toBe(rand01(1, 2, 3));
    expect(rand01(1, 2, 3)).not.toBe(rand01(1, 2, 4));
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const r = rand01(7, i);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
      sum += r;
    }
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
  });

  it("発生件数の平均が、指定した平均に近い", () => {
    for (const lambda of [0.5, 2.4]) {
      let sum = 0;
      for (let d = 1; d <= 3000; d++) sum += poisson(lambda, 1, TAG.arrival, d, 0);
      expect(Math.abs(sum / 3000 - lambda)).toBeLessThan(0.1);
    }
  });
});

describe("最初の会社", () => {
  const w = createInitialWorld();

  it("社長+職員25人(営業6・制作14・検査5)、部署3つ、部署長3人", () => {
    expect(w.staff).toHaveLength(25);
    expect(w.depts.map((d) => w.staff.filter((s) => s.deptId === d.id).length)).toEqual([6, 14, 5]);
    expect(w.depts.every((d) => d.headId !== null && d.parentId === null)).toBe(true);
  });

  it("人件費は 職員22人×給与+部署長3人×部署長の給与、上限はその1.1倍", () => {
    const expected = 22 * TUNING.salaryStaff + 3 * TUNING.salaryHead;
    expect(payroll(w)).toBeCloseTo(expected);
    expect(w.payrollCap).toBeCloseTo(expected * TUNING.payrollCapRatio);
  });

  it("主な分野の専門能力は、部署ごとの平均がおよそ3", () => {
    const fields = ["estimate", "produce", "inspect"] as const;
    w.depts.forEach((d, i) => {
      const members = w.staff.filter((s) => s.deptId === d.id);
      const avg = members.reduce((a, s) => a + s.skills[fields[i]!], 0) / members.length;
      expect(avg).toBeGreaterThan(2.7);
      expect(avg).toBeLessThan(3.3);
    });
  });

  it("名前が重ならない", () => {
    expect(new Set(w.staff.map((s) => s.name)).size).toBe(25);
  });

  it("全工程の承認が社長に集まる(承認の方法が「その上の上司」)", () => {
    for (const step of STEPS) expect(w.approval[step]).toBe("above");
  });
});

describe("管理の式", () => {
  it("部下13人・管理能力3なら、管理に 13×(部下1人あたりの時間) 人日", () => {
    expect(manageTimeNeeded(13, 3)).toBeCloseTo(13 * TUNING.manageTimePerSubordinate);
  });
  it("管理能力が高いほど、必要な時間が少ない", () => {
    expect(manageTimeNeeded(10, 5)).toBeLessThan(manageTimeNeeded(10, 3));
  });
  it("足りているとき効きは1.0、足りないほど下がり、下限をこえない", () => {
    const floor = TUNING.manageEffectFloor;
    expect(manageEffect(0.5)).toBe(1);
    expect(manageEffect(1)).toBe(1);
    // 必要時間が2のとき、不足は半分 → 効き = 1 − (1 − 下限) × 0.5
    expect(manageEffect(2)).toBeCloseTo(1 - (1 - floor) * 0.5);
    expect(manageEffect(1000)).toBeGreaterThanOrEqual(floor);
    expect(manageEffect(1000)).toBeLessThan(floor + 0.01);
    expect(manageEffect(1.5)).toBeGreaterThan(manageEffect(3));
  });
});

describe("1日の計算", () => {
  it("能力3の職員は1日に1人日。2人日の制作は2日で終わり、部署長は作業しない", () => {
    const w = tinyWorld({ staff: 1 });
    const job = addJob(w, { stepIdx: 1, remaining: 2 });
    stepDay(w);
    expect(job.remaining).toBeCloseTo(1);
    stepDay(w);
    expect(job.stepIdx).toBe(2); // 検査へ進んだ(同じ部署・承認なしなので、その日のうちに進む)
    expect(job.remaining).toBe(0.5);
  });

  it("部署長しかいない部署では、誰も作業をしない", () => {
    const w = tinyWorld({ staff: 0 });
    const job = addJob(w);
    stepDay(w);
    stepDay(w);
    expect(job.remaining).toBe(2);
    expect(job.days.queue).toBe(2);
  });

  it("部署長が空席だと、管理の効きが下限になる", () => {
    const w = tinyWorld({ staff: 1, head: false });
    const job = addJob(w, { stepIdx: 1, remaining: 2 });
    stepDay(w);
    expect(job.remaining).toBeCloseTo(2 - TUNING.manageEffectFloor);
  });

  it("専門能力が高いほど速い(能力5は3の約1.67倍)", () => {
    const w = tinyWorld({ staff: 1, skill: 5 });
    const job = addJob(w, { stepIdx: 1, remaining: 2 });
    stepDay(w);
    expect(2 - job.remaining).toBeCloseTo(5 / 3);
  });

  it("工程が終わって別の部署へ渡すと、次の日から着手できる(+1日)", () => {
    const w = tinyWorld({ staff: 1 });
    w.depts.push({ id: 2, name: "別部署", parentId: null, headId: null });
    w.stepOwner.inspect = 2;
    const job = addJob(w, { stepIdx: 1, remaining: 1 });
    stepDay(w); // 制作が終わる(1日目)
    expect(job.stepIdx).toBe(2);
    expect(job.availableOn).toBe(1 + 1); // 承認なし:当日 + 別部署の1日
  });

  it("承認ありの工程は承認待ちになり、部署長に時間があればその日のうちに承認される", () => {
    const w = tinyWorld({ staff: 1, seed: seedWithoutMistakes(1, 3, 2) });
    w.approval.produce = "head";
    const job = addJob(w, { stepIdx: 1, remaining: 1 });
    stepDay(w);
    expect(job.phase).toBe("queued");
    expect(job.stepIdx).toBe(2);
    expect(job.availableOn).toBe(2); // 承認を通ったので、次の日から
  });

  it("部署長の管理が手一杯だと、承認が間に合わず承認待ちが続く", () => {
    // 部下12人 → 管理に0.96人日、承認に使えるのは0.04人日(0.1に満たない)
    const w = tinyWorld({ staff: 12, seed: seedWithoutMistakes(1, 3, 2) });
    w.approval.produce = "head";
    const job = addJob(w, { stepIdx: 1, remaining: 0.5 });
    stepDay(w);
    stepDay(w);
    expect(job.phase).toBe("approval");
    expect(job.days.approval).toBe(2);
  });

  it("承認でミスが見つかると、その工程を作業量の半分でやり直す", () => {
    // ミスが出て、承認で見つかるシードを探す
    const p = TUNING.mistakeBase - TUNING.mistakePerSkill * 3;
    const find = TUNING.approvalFindBase + TUNING.approvalFindPerManage * 3;
    let seed = 0;
    for (let s = 1; s < 5000; s++) {
      if (rand01(s, TAG.mistake, 1, 1, 0) < p && rand01(s, TAG.approvalFind, 1, 1, 1) < find) {
        seed = s;
        break;
      }
    }
    expect(seed).toBeGreaterThan(0);
    const w = tinyWorld({ staff: 1, seed });
    w.approval.produce = "head";
    const job = addJob(w, { stepIdx: 1, remaining: 1 });
    stepDay(w);
    expect(job.stepIdx).toBe(1);
    expect(job.remaining).toBeCloseTo(2 * TUNING.approvalReworkRatio);
    expect(job.reworking).toBe(true);
  });

  it("最後の工程でミスが残っていると、客から差し戻され、ミスの出た工程を全部やり直す", () => {
    const w = tinyWorld({ staff: 1, seed: seedWithoutMistakes(1, 3, 3) });
    // 大口注文の検査(作業量2)。制作(番号1)のミスが、承認でも見つからずに残っている
    const job = addJob(w, { kind: "large", deadlineDay: 26, stepIdx: 2, remaining: 2, flaws: [1] });
    stepDay(w);
    expect(job.stepIdx).toBe(2);
    stepDay(w); // 検査が終わる → 制作をやり直す
    expect(job.phase).toBe("queued");
    expect(job.stepIdx).toBe(1);
    expect(job.remaining).toBe(8); // 制作の作業量そのまま
    expect(job.reworking).toBe(true);
    expect(job.deadlineDay).toBe(26); // 期限は変わらない
    expect(job.flaws).toEqual([]);
  });

  it("差し戻しのやり直しが全部終わると、完了になる", () => {
    const w = tinyWorld({ staff: 1, seed: seedWithoutMistakes(1, 3, 3) });
    const job = addJob(w, { stepIdx: 2, remaining: 0.5, flaws: [0] });
    stepDay(w); // 検査 → 見積をやり直す(同じ日のうちに続けて作業できる)
    expect(w.finished).toContain(job);
    expect(job.doneDay).toBe(1);
  });

  it("期限内に終わった業務は、期限をむかえた日の期限内完了率に数えられる", () => {
    const w = tinyWorld({ staff: 1, seed: seedWithoutMistakes(1, 3, 3) });
    addJob(w, { stepIdx: 2, remaining: 0.5, deadlineDay: 1 });
    const r = stepDay(w);
    expect(r.onTimeRate).toBe(1);
  });

  it("期限をすぎても終わっていない業務は、期限内でないと数える", () => {
    const w = tinyWorld({ staff: 0 });
    addJob(w, { deadlineDay: 2 });
    stepDay(w);
    expect(stepDay(w).onTimeRate).toBe(0);
  });

  it("異動した職員は、5日間、能率が半分になる", () => {
    const w = tinyWorld({ staff: 2 });
    expect(assignStaff(w, 3, 1).ok).toBe(true); // 同じ部署:変わらない
    w.depts.push({ id: 2, name: "別部署", parentId: null, headId: 2 });
    assignStaff(w, 2, 2); // 職員2が、別部署の部署長になる(部署長は部下の管理だけをする)
    w.depts[0]!.headId = 1;
    w.staff.find((x) => x.id === 2)!.rampUntil = 0;
    w.stepOwner.produce = 2;
    assignStaff(w, 3, 2);
    const job = addJob(w, { stepIdx: 1, remaining: 10 });
    stepDay(w);
    expect(10 - job.remaining).toBeCloseTo(0.5);
    for (let i = 0; i < 4; i++) stepDay(w);
    const before = job.remaining;
    stepDay(w); // 6日目:習熟が戻る
    expect(before - job.remaining).toBeCloseTo(1);
  });
});

describe("全体の性質", () => {
  it("同じシードなら、毎回同じ展開になる", () => {
    const a = createInitialWorld(5);
    const b = createInitialWorld(5);
    runDays(a, 90);
    runDays(b, 90);
    expect(JSON.stringify(a.records)).toBe(JSON.stringify(b.records));
  });

  it("シードが違えば、展開が変わる", () => {
    const a = createInitialWorld(1);
    const b = createInitialWorld(2);
    runDays(a, 30);
    runDays(b, 30);
    expect(JSON.stringify(a.records)).not.toBe(JSON.stringify(b.records));
  });

  it("プレイヤーの操作が違っても、業務の発生は同じ", () => {
    const a = createInitialWorld(3);
    const b = createInitialWorld(3);
    for (const s of STEPS) setApproval(b, s, "none");
    runDays(a, 60);
    runDays(b, 60);
    expect(b.records.map((r) => r.arrived)).toEqual(a.records.map((r) => r.arrived));
  });

  it("業務は増えも消えもしない(発生 = 完了 + 途中)。数字がおかしくならない", () => {
    const w = createInitialWorld(2);
    runDays(w, 90);
    const arrived = w.records.reduce((n, r) => n + r.arrived, 0);
    // 引き継ぎ前(日付が0以下)の業務は数えない
    const fromStart = (j: Job) => j.arrivedDay >= 1;
    expect(w.finished.filter(fromStart).length + w.jobs.filter(fromStart).length).toBe(arrived);
    for (const j of w.finished.filter(fromStart)) {
      expect(j.doneDay!).toBeGreaterThanOrEqual(j.arrivedDay);
      const days = Object.values(j.days).reduce((a, b) => a + b, 0);
      expect(days).toBeLessThanOrEqual(j.doneDay! - j.arrivedDay + 1);
    }
    for (const r of w.records) {
      expect(Number.isFinite(r.payroll)).toBe(true);
      if (r.onTimeRate !== null) {
        expect(r.onTimeRate).toBeGreaterThanOrEqual(0);
        expect(r.onTimeRate).toBeLessThanOrEqual(1);
      }
    }
  });

  it("操作の結果が変わる:承認の方法を変えると、90日の展開が変わる", () => {
    const base = createInitialWorld(1);
    const changed = createInitialWorld(1);
    for (const s of STEPS) setApproval(changed, s, "none");
    runDays(base, 90);
    runDays(changed, 90);
    expect(JSON.stringify(changed.records)).not.toBe(JSON.stringify(base.records));
  });
});

describe("プレイヤーの操作", () => {
  it("部署長は、その部署の職員だけ任命できる", () => {
    const w = createInitialWorld();
    const other = w.staff.find((s) => s.deptId === 2 && s.id !== w.depts[1]!.headId)!;
    expect(setHead(w, 1, other.id).ok).toBe(false);
    expect(setHead(w, 2, other.id).ok).toBe(true);
    expect(w.depts[1]!.headId).toBe(other.id);
  });

  it("部署長が別の部署へ移ると、元の部署は空席になる", () => {
    const w = createInitialWorld();
    assignStaff(w, w.depts[0]!.headId!, 3);
    expect(w.depts[0]!.headId).toBeNull();
  });

  it("人件費の上限をこえる任命は、できない(何も変わらない)", () => {
    const w = createInitialWorld();
    const made = createDept(w, "新部署", null);
    expect(made.ok).toBe(true);
    const id = (made as { id: number }).id;
    assignStaff(w, w.staff[1]!.id, id);
    w.payrollCap = payroll(w); // 余裕なし
    const r = setHead(w, id, w.staff[1]!.id);
    expect(r.ok).toBe(false);
    expect(w.depts.find((d) => d.id === id)!.headId).toBeNull();
  });

  it("部署は8つまで。職員・下の部署・担当工程のある部署は無くせない", () => {
    const w = createInitialWorld();
    for (let i = w.depts.length; i < TUNING.maxDepts; i++) expect(createDept(w, `部署${i}`, null).ok).toBe(true);
    expect(createDept(w, "多すぎ", null).ok).toBe(false);
    expect(deleteDept(w, 1).ok).toBe(false); // 職員がいる
    const lastId = w.depts[w.depts.length - 1]!.id;
    setStepOwner(w, "inspect", lastId);
    expect(deleteDept(w, lastId).ok).toBe(false); // 工程を担当している
    setStepOwner(w, "inspect", 3);
    expect(deleteDept(w, lastId).ok).toBe(true);
  });

  it("部署を輪になるように置くことはできない", () => {
    const w = createInitialWorld();
    expect(setParent(w, 1, 2).ok).toBe(true);
    expect(setParent(w, 2, 1).ok).toBe(false);
    expect(setParent(w, 1, 1).ok).toBe(false);
    expect(setParent(w, 1, null).ok).toBe(true);
  });

  it("部署の置き場所を変えると、承認が上の部署の部署長に回る", () => {
    const w = tinyWorld({ staff: 1, seed: seedWithoutMistakes(1, 3, 2) });
    w.depts.push({ id: 2, name: "上の部署", parentId: null, headId: 3 });
    w.staff.push({ id: 3, name: "上司", deptId: 2, skills: { estimate: 1, produce: 1, inspect: 1 }, manage: 3, rampUntil: 0 });
    w.depts[0]!.parentId = 2;
    w.approval.produce = "above";
    const job = addJob(w, { stepIdx: 1, remaining: 1 });
    stepDay(w);
    expect(job.stepIdx).toBe(2); // 上の部署の部署長が承認した
  });
});
