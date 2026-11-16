import type { SalaryRuleMode as CourseBonusMode, CourseCategory as PlanCategory, PlanBonusPeriodMode as PlanPeriodMode, CourseCategory as SalaryCategory } from '@dashboarduz/shared';

type BonusTier = {
  minSales: number;
  maxSales: number | null;
  percent: number;
};

export type CategoryBonusRule = {
  mode: CourseBonusMode;
  simplePercent: number;
  tiers: BonusTier[];
};

type CategoryBonusRuleState = {
  mode: CourseBonusMode;
  simplePercent: string;
  tiers: Array<{
    minSales: string;
    maxSales: string;
    percent: string;
  }>;
};

export type BonusRulesState = Record<SalaryCategory, CategoryBonusRuleState>;

export type CourseOverrideState = {
  enabled: boolean;
  fallbackPercent: string;
  tiers: Array<{ minAmount: string; maxAmount: string; percent: string }>;
};

export type KpiMetricKey =
  | 'conversion'
  | 'avgDailyTalkTime'
  | 'debtCollectPercent'
  | 'avgLeadResponseTime'
  | 'callCount'
  | 'followUpCount'
  | 'followUpDonePercent'
  | 'stageChangeCount';

type KpiThresholdState = { full: string; half: string };

export type KpiThresholdStateMap = Record<KpiMetricKey, KpiThresholdState>;

export const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);

export type AgentUserOption = {
  id: string;
  label: string;
};

export type BonusPlan = {
  id: string;
  name: string;
  isActive: boolean;
  periodMode: PlanPeriodMode;
  courseCategory: PlanCategory;
  courseId: string | null;
  tariffId: string | null;
  subTariffId: string | null;
  subTariffName?: string | null;
  targetClosedSales: number;
  bonusAmount: number;
  createdAt: string;
  updatedAt: string;
};

type CatalogSubTariff = {
  id: string;
  name: string;
};

type CatalogTariff = {
  id: string;
  name: string;
  subTariffs: CatalogSubTariff[];
};

export type CatalogCourse = {
  id: string;
  name: string;
  category: string;
  tariffs: CatalogTariff[];
};

export type SubTariffOption = {
  value: string;
  label: string;
};

export function parsePercentInput(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  if (parsed >= 100) {
    return 100;
  }
  return Number(parsed.toFixed(2));
}

export function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function getPeriodLabel(mode: PlanPeriodMode): string {
  return mode === 'monthly' ? 'Oylik' : 'Umumiy';
}

export function getSalaryCategoryLabel(category: SalaryCategory): string {
  if (category === 'online') return 'Online';
  if (category === 'offline') return 'Offline';
  if (category === 'intensive') return 'Intensiv';
  return "Qo'shimcha xizmat";
}

export function createDefaultBonusRulesState(): BonusRulesState {
  const emptyTier = { minSales: '', maxSales: '', percent: '' };
  return {
    online: { mode: 'simple', simplePercent: '0', tiers: [emptyTier] },
    offline: { mode: 'simple', simplePercent: '0', tiers: [emptyTier] },
    intensive: { mode: 'simple', simplePercent: '0', tiers: [emptyTier] },
    additional_service: { mode: 'simple', simplePercent: '0', tiers: [emptyTier] },
  };
}

export const KPI_METRICS: Array<{ key: KpiMetricKey; label: string }> = [
  { key: 'conversion', label: 'Conversion' },
  { key: 'avgDailyTalkTime', label: "O'rtacha kunlik suhbat vaqti" },
  { key: 'debtCollectPercent', label: "Qarz undirish foizi" },
  { key: 'avgLeadResponseTime', label: "O'rtacha lid javob vaqti" },
  { key: 'callCount', label: "Qo'ng'iroqlar soni" },
  { key: 'followUpCount', label: 'Follow-up soni' },
  { key: 'followUpDonePercent', label: 'Follow-up bajarilish foizi' },
  { key: 'stageChangeCount', label: "Bosqich o'zgarishi" },
];

export const KPI_METRIC_KEYS = KPI_METRICS.map((metric) => metric.key);

export function createDefaultKpiThresholds(): KpiThresholdStateMap {
  return KPI_METRIC_KEYS.reduce((acc, metric) => {
    acc[metric] = { full: '', half: '' };
    return acc;
  }, {} as KpiThresholdStateMap);
}

export function mapRuleToState(rule: CategoryBonusRule | undefined): CategoryBonusRuleState {
  if (!rule || rule.mode === 'simple') {
    return {
      mode: 'simple',
      simplePercent: String(rule?.simplePercent ?? 0),
      tiers: [{ minSales: '', maxSales: '', percent: '' }],
    };
  }
  return {
    mode: 'tiered',
    simplePercent: String(rule.simplePercent ?? 0),
    tiers: rule.tiers.length
      ? rule.tiers.map((tier) => ({
        minSales: String(tier.minSales),
        maxSales: tier.maxSales === null ? '' : String(tier.maxSales),
        percent: String(tier.percent),
      }))
      : [{ minSales: '', maxSales: '', percent: '' }],
  };
}
