import { PLAN_BONUS_PERIOD_MODES, type PlanBonusPeriodMode, SALARY_RULE_MODES, type SalaryBonusMode, type SalaryRuleMode } from '@dashboarduz/shared';

export { dashboardWidgetIdSchema, dashboardCustomSalesWidgetSchema, dashboardLayoutInputSchema, type DashboardCustomSalesWidget, type DashboardUserLayout, normalizeDashboardUserLayout } from '../../../services/dashboard/layout';
export { PIE_COLORS, toPieData, buildFieldLabelMap, collectCatalogFieldOptions, isMappedValue, normalizeCourseCategoryName, classifyCourseCategory, classifyCourseCategoryFromField } from '../../../services/dashboard/catalog-fields';
export { type DashboardRange, REPORT_MONTH_LABELS_UZ, getDaysInReportLocalMonth, getReportLocalDayOfYear, getReportLocalDaysInYear, getReportLocalDayOfYearForMonthEnd, buildTrend, getCurrentMonthRange } from '../../../services/dashboard/report-dates';
export { SALARY_CATEGORIES, PLAN_BONUS_CATEGORIES, type SalaryCategory, type SalaryBreakdown, type SalaryRuleTier, type SalaryCategoryBonusRule, type SalaryBonusRules, type PlanBonusCategory, type SalaryPlanBonus, type KpiThreshold, KPI_METRIC_KEYS, type KpiMetricKey, type KpiSettings, type AttendancePenaltySettings, type SalarySettingsSnapshot, createZeroBreakdown, createSimpleBonusRule, normalizeSalaryTier, isValidTierSequence, normalizeCategoryBonusRule, resolveBonusPercent, toPositiveInteger, normalizePlanBonus, extractSalarySettings, getBonusAmount } from '../../../services/dashboard/salary-settings';

export { PLAN_BONUS_PERIOD_MODES, SALARY_RULE_MODES, type PlanBonusPeriodMode, type SalaryBonusMode, type SalaryRuleMode };

// Re-export commonly used items from dependencies so procedure files can import from helpers
export { TRPCError } from '@trpc/server';

export { z } from 'zod';

export {
  asStringArray,
  extractLeadValue,
  getSystemLeadFieldOptions,
  getTenantAmoCRMContext,
  humanizeKey,
  normalizeIdentifier,
  type LeadFieldOption,
} from '../../../services/integrations/amocrm-live';

export { amocrmService } from '../../../services/integrations/amocrm';

export {
  createAmoCRMActivityDiagnostics,
  getAmoCRMActivityMetrics,
  summarizeAmoCRMActivityMetrics,
  type AmoCRMActivityDiagnostics,
} from '../../../services/integrations/amocrm-activity';

export { adminProcedure, protectedProcedure, router } from '../../trpc';
