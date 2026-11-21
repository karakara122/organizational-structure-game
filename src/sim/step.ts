import { JOB_KIND_LIST, JOB_KINDS, TUNING, type RouteStep, type Step } from "./params";
import { poisson, rand01, TAG } from "./rng";
import type { DayRecord, Job, World } from "./types";
import {
  approverKey,
  approverManage,
  getDept,
  getStaff,
  headOrAbove,
  isWithin,
  manageEffect,
  manageTimeNeeded,
  payroll,
  presidentSubordinateCount,
  subordinateCount,
  type Approver,
} from "./org";

const EPS = 1e-9;

function route(job: Job): RouteStep[] {
  return JOB_KINDS[job.kind].route;
}

function currentStep(job: Job): Step {
  return route(job)[job.stepIdx]!.step;
}

function newDays() {
  return { work: 0, queue: 0, approval: 0, handoff: 0, rework: 0 };
}

/** 工程を通過した業務を、次へ進める。immediate=承認なしで、同じ日のうちに進む */
function passStep(w: World, job: Job, day: number, immediate: boolean): void {
  const fromDept = w.stepOwner[currentStep(job)];
  let next: number | null;
  if (job.redo !== null) {
    next = job.redo.shift() ?? null;
  } else {
    next = job.stepIdx + 1 < route(job).length ? job.stepIdx + 1 : null;
  }

  if (next === null) {
    if (job.flaws.length === 0) {
      job.phase = "done";
      job.doneDay = day;
      job.assignee = null;
      return;
    }
    // 客からの差し戻し:ミスの出た工程を全部やり直す。期限は変わらない
    job.redo = [...new Set(job.flaws)].sort((a, b) => a - b);
    job.flaws = [];
    next = job.redo.shift()!;
  }

  job.stepIdx = next;
  job.remaining = route(job)[next]!.work;
  job.phase = "queued";
  job.assignee = null;
  job.reworking = job.redo !== null;
  const toDept = w.stepOwner[currentStep(job)];
  job.availableOn = day + (immediate ? 0 : 1) + (toDept !== fromDept ? TUNING.handoffDays : 0);
}

/** 工程の作業が終わったとき:ミスが出たかを決め、承認待ちか次へ進む */
function finishStep(w: World, job: Job, workerSkill: number, day: number): void {
  const step = currentStep(job);
  const p = Math.max(0, TUNING.mistakeBase - TUNING.mistakePerSkill * workerSkill);
  const flawed = rand01(w.seed, TAG.mistake, job.id, job.stepIdx, job.attempt) < p;
  job.attempt++;
  job.assignee = null;
  if (w.approval[step] === "none") {
    if (flawed) job.flaws.push(job.stepIdx);
    passStep(w, job, day, true);
  } else {
    job.phase = "approval";
    job.pendingFlaw = flawed;
  }
}

function pickJob(w: World, day: number, deptId: number): Job | null {
  let best: Job | null = null;
  for (const j of w.jobs) {
    if (j.phase !== "queued" || j.assignee !== null || j.availableOn > day) continue;
    // 工程を担当する部署と、その下の部署の職員が、その工程の作業をする
    if (!isWithin(w, deptId, w.stepOwner[currentStep(j)])) continue;
    if (
      best === null ||
      j.deadlineDay < best.deadlineDay ||
      (j.deadlineDay === best.deadlineDay && j.id < best.id)
    ) {
      best = j;
    }
  }
  return best;
}

function resolveApprover(w: World, job: Job): Approver {
  const step = currentStep(job);
  const owner = getDept(w, w.stepOwner[step]);
  return w.approval[step] === "head" ? headOrAbove(w, owner.id) : headOrAbove(w, owner.parentId);
}

/** 直近30日に期限をむかえた業務の期限内完了率。対象が無ければ null */
export function onTimeRate(w: World, day: number = w.day): number | null {
  const from = day - TUNING.windowDays + 1;
  let total = 0;
  let onTime = 0;
  for (const j of [...w.jobs, ...w.finished]) {
    if (j.deadlineDay < from || j.deadlineDay > day) continue;
    total++;
    if (j.doneDay !== null && j.doneDay <= j.deadlineDay) onTime++;
  }
  return total === 0 ? null : onTime / total;
}

