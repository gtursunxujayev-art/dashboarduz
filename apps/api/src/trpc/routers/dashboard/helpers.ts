import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  asObject,
  asStringArray,
  type LeadFieldOption,
} from '../../../services/integrations/amocrm-live';
import { prisma } from '@dashboarduz/db';
import { amocrmService } from '../../../services/integrations/amocrm';
import { normalizeIdentifier, getSystemLeadFieldOptions } from '../../../services/integrations/amocrm-live';

export const dashboardRangeSchema = z.enum(['today', 'week', 'month', 'custom']);
export const dashboardWidgetIdSchema = z.string().min(1).max(120);
export const dashboardCustomSalesWidgetSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  courseId: z.string().uuid(),
  tariffId: z.string().uuid().nullable().optional(),
  subTariffId: z.string().uuid().nullable().optional(),
});
export const dashboardLayoutInputSchema = z.object({
  visibleWidgetIds: z.array(dashboardWidgetIdSchema).max(100),
  customSalesWidgets: z.array(dashboardCustomSalesWidgetSchema).max(30),
});

export const PIE_COLORS = [
  '#22C55E',
  '#3B82F6',
  '#A855F7',
  '#F97316',
  '#EF4444',
  '#EAB308',
  '#14B8A6',
  '#EC4899',
  '#6366F1',
  '#84CC16',
] as const;

export type DashboardRange = z.infer<typeof dashboardRangeSchema>;

export const REPORT_TZ_OFFSET_MINUTES = 5 * 60; // GMT+5
export const REPORT_TZ_OFFSET_MS = REPORT_TZ_OFFSET_MINUTES * 60 * 1000;
export const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);
export const UTEL_MIN_EXTENSION = 100;
export const UTEL_MAX_EXTENSION = 150;
export const SALARY_CATEGORIES = ['online', 'offline', 'intensive'] as const;
export const SALARY_RULE_MODES = ['simple', 'tiered'] as const;
export const PLAN_BONUS_CATEGORIES = ['online', 'offline', 'intensive', 'additional_service'] as const;
export const PLAN_BONUS_PERIOD_MODES = ['monthly', 'all_time'] as const;
export const REPORT_MONTH_LABELS_UZ = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'] as const;
export const INCOME_LIFECYCLE_ACTIVE = 'active';
export const INCOME_LIFECYCLE_PENDING_REFUND = 'pending_refund';
export const INCOME_LIFECYCLE_REFUNDED = 'refunded';

export type SalaryCategory = (typeof SALARY_CATEGORIES)[number];
export type SalaryRuleMode = (typeof SALARY_RULE_MODES)[number];
export type SalaryBonusMode = 'on_income' | 'on_debt_closed';
export type SalaryBreakdown = Record<SalaryCategory, number>;
export type SalaryRuleTier = {
  minSales: number;
  maxSales: number | null;
  percent: number;
};
export type SalaryCategoryBonusRule = {
  mode: SalaryRuleMode;
  simplePercent: number;
  tiers: SalaryRuleTier[];
};
export type SalaryBonusRules = Record<SalaryCategory, SalaryCategoryBonusRule>;
export type PlanBonusCategory = (typeof PLAN_BONUS_CATEGORIES)[number];
export type PlanBonusPeriodMode = (typeof PLAN_BONUS_PERIOD_MODES)[number];
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

