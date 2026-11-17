import { normalizePercentage } from '../../lib/number';
import { asObjectOrEmpty, toFiniteNumber } from '../../lib/object';
import { DEFAULT_SELECTED_KPI_METRICS, parseSelectedKpiMetrics } from '../dashboard/salary-settings';

import { type AttendancePenaltySettings, BONUS_RULE_MODES, BONUS_TIER_BASES, type BonusTierBasis, type BonusBaseMode, type BonusRuleMode, type BonusRuleTier, type FixedSalaryRow, KPI_METRIC_KEYS, type KpiMetricKey, type KpiSettings, type KpiThreshold, type SalaryBonusRules, type SalaryCategoryBonusRule } from './types';

function normalizeTier(raw: unknown): BonusRuleTier | null {
  const row = asObjectOrEmpty(raw);
  const minSales = Math.floor(toFiniteNumber(row.minSales, 0));
  const maxValue = row.maxSales;
  const maxSales =
    maxValue === null || maxValue === undefined || maxValue === ''
      ? null
      : Math.floor(toFiniteNumber(maxValue, 0));
  const percent = normalizePercentage(row.percent);

  if (minSales <= 0 || percent <= 0) {
    return null;
  }
  if (maxSales !== null && maxSales < minSales) {
    return null;
  }

  return { minSales, maxSales, percent };
}

export function validateTierRules(tiers: BonusRuleTier[]): string | null {
  if (!tiers.length) {
    return "Tiered rejimda kamida bitta diapazon bo'lishi shart.";
  }

  for (let index = 0; index < tiers.length; index += 1) {
    const current = tiers[index];

    if (!current) {
      return "Bonus diapazoni noto'g'ri.";
    }
    if (current.minSales <= 0) {
      return "Diapazon boshlanishi 0 dan katta bo'lishi kerak.";
    }
    if (current.percent <= 0) {
      return "Diapazon bonus foizi 0 dan katta bo'lishi kerak.";
    }
    if (current.maxSales !== null && current.maxSales < current.minSales) {
      return "Diapazon tugashi boshlanishidan kichik bo'lishi mumkin emas.";
    }
    if (current.maxSales === null && index !== tiers.length - 1) {
      return "Ochiq diapazon (max bo'sh) faqat oxirgi qatorda bo'lishi mumkin.";
    }
    if (index > 0) {
      const prev = tiers[index - 1];

      if (!prev) {
        return "Bonus diapazonlari tartibi noto'g'ri.";
      }
      const prevMax = prev.maxSales ?? Number.MAX_SAFE_INTEGER;

      if (current.minSales <= prevMax) {
        return "Bonus diapazonlari bir-birini kesib o'tmasligi kerak.";
      }
      if (prev.maxSales === null) {
        return "Ochiq diapazondan keyin yangi diapazon bo'lishi mumkin emas.";
      }
    }
  }

  return null;
}

function createSimpleRule(percent: unknown, tierBasis: BonusTierBasis): SalaryCategoryBonusRule {
  return {
    mode: 'simple',
    tierBasis,
    simplePercent: normalizePercentage(percent),
    tiers: [],
  };
}

export function sanitizeCategoryRule(rawRule: unknown, fallbackPercent: unknown): SalaryCategoryBonusRule {
  const row = asObjectOrEmpty(rawRule);
  const mode = BONUS_RULE_MODES.includes(row.mode as BonusRuleMode)
    ? (row.mode as BonusRuleMode)
    : 'simple';
  const simplePercent = normalizePercentage(row.simplePercent ?? fallbackPercent);
  const tierBasis: BonusTierBasis = BONUS_TIER_BASES.includes(row.tierBasis as BonusTierBasis)
    ? (row.tierBasis as BonusTierBasis)
    : 'sales_count';
  const rawTiers = Array.isArray(row.tiers) ? row.tiers : [];
  const tiers = rawTiers
    .map((tier) => normalizeTier(tier))
    .filter((tier): tier is BonusRuleTier => Boolean(tier))
    .sort((a, b) => a.minSales - b.minSales);

  if (mode === 'tiered') {
    const validationError = validateTierRules(tiers);

    if (!validationError) {
      return {
        mode: 'tiered',
        tierBasis,
        simplePercent,
        tiers,
      };
    }
  }

  return createSimpleRule(simplePercent, tierBasis);
}

export function parseFixedSalaries(settings: unknown): FixedSalaryRow[] {
  const settingsObject = asObjectOrEmpty(settings);
  const salarySettings = asObjectOrEmpty(settingsObject.salary);
  const fixedRows = Array.isArray(salarySettings.fixedSalaries) ? salarySettings.fixedSalaries : [];

  return fixedRows
    .map((raw) => {
      const row = asObjectOrEmpty(raw);
      const userId = typeof row.userId === 'string' ? row.userId.trim() : '';
      const amount = Math.max(0, Math.round(toFiniteNumber(row.amount, 0)));

      if (!userId || amount <= 0) {
        return null;
      }

      return { userId, amount };
    })
    .filter((row): row is FixedSalaryRow => Boolean(row));
}

