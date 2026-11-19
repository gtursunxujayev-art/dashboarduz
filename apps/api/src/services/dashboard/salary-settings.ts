import type { DbClient } from '@dashboarduz/db';
import { AGENT_ROLES, COURSE_CATEGORIES, PLAN_BONUS_PERIOD_MODES, type PlanBonusPeriodMode, SALARY_RULE_MODES, SALARY_TIER_BASES, type SalaryBonusMode, type SalaryRuleMode, type SalaryTierBasis, TEAM_LEADER_ROLES } from '@dashboarduz/shared';

import { normalizePercentage } from '../../lib/number';
import { asObject, toFiniteNumber } from '../../lib/object';
import { loadTenantSettings } from '../../lib/tenant-settings';

/** Salary bonus rules and plan bonuses are both configured per course category. */
export const SALARY_CATEGORIES = COURSE_CATEGORIES;

export const PLAN_BONUS_CATEGORIES = COURSE_CATEGORIES;

export type SalaryCategory = (typeof SALARY_CATEGORIES)[number];

export type SalaryBreakdown = Record<SalaryCategory, number>;

/**
 * One tier of a tiered rule. `minSales`/`maxSales` are the tier bounds in the rule's `tierBasis` unit: a closed sales
 * count, or a closed agreement total in UZS. The keys keep their historical names so stored rules still load.
 */
export type SalaryRuleTier = {
  minSales: number;
  maxSales: number | null;
  percent: number;
};

export type SalaryCategoryBonusRule = {
  mode: SalaryRuleMode;
  /** Rules saved before the basis existed tier on the closed sales count. */
  tierBasis: SalaryTierBasis;
  simplePercent: number;
  tiers: SalaryRuleTier[];
};

export type SalaryBonusRules = Record<SalaryCategory, SalaryCategoryBonusRule>;

export type PlanBonusCategory = (typeof PLAN_BONUS_CATEGORIES)[number];

export type SalaryPlanBonus = {
  id: string;
  name: string;
  isActive: boolean;
  periodMode: PlanBonusPeriodMode;
  courseCategory: PlanBonusCategory;
  courseId: string | null;
  tariffId: string | null;
  subTariffId: string | null;
  subTariffName: string | null;
  targetClosedSales: number;
  bonusAmount: number;
  createdAt: string;
  updatedAt: string;
};

export type KpiThreshold = {
  full: number;
  half: number;
};

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

export type KpiMetricKey = (typeof KPI_METRIC_KEYS)[number];

/** KPI metrics used when a tenant has not chosen any. */
export const DEFAULT_SELECTED_KPI_METRICS: KpiMetricKey[] = ['conversion', 'avgDailyTalkTime', 'debtCollectPercent', 'followUpCount'];

/** The known KPI metric keys in a stored `selectedMetrics` list, trimmed and unique (anything else is ignored). */
export function parseSelectedKpiMetrics(raw: unknown): KpiMetricKey[] {
  const values = Array.isArray(raw) ? raw : [];

  return Array.from(
    new Set(
      values
        .map((item) => String(item || '').trim())
        .filter((item): item is KpiMetricKey => KPI_METRIC_KEYS.includes(item as KpiMetricKey)),
    ),
  );
}