export type KpiSettings = {
  enabled: boolean;
  monthlyBudget: number;
  thresholds: {
    conversionRate: KpiThreshold;
    dailyTalkTime: KpiThreshold;
    debtCollectionRate: KpiThreshold;
    followUpCount: KpiThreshold;
  };
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

export function isMissingUserMappingColumnError(error: unknown) {
  const message = String((error as any)?.message || '');
  return message.includes('amocrmResponsibleUserId') || message.includes('utelManagerExternalId');
}

export function normalizeTextToken(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function normalizeDigits(value: unknown): string {
  return String(value || '').replace(/[^\d]/g, '');
}

export type DashboardCustomSalesWidget = {
  id: string;
  title: string;
  courseId: string;
  tariffId: string | null;
  subTariffId: string | null;
};

export type DashboardUserLayout = {
  visibleWidgetIds: string[];
  customSalesWidgets: DashboardCustomSalesWidget[];
};

export function normalizeDashboardUserLayout(value: unknown): DashboardUserLayout {
  const row = asObject(value);
  const visibleWidgetIds = asStringArray(row?.visibleWidgetIds);
  const customSalesWidgets = Array.isArray(row?.customSalesWidgets)
    ? row.customSalesWidgets
        .map((item) => {
          const parsed = dashboardCustomSalesWidgetSchema.safeParse(item);
          if (!parsed.success) {
            return null;
          }
          return {
            id: parsed.data.id,
            title: parsed.data.title.trim(),
            courseId: parsed.data.courseId,
            tariffId: parsed.data.tariffId ?? null,
            subTariffId: parsed.data.subTariffId ?? null,
          };
        })
        .filter((item): item is DashboardCustomSalesWidget => Boolean(item))
    : [];

  return {
    visibleWidgetIds,
    customSalesWidgets,
  };
}

export function isAllowedUtelManagerExtension(value: unknown): boolean {
  const digits = normalizeDigits(value);
  if (!digits) {
    return false;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed >= UTEL_MIN_EXTENSION && parsed <= UTEL_MAX_EXTENSION;
}

export function extractUtelManagerKey(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const data = metadata as Record<string, unknown>;
  const extension = normalizeTextToken(data.extension || data.ext || data.internal || data.line);
  const managerName = normalizeTextToken(
    data.manager || data.agent || data.user || data.operator || data.responsible || data.employee,
  );
  return extension || managerName || null;
}

export function resolveCallExtension(call: { from: string; to: string; direction: string; metadata: unknown }): string | null {
  const metadataData = call.metadata && typeof call.metadata === 'object'
    ? (call.metadata as Record<string, unknown>)
    : null;
  const metadataExtension = normalizeDigits(
    metadataData?.normalized_extension
    || metadataData?.extension
    || metadataData?.ext
    || metadataData?.internal
    || metadataData?.line,
  );
  if (isAllowedUtelManagerExtension(metadataExtension)) {
    return metadataExtension;
  }

  const fromDigits = normalizeDigits(call.from);
  const toDigits = normalizeDigits(call.to);
  const direction = String(call.direction || '').toLowerCase();

  if (direction === 'outbound') {
    if (isAllowedUtelManagerExtension(fromDigits)) return fromDigits;
    if (isAllowedUtelManagerExtension(toDigits)) return toDigits;
  }

  if (direction === 'inbound') {
    if (isAllowedUtelManagerExtension(toDigits)) return toDigits;
    if (isAllowedUtelManagerExtension(fromDigits)) return fromDigits;
  }

  if (isAllowedUtelManagerExtension(fromDigits)) return fromDigits;
  if (isAllowedUtelManagerExtension(toDigits)) return toDigits;
  return null;
}

export async function getAgentResponsibleScope(tenantId: string, userId: string, roles: string[]) {
  const isAgentOnly = roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));
  if (!isAgentOnly) {
    return { isScoped: false, responsibleUserId: null as string | null };
  }

  let currentUser: { amocrmResponsibleUserId: string | null } | null = null;
  try {
    currentUser = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        isActive: true,
      },
      select: {
        amocrmResponsibleUserId: true,
      },
    });
  } catch (error: any) {
    if (!String(error?.message || '').includes('amocrmResponsibleUserId')) {
      throw error;
    }
  }

  return {
    isScoped: true,
    responsibleUserId: currentUser?.amocrmResponsibleUserId || null,
  };
}

export function getRangeStart(range: DashboardRange, now: Date): Date {
  const offsetMs = REPORT_TZ_OFFSET_MS;
  const shiftedNow = new Date(now.getTime() + offsetMs);

  const year = shiftedNow.getUTCFullYear();
  const month = shiftedNow.getUTCMonth();
  const date = shiftedNow.getUTCDate();

  if (range === 'today') {
    return new Date(Date.UTC(year, month, date) - offsetMs);
  }

  if (range === 'week') {
    const day = shiftedNow.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    return new Date(Date.UTC(year, month, date - daysSinceMonday) - offsetMs);
  }

  return new Date(Date.UTC(year, month, 1) - offsetMs);
}

export function shiftToReportTimezone(date: Date): Date {
  return new Date(date.getTime() + REPORT_TZ_OFFSET_MS);
}

export function fromReportLocalParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  return new Date(Date.UTC(year, month, day, hour, minute, second, millisecond) - REPORT_TZ_OFFSET_MS);
}