export function parseBonusRules(settings: unknown): {
  bonusMode: BonusBaseMode;
  bonusRules: SalaryBonusRules;
} {
  const settingsObject = asObjectOrEmpty(settings);
  const salarySettings = asObjectOrEmpty(settingsObject.salary);
  const rawPercentages = asObjectOrEmpty(salarySettings.bonusPercentages);
  const rawRules = asObjectOrEmpty(salarySettings.bonusRules);
  const bonusMode: BonusBaseMode = salarySettings.bonusMode === 'on_debt_closed' ? 'on_debt_closed' : 'on_income';

  return {
    bonusMode,
    bonusRules: {
      online: sanitizeCategoryRule(rawRules.online, rawPercentages.online),
      offline: sanitizeCategoryRule(rawRules.offline, rawPercentages.offline),
      intensive: sanitizeCategoryRule(rawRules.intensive, rawPercentages.intensive),
      additional_service: sanitizeCategoryRule(rawRules.additional_service, rawPercentages.additional_service),
    },
  };
}

export function parseAttendancePenaltySettings(settings: unknown): AttendancePenaltySettings {
  const settingsObject = asObjectOrEmpty(settings);
  const salarySettings = asObjectOrEmpty(settingsObject.salary);
  const raw = asObjectOrEmpty(salarySettings.attendancePenaltySettings);
  const parseTarget = (value: unknown, fallback: 'fixed' | 'kpi'): 'fixed' | 'kpi' => {
    return value === 'fixed' || value === 'kpi' ? value : fallback;
  };
  const fallbackTarget: 'fixed' | 'kpi' = raw.applyToFixedSalary === true ? 'fixed' : 'kpi';

  return {
    lateMinutePenaltyUZS: Math.max(0, Math.round(toFiniteNumber(raw.lateMinutePenaltyUZS, 0))),
    missingHourPenaltyUZS: Math.max(0, Math.round(toFiniteNumber(raw.missingHourPenaltyUZS, 0))),
    absenceDayPenaltyUZS: Math.max(0, Math.round(toFiniteNumber(raw.absenceDayPenaltyUZS, 0))),
    applyToFixedSalary:
      raw.applyToFixedSalary === true
      || Math.max(0, Math.round(toFiniteNumber(raw.absenceDayPenaltyUZS, 0))) > 0,
    applyToKpi: raw.applyToKpi === true,
    latePenaltyTarget: parseTarget(raw.latePenaltyTarget, fallbackTarget),
    missingHourPenaltyTarget: parseTarget(raw.missingHourPenaltyTarget, fallbackTarget),
    absenceDayPenaltyTarget: 'fixed',
    monthlyPenaltyCapUZS: Math.max(0, Math.round(toFiniteNumber(raw.monthlyPenaltyCapUZS, 0))),
  };
}

function parseThreshold(raw: unknown): KpiThreshold {
  const row = asObjectOrEmpty(raw);

  return {
    full: Math.max(0, toFiniteNumber(row.full, 0)),
    half: Math.max(0, toFiniteNumber(row.half, 0)),
  };
}

export function parseKpiSettings(settings: unknown): KpiSettings {
  const settingsObject = asObjectOrEmpty(settings);
  const salarySettings = asObjectOrEmpty(settingsObject.salary);
  const rawKpi = asObjectOrEmpty(salarySettings.kpiSettings);
  const rawThresholds = asObjectOrEmpty(rawKpi.thresholds);

  const legacyMetricMap: Record<KpiMetricKey, unknown> = {
    conversion: rawThresholds.conversion ?? rawThresholds.conversionRate,
    avgDailyTalkTime: rawThresholds.avgDailyTalkTime ?? rawThresholds.dailyTalkTime,
    debtCollectPercent: rawThresholds.debtCollectPercent ?? rawThresholds.debtCollectionRate,
    avgLeadResponseTime: rawThresholds.avgLeadResponseTime,
    callCount: rawThresholds.callCount,
    followUpCount: rawThresholds.followUpCount,
    followUpDonePercent: rawThresholds.followUpDonePercent,
    stageChangeCount: rawThresholds.stageChangeCount,
  };

  const selectedMetrics = parseSelectedKpiMetrics(rawKpi.selectedMetrics);

  const fallbackSelectedMetrics = DEFAULT_SELECTED_KPI_METRICS;

  const thresholds = KPI_METRIC_KEYS.reduce((acc, metric) => {
    acc[metric] = parseThreshold(legacyMetricMap[metric]);

    return acc;
  }, {} as Record<KpiMetricKey, KpiThreshold>);

  return {
    enabled: rawKpi.enabled === true,
    monthlyBudget: Math.max(0, Math.round(toFiniteNumber(rawKpi.monthlyBudget, 0))),
    selectedMetrics: selectedMetrics.length > 0 ? selectedMetrics : fallbackSelectedMetrics,
    thresholds,
  };
}
