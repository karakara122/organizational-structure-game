// プレイヤーが決めること(仕様書 3-3)。どれも、できないときは理由を返し、何も変えない。
import { JOB_KINDS, TUNING, type Step } from "./params";
import type { ApprovalChoice, World } from "./types";
import { getDept, getStaff, isHead, payroll } from "./org";

export type ActionResult = { ok: true; id?: number } | { ok: false; reason: string };

const OK: ActionResult = { ok: true };
const fail = (reason: string): ActionResult => ({ ok: false, reason });

/** 作業中の業務を手放す(部署や部署長が変わったとき)。進んだ作業量は残る */
function releaseJobsOf(w: World, staffId: number): void {
  for (const j of w.jobs) if (j.assignee === staffId) j.assignee = null;
}

function payrollOk(w: World): boolean {
  return payroll(w) <= w.payrollCap + 1e-9;
}

/** 1. 配置:職員を部署に移す。移った職員は数日、能率が下がる */
export function assignStaff(w: World, staffId: number, toDeptId: number): ActionResult {
  const s = getStaff(w, staffId);
  getDept(w, toDeptId);
  if (s.deptId === toDeptId) return OK;
  const oldDept = getDept(w, s.deptId);
  const wasHead = oldDept.headId === s.id;
  // 部署長が移るときは、元の部署の部署長が空席になる(人件費は下がる)
  if (wasHead) oldDept.headId = null;
  releaseJobsOf(w, s.id);
  s.deptId = toDeptId;
  s.rampUntil = w.day + TUNING.rampDays;
  return OK;
}

/** 2. 上司:部署長を任命する(null で空席にする)。元の部署長は、ふつうの職員に戻る */
export function setHead(w: World, deptId: number, staffId: number | null): ActionResult {
  const d = getDept(w, deptId);
  if (staffId === d.headId) return OK;
  if (staffId !== null) {
    const s = getStaff(w, staffId);
    if (s.deptId !== deptId) return fail("部署長にできるのは、その部署の職員だけです");
    if (isHead(w, s.id)) return fail("すでに別の部署の部署長です");
  }
  const old = d.headId;
  d.headId = staffId;
  if (!payrollOk(w)) {
    d.headId = old;
    return fail("人件費の上限をこえるため、変更できません");
  }
  if (staffId !== null) releaseJobsOf(w, staffId);
  return OK;
}

/** 2. 上司:部署を、どの部署の下に置くか決める(null で一番上) */
export function setParent(w: World, deptId: number, parentId: number | null): ActionResult {
  const d = getDept(w, deptId);
  if (parentId !== null) {
    getDept(w, parentId);
    if (parentId === deptId) return fail("自分自身の下には置けません");
    // 輪になってはいけない:新しい上の部署から上へたどって、自分に着いたら輪
    let id: number | null = parentId;
    while (id !== null) {
      if (id === deptId) return fail("その部署の下には置けません(輪になります)");
      id = getDept(w, id).parentId;
    }
  }
  d.parentId = parentId;
  return OK;
}

/** 3. 担当:工程を、どの部署が受け持つか決める */
export function setStepOwner(w: World, step: Step, deptId: number): ActionResult {
  getDept(w, deptId);
  if (w.stepOwner[step] === deptId) return OK;
  w.stepOwner[step] = deptId;
  // 工程の担当が変わったので、その工程で作業中の業務は、いったん待ちに戻る
  for (const j of w.jobs) {
    if (j.phase === "queued" && j.assignee !== null) {
      if (JOB_KINDS[j.kind].route[j.stepIdx]!.step === step) j.assignee = null;
    }
  }
  return OK;
}

/** 4. 承認:工程ごとに、承認の方法を決める */
export function setApproval(w: World, step: Step, choice: ApprovalChoice): ActionResult {
  w.approval[step] = choice;
  return OK;
}

/** 5. 部署を作る。人がいなくても、部署長が空席でも作れる。費用も日数もかからない */
export function createDept(w: World, name: string, parentId: number | null): ActionResult {
  if (w.depts.length >= TUNING.maxDepts) {
    return fail(`部署は${TUNING.maxDepts}つまでです`);
  }
  if (parentId !== null) getDept(w, parentId);
  const id = w.nextDeptId++;
  w.depts.push({ id, name, parentId, headId: null });
  return { ok: true, id };
}

/** 5. 部署を無くす。職員も、下の部署も、担当する工程も無いときだけ */
export function deleteDept(w: World, deptId: number): ActionResult {
  getDept(w, deptId);
  if (w.staff.some((s) => s.deptId === deptId)) {
    return fail("職員がいる部署は、先に職員を動かしてください");
  }
  if (w.depts.some((d) => d.parentId === deptId)) {
    return fail("下に部署がある部署は、無くせません");
  }
  if (Object.values(w.stepOwner).includes(deptId)) {
    return fail("工程を担当している部署は、無くせません");
  }
  if (w.depts.length <= 1) return fail("最後の部署は、無くせません");
  w.depts = w.depts.filter((d) => d.id !== deptId);
  return OK;
}