export function getDaysInReportLocalMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function getReportLocalDayKey(date: Date): string {
  const shifted = shiftToReportTimezone(date);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getReportLocalDayOfYear(date: Date): number {
  const shifted = shiftToReportTimezone(date);
  const year = shifted.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const currentDay = Date.UTC(year, shifted.getUTCMonth(), shifted.getUTCDate());
  return Math.floor((currentDay - yearStart) / 86_400_000) + 1;
}

export function getReportLocalDaysInYear(year: number): number {
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeapYear ? 366 : 365;
}

export function getReportLocalDayOfYearForMonthEnd(year: number, month: number): number {
  const yearStart = Date.UTC(year, 0, 1);
  const monthEnd = Date.UTC(year, month + 1, 0);
  return Math.floor((monthEnd - yearStart) / 86_400_000) + 1;
}

export function buildTrend(currentValue: number, previousValue: number) {
  const diffAmount = currentValue - previousValue;
  let diffPercent = 0;

  if (previousValue > 0) {
    diffPercent = (diffAmount / previousValue) * 100;
  } else if (currentValue > 0) {
    diffPercent = 100;
  }

  const direction = diffAmount > 0 ? 'up' : diffAmount < 0 ? 'down' : 'flat';

  return {
    currentValue,
    previousValue,
    diffAmount,
    diffPercent: Number(diffPercent.toFixed(2)),
    direction,
  };
}

export function parseCustomDate(input: string, endOfDay: boolean): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Custom date must be in YYYY-MM-DD format.' });
  }

  const timestamp = `${input}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+05:00`;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid custom date: ${input}` });
  }

  return parsed;
}

export function resolveDateRange(range: DashboardRange, now: Date, dateFrom?: string, dateTo?: string) {
  if (range !== 'custom') {
    return {
      rangeStart: getRangeStart(range, now),
      rangeEnd: now,
    };
  }

  if (!dateFrom || !dateTo) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Both dateFrom and dateTo are required when range is custom.',
    });
  }

  const rangeStart = parseCustomDate(dateFrom, false);
  const rangeEnd = parseCustomDate(dateTo, true);
  if (rangeEnd < rangeStart) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'dateTo must be greater than or equal to dateFrom.' });
  }

  return { rangeStart, rangeEnd };
}

export function isFinanceOnly(roles: string[]): boolean {
  return roles.includes('Finance') && !roles.some((role) => role === 'Admin' || role === 'Manager' || role === 'TeamLeader' || role === 'Agent');
}

export function isTashkiliyOnly(roles: string[]): boolean {
  return roles.includes('Tashkiliy')
    && !roles.includes('Admin')
    && !roles.includes('Manager')
    && !roles.includes('TeamLeader')
    && !roles.includes('Agent')
    && !roles.includes('Finance');
}

export function toPieData(input: Map<string, number>) {
  return Array.from(input.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({
      name,
      value,
      color: PIE_COLORS[index % PIE_COLORS.length],
    }));
}

export function buildFieldLabelMap(options: LeadFieldOption[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const option of options) {
    labels.set(option.key, option.label);
  }
  return labels;
}

export async function collectCatalogFieldOptions(tenantId: string): Promise<LeadFieldOption[]> {
  const context = await (await import('../../../services/integrations/amocrm-live')).getTenantAmoCRMContext(tenantId);
  if (!context) {
    return [];
  }

  try {
    const catalog = await amocrmService.fetchLeadCustomFields(context.accessToken, context.baseUrl);
    const fields = Array.isArray(catalog?._embedded?.custom_fields) ? catalog._embedded.custom_fields : [];

    const options: LeadFieldOption[] = [];
    for (const field of fields) {
      const identifier = normalizeIdentifier(field.code || field.name || field.id);
      if (!identifier) {
        continue;
      }

      options.push({
        key: `amocrm_custom:${identifier}`,
        label: String(field.name || field.code || field.id || identifier),
        source: 'catalog',
      });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

export function isMappedValue(value: string | null, targetValues: string[]): boolean {
  if (!value) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return targetValues.some((target) => target.trim().toLowerCase() === normalizedValue);
}

export function normalizeCourseCategoryName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function classifyCourseCategory(courseName: string | null | undefined): 'online' | 'offline' | 'intensive' | 'other' {
  const normalized = normalizeCourseCategoryName(courseName);
  if (!normalized) {
    return 'other';
  }

  if (
    normalized.includes('online')
    || normalized.includes('onlayn')
    || normalized.includes('онлайн')
  ) {
    return 'online';
  }

  if (
    normalized.includes('offline')
    || normalized.includes('oflayn')
    || normalized.includes('офлайн')
  ) {
    return 'offline';
  }

  if (
    normalized.includes('intensive')
    || normalized.includes('intensiv')
    || normalized.includes('интенсив')
  ) {
    return 'intensive';
  }

  return 'other';
}

export function classifyCourseCategoryFromField(
  category: string | null | undefined,
): 'online' | 'offline' | 'intensive' | 'other' {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'online' || normalized === 'offline' || normalized === 'intensive') {
    return normalized;
  }
  return classifyCourseCategory(category);
}

export function isAgentOnly(roles: string[]): boolean {
  return roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));
}

export function getCurrentMonthRange(now: Date) {
  return {
    monthStart: getRangeStart('month', now),
    monthEnd: now,
  };
}

export function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function normalizePercentage(value: unknown): number {
  const parsed = toFiniteNumber(value, 0);
  if (parsed <= 0) {
    return 0;
  }
  if (parsed >= 100) {
    return 100;
  }
  return Number(parsed.toFixed(2));
}

export function createZeroBreakdown(): SalaryBreakdown {
  return {
    online: 0,
    offline: 0,
    intensive: 0,
  };
}

export function createSimpleBonusRule(percent: unknown): SalaryCategoryBonusRule {
  return {
    mode: 'simple',
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
  const tiers = (Array.isArray(row.tiers) ? row.tiers : [])
    .map((item) => normalizeSalaryTier(item))
    .filter((item): item is SalaryRuleTier => Boolean(item))
    .sort((a, b) => a.minSales - b.minSales);

  if (mode === 'tiered' && isValidTierSequence(tiers)) {
    return {
      mode: 'tiered',
      simplePercent,
      tiers,
    };
  }

  return createSimpleBonusRule(simplePercent);
}

export function resolveBonusPercent(rule: SalaryCategoryBonusRule, closedSalesCount: number): number {
  if (rule.mode === 'simple') {
    return normalizePercentage(rule.simplePercent);
  }
  if (closedSalesCount <= 0 || !rule.tiers.length) {
    return 0;
  }
  let matchedPercent = 0;
  for (const tier of rule.tiers) {
    const withinMin = closedSalesCount >= tier.minSales;
    const withinMax = tier.maxSales === null || closedSalesCount <= tier.maxSales;
    if (withinMin && withinMax) {
      matchedPercent = tier.percent;
    }
  }
  return normalizePercentage(matchedPercent);
}

export function toPositiveInteger(value: unknown): number {
  const parsed = Math.floor(toFiniteNumber(value, 0));
  return parsed > 0 ? parsed : 0;
}

export function normalizeSubTariffName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
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
  };
  const bonusRules: SalaryBonusRules = {
    online: normalizeCategoryBonusRule(rawRules?.online, bonusPercentages.online),
    offline: normalizeCategoryBonusRule(rawRules?.offline, bonusPercentages.offline),
    intensive: normalizeCategoryBonusRule(rawRules?.intensive, bonusPercentages.intensive),
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
  const kpiSettings: KpiSettings = {
    enabled: rawKpi?.enabled === true,
    monthlyBudget: Math.max(0, Math.round(toFiniteNumber(rawKpi?.monthlyBudget, 0))),
    thresholds: {
      conversionRate: parseThreshold(rawKpiThresholds?.conversionRate),
      dailyTalkTime: parseThreshold(rawKpiThresholds?.dailyTalkTime),
      debtCollectionRate: parseThreshold(rawKpiThresholds?.debtCollectionRate),
      followUpCount: parseThreshold(rawKpiThresholds?.followUpCount),
    },
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
    applyToFixedSalary: rawAttendancePenalty?.applyToFixedSalary === true,
    applyToKpi: rawAttendancePenalty?.applyToKpi === true,
    latePenaltyTarget: parsePenaltyTarget(rawAttendancePenalty?.latePenaltyTarget, fallbackTarget),
    missingHourPenaltyTarget: parsePenaltyTarget(rawAttendancePenalty?.missingHourPenaltyTarget, fallbackTarget),
    absenceDayPenaltyTarget: parsePenaltyTarget(rawAttendancePenalty?.absenceDayPenaltyTarget, 'fixed'),
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

// Re-export commonly used items from dependencies so procedure files can import from helpers
export { prisma } from '@dashboarduz/db';
export { TRPCError } from '@trpc/server';
export { z } from 'zod';
export {
  asObject,
  asStringArray,
  extractLeadValue,
  getSystemLeadFieldOptions,
  getTenantAmoCRMContext,
  humanizeKey,
  normalizeIdentifier,
  type LeadFieldOption,
} from '../../../services/integrations/amocrm-live';
export { amocrmService } from '../../../services/integrations/amocrm';
export { getAmoCRMActivityMetrics, summarizeAmoCRMActivityMetrics } from '../../../services/integrations/amocrm-activity';
export { LogLevel, log } from '../../../services/observability';
export { adminProcedure, protectedProcedure, router } from '../../trpc';
