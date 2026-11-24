// 入社(仕様書 4章)。決まった日の朝に新人が入社し、制作を担当する部署に入る。
import { HIRES, type Step } from "./params";
import { MANAGE_PATTERN, makeName, OTHER_FIELD_SKILL, PRIMARY_SKILL_PATTERN } from "./scenario";
import { TUNING } from "./params";
import type { World } from "./types";

/** day 日目の朝に入社する人数(無ければ 0) */
export function hireCount(day: number): number {
  return HIRES.filter((h) => h.day === day).reduce((a, h) => a + h.count, 0);
}

/** 入社する。人件費の上限は、新人の給料ぶん(上限の比率をかけて)増える。部署長にはならない */
export function applyHires(w: World, day: number): number {
  const n = hireCount(day);
  if (n === 0) return 0;
  const dept = w.stepOwner.produce;
  for (let i = 0; i < n; i++) {
    const id = w.nextStaffId++;
    const skills: Record<Step, number> = { estimate: OTHER_FIELD_SKILL, produce: OTHER_FIELD_SKILL, inspect: OTHER_FIELD_SKILL };
    skills.produce = PRIMARY_SKILL_PATTERN[i % PRIMARY_SKILL_PATTERN.length]!;
    w.staff.push({
      id,
      name: makeName(w.seed, id - 1),
      deptId: dept,
      skills,
      manage: MANAGE_PATTERN[i % MANAGE_PATTERN.length]!,
      rampUntil: 0,
    });
  }
  w.payrollCap += n * TUNING.salaryStaff * TUNING.payrollCapRatio;
  return n;
}

/** 入社の知らせ(入社の日から7日間だけ出す。日から決まるので、保存の形は変わらない) */
export function hireNotice(w: World): string | null {
  const h = HIRES.find((x) => w.day >= x.day && w.day < x.day + 7);
  if (!h) return null;
  const dept = w.depts.find((d) => d.id === w.stepOwner.produce);
  return `${h.day}日目に、新人 ${h.count}人が入社しました(${dept?.name ?? "制作を担当する部署"}。部署長ではありません)。人件費の上限も、新人の給料ぶん増えています。`;
}
