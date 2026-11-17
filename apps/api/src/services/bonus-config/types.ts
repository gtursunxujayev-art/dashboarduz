export const BONUS_PLAN_CATEGORIES = ['online', 'offline', 'intensive', 'additional_service'] as const;

export const BONUS_PLAN_PERIODS = ['monthly', 'all_time'] as const;

export const BONUS_RULE_CATEGORIES = ['online', 'offline', 'intensive', 'additional_service'] as const;

export const BONUS_RULE_MODES = ['simple', 'tiered'] as const;

export const BONUS_TIER_BASES = ['sales_count', 'agreement_amount'] as const;

export const BONUS_BASE_MODES = ['on_income', 'on_debt_closed'] as const;

export const KPI_METRIC_KEYS = [
  'conversion',
  'avgDailyTalkTime',
  'debtCollectPercent',
  'avgLeadResponseTime',
  'callCount',
  'followUpCount',
  'followUpDonePercent',
  'stageChangeCount',
] as const;

const BONUS_READ_ROLES = new Set(['Admin', 'Manager', 'TeamLeader']);

export type BonusPlanCategory = (typeof BONUS_PLAN_CATEGORIES)[number];

export type BonusPlanPeriodMode = (typeof BONUS_PLAN_PERIODS)[number];

export type BonusRuleCategory = (typeof BONUS_RULE_CATEGORIES)[number];

export type BonusRuleMode = (typeof BONUS_RULE_MODES)[number];

export type BonusTierBasis = (typeof BONUS_TIER_BASES)[number];

export type BonusBaseMode = (typeof BONUS_BASE_MODES)[number];

export type KpiMetricKey = (typeof KPI_METRIC_KEYS)[number];

export type BonusRuleTier = {
  minSales: number;
  maxSales: number | null;
  percent: number;
};

export type SalaryCategoryBonusRule = {
  mode: BonusRuleMode;
  /** What the tier bounds measure; rules saved before this existed tier on the closed sales count. */
  tierBasis: BonusTierBasis;
  simplePercent: number;
  tiers: BonusRuleTier[];
};

export type SalaryBonusRules = Record<BonusRuleCategory, SalaryCategoryBonusRule>;

export type BonusPlan = {
  id: string;
  name: string;
  isActive: boolean;
  periodMode: BonusPlanPeriodMode;
  courseCategory: BonusPlanCategory;
  courseId: string | null;
  tariffId: string | null;
  subTariffId: string | null;
  subTariffName: string | null;
  targetClosedSales: number;
  bonusAmount: number;
  createdAt: string;
  updatedAt: string;
};

export type FixedSalaryRow = {
  userId: string;
  amount: number;
};

export type AttendancePenaltySettings = {
  lateMinutePenaltyUZS: number;
  missingHourPenaltyUZS: number;
  absenceDayPenaltyUZS: number;
  applyToFixedSalary: boolean;
  applyToKpi: boolean;
  latePenaltyTarget: 'fixed' | 'kpi';
  missingHourPenaltyTarget: 'fixed' | 'kpi';
  absenceDayPenaltyTarget: 'fixed' | 'kpi';
  monthlyPenaltyCapUZS: number;
};

export type KpiThreshold = {
  full: number;
  half: number;
};

export type KpiSettings = {
  enabled: boolean;
  monthlyBudget: number;
  selectedMetrics: KpiMetricKey[];
  thresholds: Record<KpiMetricKey, KpiThreshold>;
};

export function canReadBonusPlans(roles: string[]): boolean {
  return roles.some((role) => BONUS_READ_ROLES.has(role));
}