/** 1日ぶんを計算する(仕様書 3-4 の順番)。まとめ計算はしない */
export function stepDay(w: World): DayRecord {
  const day = w.day + 1;

  // 1. 新しい業務が発生し、最初の工程を担当する部署の待ちに入る
  let arrived = 0;
  JOB_KIND_LIST.forEach((kind, ki) => {
    const spec = JOB_KINDS[kind];
    const n =
      w.arrivalScale > 0 ? poisson(spec.ratePerDay * w.arrivalScale, w.seed, TAG.arrival, day, ki) : 0;
    for (let i = 0; i < n; i++) {
      w.jobs.push({
        id: w.nextJobId++,
        kind,
        arrivedDay: day,
        deadlineDay: day + spec.limitDays,
        stepIdx: 0,
        remaining: spec.route[0]!.work,
        availableOn: day,
        assignee: null,
        phase: "queued",
        pendingFlaw: false,
        flaws: [],
        redo: null,
        reworking: false,
        attempt: 0,
        doneDay: null,
        days: newDays(),
        workedToday: false,
      });
      arrived++;
    }
  });

  // 2. 部署長と社長が、時間を「管理」に使う。残りが「承認」に使える時間
  const effect = new Map<number, number>();
  const leftover = new Map<string, number>();
  for (const d of w.depts) {
    if (d.headId === null) {
      effect.set(d.id, TUNING.manageEffectFloor);
      continue;
    }
    const head = getStaff(w, d.headId);
    const need = manageTimeNeeded(subordinateCount(w, d.id), head.manage);
    effect.set(d.id, manageEffect(need));
    leftover.set(String(head.id), Math.max(0, TUNING.timePerDay - need));
  }
  {
    const need = manageTimeNeeded(presidentSubordinateCount(w), w.presidentManage);
    leftover.set("p", Math.max(0, TUNING.timePerDay - need));
  }

  // 3. 職員が、所属部署の待ちから期限が近い順に業務を取り、作業を進める
  // 4. 工程の作業が終わったらミスが出たかを決める(finishStep)
  const headIds = new Set(w.depts.map((d) => d.headId).filter((x): x is number => x !== null));
  for (const s of [...w.staff].sort((a, b) => a.id - b.id)) {
    if (headIds.has(s.id)) continue; // 部署長は作業をしない
    const eff = effect.get(s.deptId) ?? TUNING.manageEffectFloor;
    const ramp = day <= s.rampUntil ? TUNING.rampFactor : 1;
    let time = TUNING.timePerDay;
    for (let guard = 0; time > EPS && guard < 100; guard++) {
      let job = w.jobs.find((j) => j.assignee === s.id && j.phase === "queued") ?? null;
      if (job === null) {
        job = pickJob(w, day, s.deptId);
        if (job === null) break;
        job.assignee = s.id;
      }
      const skill = s.skills[currentStep(job)];
      const rate = (skill / TUNING.normalSkill) * eff * ramp;
      if (rate <= 0) break;
      const use = Math.min(time, job.remaining / rate);
      job.remaining -= use * rate;
      time -= use;
      job.workedToday = true;
      if (job.remaining <= EPS) {
        job.remaining = 0;
        finishStep(w, job, skill, day);
      } else {
        break;
      }
    }
  }

  // 5. 承認:承認者は時間があれば確認し、ミスを見つけたら差し戻す
  const waiting = w.jobs
    .filter((j) => j.phase === "approval")
    .sort((a, b) => a.deadlineDay - b.deadlineDay || a.id - b.id);
  for (const job of waiting) {
    const approver = resolveApprover(w, job);
    const key = approverKey(approver);
    const time = leftover.get(key) ?? 0;
    if (time + EPS < TUNING.approvalTime) continue; // 時間が足りない:翌日に持ちこす(承認待ち)
    leftover.set(key, time - TUNING.approvalTime);
    if (job.pendingFlaw) {
      const find = Math.min(
        1,
        TUNING.approvalFindBase + TUNING.approvalFindPerManage * approverManage(w, approver),
      );
      job.pendingFlaw = false;
      if (rand01(w.seed, TAG.approvalFind, job.id, job.stepIdx, job.attempt) < find) {
        // 見つかった:その工程をやり直す(作業量の半分)。同じ部署で、翌日から
        job.phase = "queued";
        job.remaining = route(job)[job.stepIdx]!.work * TUNING.approvalReworkRatio;
        job.availableOn = day + 1;
        job.reworking = true;
        continue;
      }
      job.flaws.push(job.stepIdx);
    }
    // 6. 承認を通った業務を、次の工程の担当部署へ渡す
    passStep(w, job, day, false);
  }

  // 7. 最後の工程を通った業務の完了/差し戻しは、passStep の中で決まる
  // 8. その日の数字を記録する
  let completed = 0;
  let approvalWaiting = 0;
  const queueByDept: Record<number, number> = {};
  for (const d of w.depts) queueByDept[d.id] = 0;
  for (const j of w.jobs) {
    if (j.phase === "done") {
      completed++;
      continue;
    }
    if (j.phase === "approval") {
      approvalWaiting++;
      j.days.approval++;
    } else if (j.reworking) {
      j.days.rework++;
    } else if (j.availableOn > day) {
      j.days.handoff++;
    } else if (j.workedToday) {
      j.days.work++;
    } else {
      j.days.queue++;
    }
    if (j.phase === "queued" && j.availableOn <= day) {
      const o = w.stepOwner[currentStep(j)];
      queueByDept[o] = (queueByDept[o] ?? 0) + 1;
    }
    j.workedToday = false;
  }
  // 完了した業務を移す
  const stillOpen: Job[] = [];
  for (const j of w.jobs) {
    if (j.phase === "done") w.finished.push(j);
    else stillOpen.push(j);
  }
  w.jobs = stillOpen;

  w.day = day;
  const record: DayRecord = {
    day,
    arrived,
    completed,
    open: w.jobs.length,
    approvalWaiting,
    onTimeRate: onTimeRate(w, day),
    payroll: payroll(w),
    queueByDept,
  };
  w.records.push(record);
  return record;
}

/** 指定した日数だけ、1日ずつ進める */
export function runDays(w: World, days: number): void {
  for (let i = 0; i < days; i++) stepDay(w);
}