export type KpiSettings = {
  enabled: boolean;
  monthlyBudget: number;
  selectedMetrics: KpiMetricKey[];
  thresholds: Record<KpiMetricKey, KpiThreshold>;
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

export type SalarySettingsSnapshot = {
  bonusMode: SalaryBonusMode;
  bonusPercentages: SalaryBreakdown;
  bonusRules: SalaryBonusRules;
  fixedSalaries: Map<string, number>;
  planBonuses: SalaryPlanBonus[];
  kpiSettings: KpiSettings;
  attendancePenaltySettings: AttendancePenaltySettings;
};

export function createZeroBreakdown(): SalaryBreakdown {
  return {
    online: 0,
    offline: 0,
    intensive: 0,
    additional_service: 0,
  };
}

export function normalizeTierBasis(value: unknown): SalaryTierBasis {
  return SALARY_TIER_BASES.includes(value as SalaryTierBasis) ? (value as SalaryTierBasis) : 'sales_count';
}

export function createSimpleBonusRule(percent: unknown, tierBasis: SalaryTierBasis = 'sales_count'): SalaryCategoryBonusRule {
  return {
    mode: 'simple',
    tierBasis,
    simplePercent: normalizePercentage(percent),
    tiers: [],
  };
}

export function normalizeSalaryTier(raw: unknown): SalaryRuleTier | null {
  const row = asObject(raw);

  if (!row) {
    return null;
  }
  const minSales = Math.floor(toFiniteNumber(row.minSales, 0));
  const maxRaw = row.maxSales;
  const maxSales = maxRaw === null || maxRaw === undefined || maxRaw === ''
    ? null
    : Math.floor(toFiniteNumber(maxRaw, 0));
  const percent = normalizePercentage(row.percent);

  if (minSales <= 0 || percent <= 0) {
    return null;
  }
  if (maxSales !== null && maxSales < minSales) {
    return null;
  }

  return { minSales, maxSales, percent };
}

export function isValidTierSequence(tiers: SalaryRuleTier[]): boolean {
  if (!tiers.length) {
    return false;
  }
  for (let index = 0; index < tiers.length; index += 1) {
    const current = tiers[index];

    if (!current) {
      return false;
    }
    if (current.maxSales === null && index !== tiers.length - 1) {
      return false;
    }
    if (index > 0) {
      const prev = tiers[index - 1];

      if (!prev) {
        return false;
      }
      const prevMax = prev.maxSales ?? Number.MAX_SAFE_INTEGER;

      if (current.minSales <= prevMax) {
        return false;
      }
      if (prev.maxSales === null) {
        return false;
      }
    }
  }

  return true;
}

export function normalizeCategoryBonusRule(raw: unknown, fallbackPercent: unknown): SalaryCategoryBonusRule {
  const row = asObject(raw);

  if (!row) {
    return createSimpleBonusRule(fallbackPercent);
  }
  const mode: SalaryRuleMode = SALARY_RULE_MODES.includes(row.mode as SalaryRuleMode)
    ? (row.mode as SalaryRuleMode)
    : 'simple';
  const simplePercent = normalizePercentage(row.simplePercent ?? fallbackPercent);
  const tierBasis = normalizeTierBasis(row.tierBasis);
  const tiers = (Array.isArray(row.tiers) ? row.tiers : [])
    .map((item) => normalizeSalaryTier(item))
    .filter((item): item is SalaryRuleTier => Boolean(item))
    .sort((a, b) => a.minSales - b.minSales);

  if (mode === 'tiered' && isValidTierSequence(tiers)) {
    return {
      mode: 'tiered',
      tierBasis,
      simplePercent,
      tiers,
    };
  }

  return createSimpleBonusRule(simplePercent, tierBasis);
}

/** What an agent has closed in a category this month; a tiered rule reads one of the two, per its `tierBasis`. */
export type TierProgress = {
  closedCount: number;
  closedAgreementAmount: number;
};

export function getTierMeasure(rule: SalaryCategoryBonusRule, progress: TierProgress): number {
  return rule.tierBasis === 'agreement_amount' ? progress.closedAgreementAmount : progress.closedCount;
}

/** The tier the progress falls in, or null when the rule is simple or no tier matches (the simple percent applies). */
export function findMatchingTier(rule: SalaryCategoryBonusRule, progress: TierProgress): SalaryRuleTier | null {
  if (rule.mode !== 'tiered') {
    return null;
  }
  const measure = getTierMeasure(rule, progress);

  return rule.tiers.find((tier) => measure >= tier.minSales && (tier.maxSales === null || measure <= tier.maxSales)) ?? null;
}

export function resolveBonusPercent(rule: SalaryCategoryBonusRule, progress: TierProgress): number {
  const tier = findMatchingTier(rule, progress);

  return normalizePercentage(tier ? tier.percent : rule.simplePercent);
}

/** True when a tiered rule had no matching tier and fell back to its simple percent. */
export function usedTierFallback(rule: SalaryCategoryBonusRule, progress: TierProgress): boolean {
  return rule.mode === 'tiered' && !findMatchingTier(rule, progress);
}

export function toPositiveInteger(value: unknown): number {
  const parsed = Math.floor(toFiniteNumber(value, 0));

  return parsed > 0 ? parsed : 0;
}

export function normalizePlanBonus(raw: unknown): SalaryPlanBonus | null {
  const row = asObject(raw);

  if (!row) {
    return null;
  }
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  const periodMode = typeof row.periodMode === 'string' ? row.periodMode.trim() : '';
  const courseCategory = typeof row.courseCategory === 'string' ? row.courseCategory.trim() : '';

  if (!id || !name) {
    return null;
  }
  if (!PLAN_BONUS_PERIOD_MODES.includes(periodMode as PlanBonusPeriodMode)) {
    return null;
  }
  if (!PLAN_BONUS_CATEGORIES.includes(courseCategory as PlanBonusCategory)) {
    return null;
  }

  const targetClosedSales = toPositiveInteger(row.targetClosedSales);
  const bonusAmount = toPositiveInteger(row.bonusAmount);

  if (targetClosedSales <= 0 || bonusAmount <= 0) {
    return null;
  }

  const createdAt = typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString();
  const updatedAt = typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString();

  return {
    id,
    name,
    isActive: row.isActive !== false,
    periodMode: periodMode as PlanBonusPeriodMode,
    courseCategory: courseCategory as PlanBonusCategory,
    courseId: typeof row.courseId === 'string' && row.courseId.trim() ? row.courseId.trim() : null,
    tariffId: typeof row.tariffId === 'string' && row.tariffId.trim() ? row.tariffId.trim() : null,
    subTariffId: typeof row.subTariffId === 'string' && row.subTariffId.trim() ? row.subTariffId.trim() : null,
    subTariffName: typeof row.subTariffName === 'string' && row.subTariffName.trim() ? row.subTariffName.trim() : null,
    targetClosedSales,
    bonusAmount,
    createdAt,
    updatedAt,
  };
}

export function extractSalarySettings(settings: unknown): SalarySettingsSnapshot {
  const settingsObject = asObject(settings);
  const salarySettings = asObject(settingsObject?.salary);
  const rawPercentages = asObject(salarySettings?.bonusPercentages);
  const rawRules = asObject(salarySettings?.bonusRules);
  const rawFixedSalaries = Array.isArray(salarySettings?.fixedSalaries) ? salarySettings.fixedSalaries : [];
  const rawPlanBonuses = Array.isArray(salarySettings?.planBonuses) ? salarySettings.planBonuses : [];
  const rawMode = typeof salarySettings?.bonusMode === 'string' ? salarySettings.bonusMode : null;
  const bonusMode: SalaryBonusMode = rawMode === 'on_debt_closed' ? 'on_debt_closed' : 'on_income';

  const bonusPercentages: SalaryBreakdown = {
    online: normalizePercentage(rawPercentages?.online),
    offline: normalizePercentage(rawPercentages?.offline),
    intensive: normalizePercentage(rawPercentages?.intensive),
    additional_service: normalizePercentage(rawPercentages?.additional_service),
  };
  const bonusRules: SalaryBonusRules = {
    online: normalizeCategoryBonusRule(rawRules?.online, bonusPercentages.online),
    offline: normalizeCategoryBonusRule(rawRules?.offline, bonusPercentages.offline),
    intensive: normalizeCategoryBonusRule(rawRules?.intensive, bonusPercentages.intensive),
    additional_service: normalizeCategoryBonusRule(rawRules?.additional_service, bonusPercentages.additional_service),
  };

  const fixedSalaries = new Map<string, number>();

  for (const item of rawFixedSalaries) {
    const row = asObject(item);

    if (!row) {
      continue;
    }
    const userId = typeof row?.userId === 'string' ? row.userId : '';

    if (!userId) {
      continue;
    }
    fixedSalaries.set(userId, Math.max(0, Math.round(toFiniteNumber(row?.amount, 0))));
  }

  const planBonuses = rawPlanBonuses
    .map((item) => normalizePlanBonus(item))
    .filter((item): item is SalaryPlanBonus => Boolean(item));

  const rawKpi = asObject(salarySettings?.kpiSettings);
  const rawKpiThresholds = asObject(rawKpi?.thresholds);
  const parseThreshold = (raw: unknown): KpiThreshold => {
    const obj = asObject(raw);

    return {
      full: toFiniteNumber(obj?.full, 0),
      half: toFiniteNumber(obj?.half, 0),
    };
  };
  const selectedMetrics = parseSelectedKpiMetrics(rawKpi?.selectedMetrics);
  const fallbackSelectedMetrics = DEFAULT_SELECTED_KPI_METRICS;
  const thresholds = KPI_METRIC_KEYS.reduce((acc, metric) => {
    const rawThreshold = (() => {
      if (metric === 'conversion') return rawKpiThresholds?.conversion ?? rawKpiThresholds?.conversionRate;
      if (metric === 'avgDailyTalkTime') return rawKpiThresholds?.avgDailyTalkTime ?? rawKpiThresholds?.dailyTalkTime;
      if (metric === 'debtCollectPercent') return rawKpiThresholds?.debtCollectPercent ?? rawKpiThresholds?.debtCollectionRate;
      if (metric === 'avgLeadResponseTime') return rawKpiThresholds?.avgLeadResponseTime;
      if (metric === 'callCount') return rawKpiThresholds?.callCount;
      if (metric === 'followUpCount') return rawKpiThresholds?.followUpCount;
      if (metric === 'followUpDonePercent') return rawKpiThresholds?.followUpDonePercent;

      return rawKpiThresholds?.stageChangeCount;
    })();

    acc[metric] = parseThreshold(rawThreshold);

    return acc;
  }, {} as Record<KpiMetricKey, KpiThreshold>);
  const kpiSettings: KpiSettings = {
    enabled: rawKpi?.enabled === true,
    monthlyBudget: Math.max(0, Math.round(toFiniteNumber(rawKpi?.monthlyBudget, 0))),
    selectedMetrics: selectedMetrics.length > 0 ? selectedMetrics : fallbackSelectedMetrics,
    thresholds,
  };

  const rawAttendancePenalty = asObject(salarySettings?.attendancePenaltySettings);
  const parsePenaltyTarget = (value: unknown, fallback: 'fixed' | 'kpi'): 'fixed' | 'kpi' => {
    return value === 'fixed' || value === 'kpi' ? value : fallback;
  };
  const fallbackTarget: 'fixed' | 'kpi' = rawAttendancePenalty?.applyToFixedSalary === true ? 'fixed' : 'kpi';
  const attendancePenaltySettings: AttendancePenaltySettings = {
    lateMinutePenaltyUZS: Math.max(0, Math.round(toFiniteNumber(rawAttendancePenalty?.lateMinutePenaltyUZS, 0))),
    missingHourPenaltyUZS: Math.max(0, Math.round(toFiniteNumber(rawAttendancePenalty?.missingHourPenaltyUZS, 0))),
    absenceDayPenaltyUZS: Math.max(0, Math.round(toFiniteNumber(rawAttendancePenalty?.absenceDayPenaltyUZS, 0))),
    applyToFixedSalary:
      rawAttendancePenalty?.applyToFixedSalary === true
      || Math.max(0, Math.round(toFiniteNumber(rawAttendancePenalty?.absenceDayPenaltyUZS, 0))) > 0,
    applyToKpi: rawAttendancePenalty?.applyToKpi === true,
    latePenaltyTarget: parsePenaltyTarget(rawAttendancePenalty?.latePenaltyTarget, fallbackTarget),
    missingHourPenaltyTarget: parsePenaltyTarget(rawAttendancePenalty?.missingHourPenaltyTarget, fallbackTarget),
    absenceDayPenaltyTarget: 'fixed',
    monthlyPenaltyCapUZS: Math.max(0, Math.round(toFiniteNumber(rawAttendancePenalty?.monthlyPenaltyCapUZS, 0))),
  };

  return {
    bonusMode,
    bonusPercentages,
    bonusRules,
    fixedSalaries,
    planBonuses,
    kpiSettings,
    attendancePenaltySettings,
  };
}

export function getBonusAmount(amount: number, percentage: number): number {
  if (amount <= 0 || percentage <= 0) {
    return 0;
  }

  return Math.round((amount * percentage) / 100);
}

/** The tenant's salary settings and its active agents and team leaders (by name), for the salary and bonus screens. */
export async function loadSalarySettingsAndAgents(db: DbClient, tenantId: string) {
  const [settings, allAgents] = await Promise.all([
    loadTenantSettings(db, tenantId),
    db.user.findMany({
      where: {
        tenantId,
        isActive: true,
        roles: {
          hasSome: [...AGENT_ROLES, ...TEAM_LEADER_ROLES],
        },
      },
      orderBy: [{ name: 'asc' }, { username: 'asc' }],
      select: {
        id: true,
        name: true,
        username: true,
      },
    }),
  ]);

  return { salarySettings: extractSalarySettings(settings), allAgents };
}
