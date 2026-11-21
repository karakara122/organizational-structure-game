import { TUNING } from "./params";
import type { Dept, Staff, World } from "./types";

export function getDept(w: World, id: number): Dept {
  const d = w.depts.find((x) => x.id === id);
  if (!d) throw new Error(`部署がありません: ${id}`);
  return d;
}

export function getStaff(w: World, id: number): Staff {
  const s = w.staff.find((x) => x.id === id);
  if (!s) throw new Error(`職員がいません: ${id}`);
  return s;
}

export function isHead(w: World, staffId: number): boolean {
  return w.depts.some((d) => d.headId === staffId);
}

/** 人件費(給与単位/日)。社長は数えない */
export function payroll(w: World): number {
  let sum = 0;
  for (const s of w.staff) {
    sum += isHead(w, s.id) ? TUNING.salaryHead : TUNING.salaryStaff;
  }
  return sum;
}

/** 承認する人。社長は "president" */
export type Approver = { kind: "president" } | { kind: "staff"; staff: Staff };

/** 部署から上へたどって、最初に見つかる部署長。誰もいなければ社長 */
export function headOrAbove(w: World, deptId: number | null): Approver {
  let id = deptId;
  while (id !== null) {
    const d = getDept(w, id);
    if (d.headId !== null) return { kind: "staff", staff: getStaff(w, d.headId) };
    id = d.parentId;
  }
  return { kind: "president" };
}

export function approverKey(a: Approver): string {
  return a.kind === "president" ? "p" : String(a.staff.id);
}

export function approverManage(w: World, a: Approver): number {
  return a.kind === "president" ? w.presidentManage : a.staff.manage;
}

/** 部署長(または社長)が管理する直属の部下の数(部署の職員と、下の部署の部署長) */
export function subordinateCount(w: World, deptId: number): number {
  const d = getDept(w, deptId);
  const staffCount = w.staff.filter((s) => s.deptId === deptId && s.id !== d.headId).length;
  const childHeads = w.depts.filter((c) => c.parentId === deptId && c.headId !== null).length;
  return staffCount + childHeads;
}

export function presidentSubordinateCount(w: World): number {
  return w.depts.filter((c) => c.parentId === null && c.headId !== null).length;
}

/** 管理に必要な時間(人日/日) = 部下の数 × 0.08 × 3 ÷ 管理能力 */
export function manageTimeNeeded(subordinates: number, manage: number): number {
  return (subordinates * TUNING.manageTimePerSubordinate * TUNING.normalSkill) / manage;
}

/** 管理の効き。足りているとき1.0、足りないときは足りない割合に応じて下限まで下がる */
export function manageEffect(need: number): number {
  if (need <= TUNING.timePerDay) return 1;
  const shortage = (need - TUNING.timePerDay) / need;
  return 1 - (1 - TUNING.manageEffectFloor) * Math.min(1, shortage);
}

/** deptId の部署は、ownerId の部署の中(自分自身か、その下の部署)にあるか */
export function isWithin(w: World, deptId: number, ownerId: number): boolean {
  let id: number | null = deptId;
  while (id !== null) {
    if (id === ownerId) return true;
    id = getDept(w, id).parentId;
  }
  return false;
}
