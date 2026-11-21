// つまみの表(docs/仕様書.md 6-3)。調整できる数字は、全部ここ1か所に置く。
// 数字を変えたら、docs/決定ログ.md に日付と理由を1行書く。全部【仮の値】。

/** 工程(仕様書 3-2)。分野と1対1で対応する。営業=見積、制作=制作、検査=検査 */
export const STEPS = ["estimate", "produce", "inspect"] as const;
export type Step = (typeof STEPS)[number];

/** 画面に出す名前(用語の表 6-2 に合わせる) */
export const STEP_LABEL: Record<Step, string> = {
  estimate: "見積",
  produce: "制作",
  inspect: "検査",
};

export type JobKind = "small" | "large" | "rush";

export interface RouteStep {
  step: Step;
  /** 作業量(人日)。能力3の職員1人が1日で進められる量が1人日 */
  work: number;
}

export interface JobKindSpec {
  label: string;
  route: RouteStep[];
  /** 期限(日)。業務が発生した日から数える */
  limitDays: number;
  /** 発生(件/日)の平均 */
  ratePerDay: number;
}

/** 業務の種類(仕様書 3-2 の表) */
export const JOB_KINDS: Record<JobKind, JobKindSpec> = {
  small: {
    label: "小口注文",
    route: [
      { step: "estimate", work: 0.5 },
      { step: "produce", work: 2 },
      { step: "inspect", work: 0.5 },
    ],
    limitDays: 10,
    ratePerDay: 2.4,
  },
  large: {
    label: "大口注文",
    route: [
      { step: "estimate", work: 1 },
      { step: "produce", work: 8 },
      { step: "inspect", work: 2 },
    ],
    limitDays: 25,
    ratePerDay: 0.5,
  },
  rush: {
    label: "急ぎ注文",
    route: [
      { step: "produce", work: 1.5 },
      { step: "inspect", work: 0.5 },
    ],
    limitDays: 5,
    ratePerDay: 0.8,
  },
};

export const JOB_KIND_LIST = ["small", "large", "rush"] as const;

export const TUNING = {
  /** 1人が1日に使える時間(人日) */
  timePerDay: 1.0,
  /** 能力3がふつう(能率1.0) */
  normalSkill: 3,

  /** 部署長が、直属の部下1人につき1日に使う管理時間(人日)。管理能力3の場合 */
  manageTimePerSubordinate: 0.08,
  /** 管理が足りない・部署長が空席のときの、管理の効きの下限 */
  manageEffectFloor: 0.7,

  /** 承認1件に使う時間(人日) */
  approvalTime: 0.1,
  /** 承認でミスを見つける確率 = base + 管理能力 × perManage */
  approvalFindBase: 0.5,
  approvalFindPerManage: 0.08,
  /** 承認で見つかったミスのやり直し量(元の作業量に対する割合) */
  approvalReworkRatio: 0.5,

  /** ミスの確率 = base − 専門能力 × perSkill(0未満にはしない) */
  mistakeBase: 0.15,
  mistakePerSkill: 0.02,

  /** 別の部署へ渡すときにかかる日数 */
  handoffDays: 1,

  /** 異動した職員の習熟 */
  rampDays: 5,
  rampFactor: 0.5,

  /** 給与単位/日 */
  salaryStaff: 1.0,
  salaryHead: 1.5,
  /** 人件費の上限 = シナリオ開始時の人件費 × この値 */
  payrollCapRatio: 1.1,

  /** 部署の数の上限 */
  maxDepts: 8,
  /** 期限内完了率を数える日数(直近◯日に期限をむかえた業務) */
  windowDays: 30,
  /** 1回のシナリオの長さ(日) */
  scenarioDays: 90,
  /** 社長の管理能力 */
  presidentManage: 3,
} as const;
