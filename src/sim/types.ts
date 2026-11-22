import type { JobKind, Step } from "./params";

/** 承認の方法(工程ごと)。承認なし/部署長/その上の上司 */
export type ApprovalChoice = "none" | "head" | "above";

export interface Staff {
  id: number;
  name: string;
  deptId: number;
  /** 分野ごとの専門能力(1〜5)。分野は工程と1対1 */
  skills: Record<Step, number>;
  /** 管理能力(1〜5) */
  manage: number;
  /** この日まで習熟が下がる(異動のとき設定)。0なら習熟の影響なし */
  rampUntil: number;
}

export interface Dept {
  id: number;
  name: string;
  /** 上の部署。null なら一番上(部署長の上司は社長) */
  parentId: number | null;
  /** 部署長(職員のid)。null は空席 */
  headId: number | null;
}

export type JobPhase = "queued" | "approval" | "done";

/** 遅れの内訳(日数)。画面の「原因の表示」に使う */
export interface JobDays {
  work: number;
  queue: number;
  approval: number;
  handoff: number;
  rework: number;
}

export interface Job {
  id: number;
  kind: JobKind;
  arrivedDay: number;
  deadlineDay: number;
  /** 今いる工程(その業務の route の番号) */
  stepIdx: number;
  /** 今の工程の残りの作業量(人日) */
  remaining: number;
  /** この日から着手できる */
  availableOn: number;
  /** 作業している職員(いなければ null) */
  assignee: number | null;
  phase: JobPhase;
  /** 今の工程でミスが出た(承認待ち中) */
  pendingFlaw: boolean;
  /** 承認でも見つからなかったミスのある工程の番号 */
  flaws: number[];
  /** 客からの差し戻しで、やり直す工程の番号(残り)。null なら通常の流れ */
  redo: number[] | null;
  /** 今の作業は差し戻しによるやり直し */
  reworking: boolean;
  /** 工程のやり直しを含め、ミスの運に使う通し番号 */
  attempt: number;
  doneDay: number | null;
  days: JobDays;
  workedToday: boolean;
  /** 客からの差し戻しを受けた回数(記録だけ。計算には使わない) */
  returns: number;
  /** 承認でミスが見つかった回数(記録だけ。計算には使わない) */
  caught: number;
}

export interface DayRecord {
  day: number;
  arrived: number;
  completed: number;
  /** 完了していない業務の数 */
  open: number;
  /** 承認待ちの数 */
  approvalWaiting: number;
  /** 直近30日に期限をむかえた業務の期限内完了率。対象が無ければ null */
  onTimeRate: number | null;
  payroll: number;
  /** 部署ごとの待ち(着手できる業務の数) */
  queueByDept: Record<number, number>;
}

export interface World {
  seed: number;
  /** 終わった日数。次に計算する日は day + 1 */
  day: number;
  staff: Staff[];
  depts: Dept[];
  presidentManage: number;
  /** 業務の発生量にかける倍率(1が基準)。外部の変化や、テストで発生を止めるために使う */
  arrivalScale: number;
  /** 工程を受け持つ部署 */
  stepOwner: Record<Step, number>;
  approval: Record<Step, ApprovalChoice>;
  /** 完了していない業務 */
  jobs: Job[];
  /** 完了した業務 */
  finished: Job[];
  nextJobId: number;
  nextStaffId: number;
  nextDeptId: number;
  /** 人件費の上限(給与単位/日) */
  payrollCap: number;
  records: DayRecord[];
}
