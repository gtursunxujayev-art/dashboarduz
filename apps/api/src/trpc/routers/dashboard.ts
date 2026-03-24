import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { amocrmService } from '../../services/integrations/amocrm';
import { getAmoCRMActivityMetrics, summarizeAmoCRMActivityMetrics } from '../../services/integrations/amocrm-activity';
import {
  asObject,
  asStringArray,
  extractLeadValue,
  getSystemLeadFieldOptions,
  getTenantAmoCRMContext,
  humanizeKey,
  normalizeIdentifier,
  type LeadFieldOption,
} from '../../services/integrations/amocrm-live';
import { LogLevel, log } from '../../services/observability';
import { adminProcedure, protectedProcedure, router } from '../trpc';

const dashboardRangeSchema = z.enum(['today', 'week', 'month', 'custom']);

const PIE_COLORS = [
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

type DashboardRange = z.infer<typeof dashboardRangeSchema>;

const REPORT_TZ_OFFSET_MINUTES = 5 * 60; // GMT+5
const REPORT_TZ_OFFSET_MS = REPORT_TZ_OFFSET_MINUTES * 60 * 1000;
const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'Finance']);
const UTEL_MIN_EXTENSION = 100;
const UTEL_MAX_EXTENSION = 150;
const SALARY_CATEGORIES = ['online', 'offline', 'intensive'] as const;
const PLAN_BONUS_CATEGORIES = ['online', 'offline', 'intensive', 'additional_service'] as const;
const PLAN_BONUS_PERIOD_MODES = ['monthly', 'all_time'] as const;
const REPORT_MONTH_LABELS_UZ = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'] as const;
const INCOME_LIFECYCLE_ACTIVE = 'active';
const INCOME_LIFECYCLE_PENDING_REFUND = 'pending_refund';
const INCOME_LIFECYCLE_REFUNDED = 'refunded';

type SalaryCategory = (typeof SALARY_CATEGORIES)[number];
type SalaryBonusMode = 'on_income' | 'on_debt_closed';
type SalaryBreakdown = Record<SalaryCategory, number>;
type PlanBonusCategory = (typeof PLAN_BONUS_CATEGORIES)[number];
type PlanBonusPeriodMode = (typeof PLAN_BONUS_PERIOD_MODES)[number];
type SalaryPlanBonus = {
  id: string;
  name: string;
  isActive: boolean;
  periodMode: PlanBonusPeriodMode;
  courseCategory: PlanBonusCategory;
  courseId: string | null;
  tariffId: string | null;
  subTariffId: string | null;
  targetClosedSales: number;
  bonusAmount: number;
  createdAt: string;
  updatedAt: string;
};

type SalarySettingsSnapshot = {
  bonusMode: SalaryBonusMode;
  bonusPercentages: SalaryBreakdown;
  fixedSalaries: Map<string, number>;
  planBonuses: SalaryPlanBonus[];
};

function isMissingUserMappingColumnError(error: unknown) {
  const message = String((error as any)?.message || '');
  return message.includes('amocrmResponsibleUserId') || message.includes('utelManagerExternalId');
}

function normalizeTextToken(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeDigits(value: unknown): string {
  return String(value || '').replace(/[^\d]/g, '');
}

function isAllowedUtelManagerExtension(value: unknown): boolean {
  const digits = normalizeDigits(value);
  if (!digits) {
    return false;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed >= UTEL_MIN_EXTENSION && parsed <= UTEL_MAX_EXTENSION;
}

function extractUtelManagerKey(metadata: unknown): string | null {
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

function resolveCallExtension(call: { from: string; to: string; direction: string; metadata: unknown }): string | null {
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

async function getAgentResponsibleScope(tenantId: string, userId: string, roles: string[]) {
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

function getRangeStart(range: DashboardRange, now: Date): Date {
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

function shiftToReportTimezone(date: Date): Date {
  return new Date(date.getTime() + REPORT_TZ_OFFSET_MS);
}

function fromReportLocalParts(
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

function getDaysInReportLocalMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function getReportLocalDayKey(date: Date): string {
  const shifted = shiftToReportTimezone(date);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getReportLocalDayOfYear(date: Date): number {
  const shifted = shiftToReportTimezone(date);
  const year = shifted.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const currentDay = Date.UTC(year, shifted.getUTCMonth(), shifted.getUTCDate());
  return Math.floor((currentDay - yearStart) / 86_400_000) + 1;
}

function getReportLocalDaysInYear(year: number): number {
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return isLeapYear ? 366 : 365;
}

function getReportLocalDayOfYearForMonthEnd(year: number, month: number): number {
  const yearStart = Date.UTC(year, 0, 1);
  const monthEnd = Date.UTC(year, month + 1, 0);
  return Math.floor((monthEnd - yearStart) / 86_400_000) + 1;
}

function buildTrend(currentValue: number, previousValue: number) {
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

function parseCustomDate(input: string, endOfDay: boolean): Date {
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

function resolveDateRange(range: DashboardRange, now: Date, dateFrom?: string, dateTo?: string) {
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

function isFinanceOnly(roles: string[]): boolean {
  return roles.includes('Finance') && !roles.some((role) => role === 'Admin' || role === 'Manager' || role === 'Agent');
}

function isTashkiliyOnly(roles: string[]): boolean {
  return roles.includes('Tashkiliy')
    && !roles.includes('Admin')
    && !roles.includes('Manager')
    && !roles.includes('Agent')
    && !roles.includes('Finance');
}

function toPieData(input: Map<string, number>) {
  return Array.from(input.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({
      name,
      value,
      color: PIE_COLORS[index % PIE_COLORS.length],
    }));
}

function buildFieldLabelMap(options: LeadFieldOption[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const option of options) {
    labels.set(option.key, option.label);
  }
  return labels;
}

async function collectCatalogFieldOptions(tenantId: string): Promise<LeadFieldOption[]> {
  const context = await getTenantAmoCRMContext(tenantId);
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

function isMappedValue(value: string | null, targetValues: string[]): boolean {
  if (!value) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return targetValues.some((target) => target.trim().toLowerCase() === normalizedValue);
}

function normalizeCourseCategoryName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function classifyCourseCategory(courseName: string | null | undefined): 'online' | 'offline' | 'intensive' | 'other' {
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

function classifyCourseCategoryFromField(
  category: string | null | undefined,
): 'online' | 'offline' | 'intensive' | 'other' {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'online' || normalized === 'offline' || normalized === 'intensive') {
    return normalized;
  }
  return classifyCourseCategory(category);
}

function isAgentOnly(roles: string[]): boolean {
  return roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));
}

function getCurrentMonthRange(now: Date) {
  return {
    monthStart: getRangeStart('month', now),
    monthEnd: now,
  };
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizePercentage(value: unknown): number {
  const parsed = toFiniteNumber(value, 0);
  if (parsed <= 0) {
    return 0;
  }
  if (parsed >= 100) {
    return 100;
  }
  return Number(parsed.toFixed(2));
}

function createZeroBreakdown(): SalaryBreakdown {
  return {
    online: 0,
    offline: 0,
    intensive: 0,
  };
}

function toPositiveInteger(value: unknown): number {
  const parsed = Math.floor(toFiniteNumber(value, 0));
  return parsed > 0 ? parsed : 0;
}

function normalizePlanBonus(raw: unknown): SalaryPlanBonus | null {
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
    targetClosedSales,
    bonusAmount,
    createdAt,
    updatedAt,
  };
}

function extractSalarySettings(settings: unknown): SalarySettingsSnapshot {
  const settingsObject = asObject(settings);
  const salarySettings = asObject(settingsObject?.salary);
  const rawPercentages = asObject(salarySettings?.bonusPercentages);
  const rawFixedSalaries = Array.isArray(salarySettings?.fixedSalaries) ? salarySettings.fixedSalaries : [];
  const rawPlanBonuses = Array.isArray(salarySettings?.planBonuses) ? salarySettings.planBonuses : [];
  const rawMode = typeof salarySettings?.bonusMode === 'string' ? salarySettings.bonusMode : null;
  const bonusMode: SalaryBonusMode = rawMode === 'on_debt_closed' ? 'on_debt_closed' : 'on_income';

  const bonusPercentages: SalaryBreakdown = {
    online: normalizePercentage(rawPercentages?.online),
    offline: normalizePercentage(rawPercentages?.offline),
    intensive: normalizePercentage(rawPercentages?.intensive),
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

  return {
    bonusMode,
    bonusPercentages,
    fixedSalaries,
    planBonuses,
  };
}

function getBonusAmount(amount: number, percentage: number): number {
  if (amount <= 0 || percentage <= 0) {
    return 0;
  }
  return Math.round((amount * percentage) / 100);
}

export const dashboardRouter = router({
  summary: protectedProcedure
    .input(
      z.object({
        range: dashboardRangeSchema,
        pipelineIds: z.array(z.string()).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const tashkiliyOnly = isTashkiliyOnly(ctx.user.roles);
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
      const tenant = await prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      });

      if (!tenant) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      }

      const settings = asObject(tenant.settings);
      const dashboardSettings = asObject(settings?.dashboard);
      const reasonFieldKey = typeof dashboardSettings?.reasonFieldKey === 'string' ? dashboardSettings.reasonFieldKey : null;
      const sourceFieldKey = typeof dashboardSettings?.sourceFieldKey === 'string' ? dashboardSettings.sourceFieldKey : null;
      const qualifiedValues = asStringArray(dashboardSettings?.qualifiedValues);
      const nonQualifiedValues = asStringArray(dashboardSettings?.nonQualifiedValues);
      const qualifiedStageIds = asStringArray(dashboardSettings?.qualifiedStageIds);

      const [amoContext, catalogOptions] = await Promise.all([
        getTenantAmoCRMContext(ctx.tenantId),
        collectCatalogFieldOptions(ctx.tenantId),
      ]);
      const fieldLabelMap = buildFieldLabelMap([...getSystemLeadFieldOptions(), ...catalogOptions]);
      const selectedPipelineIds = input.pipelineIds && input.pipelineIds.length > 0
        ? input.pipelineIds
        : (amoContext?.selectedPipelineIds ?? null);
      let leadsDataAvailable = false;
      let leads: any[] = [];
      if (amoContext && (!scope.isScoped || scope.responsibleUserId)) {
        try {
          leads = await amocrmService.fetchAllLeads(
            amoContext.accessToken,
            {
              pipelineIds: selectedPipelineIds,
              responsibleUserIds: scope.isScoped ? [scope.responsibleUserId as string] : undefined,
              createdAtFrom: rangeStart,
              createdAtTo: rangeEnd,
              limit: 250,
            },
            amoContext.baseUrl,
          ) as any[];
          leadsDataAvailable = true;
        } catch {
          leads = [];
          leadsDataAvailable = false;
        }
      }

      const [pendingNotifications, activeIntegrations, totalIncomeAggregate, newSalesIncomes, incomesForSellers, callsForSellers] = await Promise.all([
        scope.isScoped
          ? Promise.resolve(0)
          : prisma.notification.count({
              where: {
                tenantId: ctx.tenantId,
                status: {
                  in: ['pending', 'retrying'],
                },
                createdAt: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
              },
            }),
        scope.isScoped
          ? Promise.resolve(0)
          : prisma.integration.count({
              where: {
                tenantId: ctx.tenantId,
                status: 'active',
              },
            }),
        prisma.income.aggregate({
          where: {
            tenantId: ctx.tenantId,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: rangeStart,
              lte: rangeEnd,
            },
            ...(scope.isScoped
              ? {
                  managerUserId: ctx.user.userId,
                }
              : {}),
          },
          _sum: {
            paymentAmount: true,
          },
        }),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'new_sale',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: rangeStart,
              lte: rangeEnd,
            },
            ...(scope.isScoped
              ? {
                  managerUserId: ctx.user.userId,
                }
              : {}),
          },
          select: {
            paymentAmount: true,
            coursePriceAmount: true,
            managerUserId: true,
            course: {
              select: {
                name: true,
              },
            },
          },
        }),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: rangeStart,
              lte: rangeEnd,
            },
            ...(scope.isScoped
              ? {
                  managerUserId: ctx.user.userId,
                }
              : {}),
          },
          select: {
            managerUserId: true,
            type: true,
            paymentAmount: true,
            coursePriceAmount: true,
          },
        }),
        prisma.call.findMany({
          where: {
            tenantId: ctx.tenantId,
            provider: 'utel',
            startedAt: {
              gte: rangeStart,
              lte: rangeEnd,
            },
          },
          select: {
            from: true,
            to: true,
            direction: true,
            duration: true,
            metadata: true,
            lead: {
              select: {
                responsibleUserId: true,
              },
            },
          },
        }),
      ]);

      let agentUsers: Array<{
        id: string;
        name: string | null;
        username: string | null;
        amocrmResponsibleUserId: string | null;
        utelManagerExternalId: string | null;
      }> = [];
      try {
        agentUsers = await prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            roles: {
              has: 'Agent',
            },
            ...(scope.isScoped
              ? {
                  id: ctx.user.userId,
                }
              : {}),
          },
          orderBy: [{ name: 'asc' }, { username: 'asc' }],
          select: {
            id: true,
            name: true,
            username: true,
            amocrmResponsibleUserId: true,
            utelManagerExternalId: true,
          },
        });
      } catch (error) {
        if (!isMissingUserMappingColumnError(error)) {
          throw error;
        }
        const fallbackUsers = await prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            roles: {
              has: 'Agent',
            },
            ...(scope.isScoped
              ? {
                  id: ctx.user.userId,
                }
              : {}),
          },
          orderBy: [{ name: 'asc' }, { username: 'asc' }],
          select: {
            id: true,
            name: true,
            username: true,
          },
        });
        agentUsers = (fallbackUsers as Array<{ id: string; name: string | null; username: string | null }>)
          .map((user) => ({
            ...user,
            amocrmResponsibleUserId: null,
            utelManagerExternalId: null,
          }));
      }

      let activityFetchMs = 0;
      const activityFetchStartedMs = Date.now();
      const activityManagerIds = agentUsers
        .map((agent) => (agent.amocrmResponsibleUserId ? String(agent.amocrmResponsibleUserId).trim() : ''))
        .filter(Boolean);
      const activityByManager = amoContext && activityManagerIds.length > 0
        ? await getAmoCRMActivityMetrics({
            tenantId: ctx.tenantId,
            accessToken: amoContext.accessToken,
            baseUrl: amoContext.baseUrl,
            managerIds: activityManagerIds,
            rangeStart,
            rangeEnd,
            rangeKind: input.range,
          })
        : new Map();
      activityFetchMs = Date.now() - activityFetchStartedMs;
      const activityTotals = summarizeAmoCRMActivityMetrics(activityByManager);

      const reasonCounts = new Map<string, number>();
      const sourceCounts = new Map<string, number>();
      let qualifiedLeads = 0;
      let nonQualifiedLeads = 0;

      for (const lead of leads) {
        const reasonValue = extractLeadValue(lead, reasonFieldKey);
        const stageId = lead.status_id !== null && lead.status_id !== undefined ? String(lead.status_id) : null;
        const isQualifiedByStage = stageId ? qualifiedStageIds.includes(stageId) : false;
        const isQualified = qualifiedStageIds.length > 0
          ? isQualifiedByStage
          : isMappedValue(reasonValue, qualifiedValues);
        const isNonQualified = nonQualifiedValues.length > 0
          ? isMappedValue(reasonValue, nonQualifiedValues)
          : (!isQualified && Boolean(reasonValue));

        if (isQualified) {
          qualifiedLeads += 1;
        }

        if (isNonQualified) {
          nonQualifiedLeads += 1;
          if (reasonValue) {
            reasonCounts.set(reasonValue, (reasonCounts.get(reasonValue) ?? 0) + 1);
          }
        }

        if (sourceFieldKey) {
          const sourceValue = extractLeadValue(lead, sourceFieldKey) || 'Unknown source';
          sourceCounts.set(sourceValue, (sourceCounts.get(sourceValue) ?? 0) + 1);
        }
      }

      let onlineSalesCount = 0;
      let onlineSalesAgreementAmount = 0;
      let offlineSalesCount = 0;
      let offlineSalesAgreementAmount = 0;
      let intensiveSalesCount = 0;
      let intensiveSalesAgreementAmount = 0;
      let newSalesAgreementAmount = 0;

      for (const income of newSalesIncomes) {
        const agreementAmount = income.coursePriceAmount ?? income.paymentAmount ?? 0;
        newSalesAgreementAmount += agreementAmount;

        const category = classifyCourseCategoryFromField(income.course?.name);
        if (category === 'online') {
          onlineSalesCount += 1;
          onlineSalesAgreementAmount += agreementAmount;
          continue;
        }
        if (category === 'offline') {
          offlineSalesCount += 1;
          offlineSalesAgreementAmount += agreementAmount;
          continue;
        }
        if (category === 'intensive') {
          intensiveSalesCount += 1;
          intensiveSalesAgreementAmount += agreementAmount;
        }
      }

      const totalLeads = leads.length;
      const newSalesCount = newSalesIncomes.length;
      const qualifiedLeadSharePercent = totalLeads > 0 ? (qualifiedLeads / totalLeads) * 100 : 0;
      const nonQualifiedLeadSharePercent = totalLeads > 0 ? (nonQualifiedLeads / totalLeads) * 100 : 0;
      const conversionPercent = totalLeads > 0 ? (newSalesCount / totalLeads) * 100 : 0;
      const totalIncomeAmount = totalIncomeAggregate._sum.paymentAmount ?? 0;

      const leadsByResponsibleUser = new Map<string, { newLeads: number; qualifiedLeads: number }>();
      if (leadsDataAvailable) {
        for (const lead of leads) {
          const responsibleUserId = lead.responsible_user_id !== null && lead.responsible_user_id !== undefined
            ? String(lead.responsible_user_id)
            : '';
          if (!responsibleUserId) {
            continue;
          }
          const current = leadsByResponsibleUser.get(responsibleUserId) || { newLeads: 0, qualifiedLeads: 0 };
          current.newLeads += 1;

          const reasonValue = extractLeadValue(lead, reasonFieldKey);
          const stageId = lead.status_id !== null && lead.status_id !== undefined ? String(lead.status_id) : null;
          const isQualifiedByStage = stageId ? qualifiedStageIds.includes(stageId) : false;
          const isQualifiedLead = qualifiedStageIds.length > 0
            ? isQualifiedByStage
            : isMappedValue(reasonValue, qualifiedValues);
          if (isQualifiedLead) {
            current.qualifiedLeads += 1;
          }

          leadsByResponsibleUser.set(responsibleUserId, current);
        }
      }

      const salesByManager = new Map<string, { sales: number; agreementsAmount: number; incomeAmount: number }>();
      for (const income of incomesForSellers) {
        const current = salesByManager.get(income.managerUserId) || {
          sales: 0,
          agreementsAmount: 0,
          incomeAmount: 0,
        };

        current.incomeAmount += income.paymentAmount ?? 0;
        if (income.type === 'new_sale') {
          current.sales += 1;
          current.agreementsAmount += income.coursePriceAmount ?? income.paymentAmount ?? 0;
        }

        salesByManager.set(income.managerUserId, current);
      }

      const talkSecondsByAgent = new Map<string, number>();
      const callCountByAgent = new Map<string, number>();
      for (const agent of agentUsers) {
        const keyByUtel = normalizeTextToken(agent.utelManagerExternalId);
        const extensionByUtel = normalizeDigits(agent.utelManagerExternalId);
        const keyByAmo = normalizeTextToken(agent.amocrmResponsibleUserId);
        const hasCallMapping = Boolean(
          keyByUtel
          || keyByAmo
          || (extensionByUtel && isAllowedUtelManagerExtension(extensionByUtel)),
        );

        if (!hasCallMapping) {
          continue;
        }

        let talkSeconds = 0;
        let callCount = 0;
        for (const call of callsForSellers) {
          const callLeadResponsibleId = normalizeTextToken(call.lead?.responsibleUserId);
          const metadataKey = extractUtelManagerKey(call.metadata);
          const normalizedMetadataKey = normalizeTextToken(metadataKey);
          const callExtension = resolveCallExtension({
            from: call.from,
            to: call.to,
            direction: call.direction,
            metadata: call.metadata,
          });
          const normalizedCallExtension = normalizeDigits(callExtension);
          const matched = (keyByAmo && callLeadResponsibleId && keyByAmo === callLeadResponsibleId)
            || (keyByUtel && normalizedMetadataKey && keyByUtel === normalizedMetadataKey)
            || (extensionByUtel && normalizedCallExtension && extensionByUtel === normalizedCallExtension);

          if (matched) {
            callCount += 1;
            const callDuration = Math.max(0, call.duration ?? 0);
            talkSeconds += callDuration;
          }
        }

        talkSecondsByAgent.set(agent.id, talkSeconds);
        callCountByAgent.set(agent.id, callCount);
      }

      const scopedTotalCalls = scope.isScoped
        ? (callCountByAgent.get(ctx.user.userId) ?? 0)
        : callsForSellers.length;

      const sellerPerformance = agentUsers
        .map((agent) => {
          const responsibleUserId = agent.amocrmResponsibleUserId ? String(agent.amocrmResponsibleUserId) : '';
          const leadStats = responsibleUserId ? leadsByResponsibleUser.get(responsibleUserId) : undefined;
          const salesStats = salesByManager.get(agent.id) || {
            sales: 0,
            agreementsAmount: 0,
            incomeAmount: 0,
          };
          const activityStats = responsibleUserId
            ? activityByManager.get(responsibleUserId) || {
                followUpCount: 0,
                noteCount: 0,
                stageChangeCount: 0,
                overdueFollowUpCount: 0,
                todayFollowUpCount: 0,
              }
            : {
                followUpCount: 0,
                noteCount: 0,
                stageChangeCount: 0,
                overdueFollowUpCount: 0,
                todayFollowUpCount: 0,
              };
          const talkSeconds = talkSecondsByAgent.get(agent.id);
          const leadMetricsAvailable = leadsDataAvailable && Boolean(responsibleUserId);
          const conversionPercentByAgent = leadMetricsAvailable && (leadStats?.newLeads ?? 0) > 0
            ? Number(((salesStats.sales / (leadStats?.newLeads || 0)) * 100).toFixed(2))
            : (leadMetricsAvailable ? 0 : null);
          const talkedSecondsValue = talkSecondsByAgent.has(agent.id)
            ? (talkSeconds ?? 0)
            : null;

          return {
            userId: agent.id,
            name: agent.name || agent.username || agent.id,
            newLeads: leadMetricsAvailable ? (leadStats?.newLeads ?? 0) : null,
            qualifiedLeads: leadMetricsAvailable ? (leadStats?.qualifiedLeads ?? 0) : null,
            sales: salesStats.sales,
            conversionPercent: conversionPercentByAgent,
            agreementsAmount: tashkiliyOnly ? 0 : salesStats.agreementsAmount,
            incomeAmount: tashkiliyOnly ? 0 : salesStats.incomeAmount,
            talkedSeconds: talkedSecondsValue,
            callsCount: callCountByAgent.get(agent.id) ?? 0,
            followUpCount: activityStats.followUpCount,
            noteCount: activityStats.noteCount,
            stageChangeCount: activityStats.stageChangeCount,
            overdueFollowUpCount: activityStats.overdueFollowUpCount,
            todayFollowUpCount: activityStats.todayFollowUpCount,
          };
        })
        .sort((a, b) => {
          const aDuration = a.talkedSeconds ?? -1;
          const bDuration = b.talkedSeconds ?? -1;
          if (bDuration !== aDuration) {
            return bDuration - aDuration;
          }
          return a.name.localeCompare(b.name, 'uz');
        });

      log(LogLevel.INFO, 'Dashboard summary activity timings', {
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        activityFetchMs,
        activityManagerCount: activityManagerIds.length,
        activityTotals,
      });

      return {
        range: input.range,
        dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
        dateTo: input.range === 'custom' ? input.dateTo || null : null,
        selectedPipelineIds: selectedPipelineIds || [],
        sellerPerformance,
        summary: {
          totalLeads,
          qualifiedLeads,
          nonQualifiedLeads,
          totalCalls: scopedTotalCalls,
          pendingNotifications,
          activeIntegrations,
          totalIncomeAmount: tashkiliyOnly ? 0 : totalIncomeAmount,
          newSalesCount,
          newSalesAgreementAmount: tashkiliyOnly ? 0 : newSalesAgreementAmount,
          onlineSalesCount,
          onlineSalesAgreementAmount: tashkiliyOnly ? 0 : onlineSalesAgreementAmount,
          offlineSalesCount,
          offlineSalesAgreementAmount: tashkiliyOnly ? 0 : offlineSalesAgreementAmount,
          intensiveSalesCount,
          intensiveSalesAgreementAmount: tashkiliyOnly ? 0 : intensiveSalesAgreementAmount,
          qualifiedLeadSharePercent: Number(qualifiedLeadSharePercent.toFixed(2)),
          nonQualifiedLeadSharePercent: Number(nonQualifiedLeadSharePercent.toFixed(2)),
          conversionPercent: Number(conversionPercent.toFixed(2)),
          followUpCount: activityTotals.followUpCount,
          noteCount: activityTotals.noteCount,
          stageChangeCount: activityTotals.stageChangeCount,
          overdueFollowUpCount: activityTotals.overdueFollowUpCount,
          todayFollowUpCount: activityTotals.todayFollowUpCount,
        },
        pieCharts: {
          nonQualifiedByReason: {
            fieldKey: reasonFieldKey,
            fieldLabel: reasonFieldKey ? (fieldLabelMap.get(reasonFieldKey) || humanizeKey(reasonFieldKey)) : null,
            data: toPieData(reasonCounts),
          },
          newLeadsBySource: {
            fieldKey: sourceFieldKey,
            fieldLabel: sourceFieldKey ? (fieldLabelMap.get(sourceFieldKey) || humanizeKey(sourceFieldKey)) : null,
            data: toPieData(sourceCounts),
          },
        },
        updatedAt: now.toISOString(),
      };
    }),

  financeSummary: protectedProcedure
    .input(
      z.object({
        range: dashboardRangeSchema,
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        courseId: z.string().uuid().optional(),
        managerUserId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (isTashkiliyOnly(ctx.user.roles)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Tashkiliy role cannot access finance summary.' });
      }

      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);

      const effectiveManagerUserId = scope.isScoped
        ? ctx.user.userId
        : (input.managerUserId || undefined);

      const where = {
        tenantId: ctx.tenantId,
        entryDate: {
          gte: rangeStart,
          lte: rangeEnd,
        },
        ...(effectiveManagerUserId
          ? {
              managerUserId: effectiveManagerUserId,
            }
          : {}),
        ...(input.courseId
          ? {
              courseId: input.courseId,
            }
          : {}),
      };
      const analyticsBaseWhere = {
        tenantId: ctx.tenantId,
        ...(effectiveManagerUserId
          ? {
              managerUserId: effectiveManagerUserId,
            }
          : {}),
        ...(input.courseId
          ? {
              courseId: input.courseId,
            }
          : {}),
      };

      const nowLocal = shiftToReportTimezone(now);
      const currentYear = nowLocal.getUTCFullYear();
      const currentMonth = nowLocal.getUTCMonth();
      const currentDay = nowLocal.getUTCDate();
      const currentHour = nowLocal.getUTCHours();
      const currentMinute = nowLocal.getUTCMinutes();
      const currentSecond = nowLocal.getUTCSeconds();
      const currentMillisecond = nowLocal.getUTCMilliseconds();

      const previousMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
      const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const previousMonthSameDay = Math.min(currentDay, getDaysInReportLocalMonth(previousMonthYear, previousMonth));
      const lastYearSameMonthDay = Math.min(currentDay, getDaysInReportLocalMonth(currentYear - 1, currentMonth));
      const currentMonthTotalDays = getDaysInReportLocalMonth(currentYear, currentMonth);

      const currentMonthStart = fromReportLocalParts(currentYear, currentMonth, 1, 0, 0, 0, 0);
      const previousMonthStart = fromReportLocalParts(previousMonthYear, previousMonth, 1, 0, 0, 0, 0);
      const previousMonthSameMoment = fromReportLocalParts(
        previousMonthYear,
        previousMonth,
        previousMonthSameDay,
        currentHour,
        currentMinute,
        currentSecond,
        currentMillisecond,
      );
      const lastYearSameMonthStart = fromReportLocalParts(currentYear - 1, currentMonth, 1, 0, 0, 0, 0);
      const lastYearSameMonthMoment = fromReportLocalParts(
        currentYear - 1,
        currentMonth,
        lastYearSameMonthDay,
        currentHour,
        currentMinute,
        currentSecond,
        currentMillisecond,
      );
      const currentYearStart = fromReportLocalParts(currentYear, 0, 1, 0, 0, 0, 0);
      const previousYearStart = fromReportLocalParts(currentYear - 1, 0, 1, 0, 0, 0, 0);
      const previousYearYtdMoment = fromReportLocalParts(
        currentYear - 1,
        currentMonth,
        lastYearSameMonthDay,
        currentHour,
        currentMinute,
        currentSecond,
        currentMillisecond,
      );

      const sumActiveIncome = async (start: Date, end: Date): Promise<number> => {
        const aggregate = await prisma.income.aggregate({
          where: {
            ...analyticsBaseWhere,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: start,
              lte: end,
            },
          },
          _sum: {
            paymentAmount: true,
          },
        });
        return Number(aggregate._sum.paymentAmount || 0);
      };

      const [
        incomes,
        courses,
        managers,
        currentMonthToDateIncome,
        previousMonthToDateIncome,
        lastYearSameMonthToDateIncome,
        currentYearToDateIncome,
        previousYearToDateIncome,
        monthActiveIncomes,
        yearActiveIncomes,
      ] = await Promise.all([
        prisma.income.findMany({
          where,
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
          take: 300,
          select: {
            id: true,
            type: true,
            lifecycleStatus: true,
            paymentAmount: true,
            coursePriceAmount: true,
            remainingDebtAmount: true,
            entryDate: true,
            customerId: true,
            customer: {
              select: {
                customerNumber: true,
                name: true,
              },
            },
            manager: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
            course: {
              select: {
                id: true,
                name: true,
              },
            },
            tariff: {
              select: {
                name: true,
              },
            },
          },
        }),
        prisma.course.findMany({
          where: { tenantId: ctx.tenantId, isActive: true },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
          },
        }),
        prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            roles: {
              hasSome: ['Admin', 'Manager', 'Agent'],
            },
          },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            username: true,
            roles: true,
          },
        }),
        sumActiveIncome(currentMonthStart, now),
        sumActiveIncome(previousMonthStart, previousMonthSameMoment),
        sumActiveIncome(lastYearSameMonthStart, lastYearSameMonthMoment),
        sumActiveIncome(currentYearStart, now),
        sumActiveIncome(previousYearStart, previousYearYtdMoment),
        prisma.income.findMany({
          where: {
            ...analyticsBaseWhere,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: currentMonthStart,
              lte: now,
            },
          },
          select: {
            entryDate: true,
            paymentAmount: true,
          },
        }),
        prisma.income.findMany({
          where: {
            ...analyticsBaseWhere,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: currentYearStart,
              lte: now,
            },
          },
          select: {
            entryDate: true,
            paymentAmount: true,
          },
        }),
      ]);

      const totals = {
        totalIncomeAmount: 0,
        newSalesCount: 0,
        repaymentCount: 0,
        refundCount: 0,
        refundAmount: 0,
        debtorsCount: 0,
        totalDebtAmount: 0,
      };

      const debtorCustomers = new Set<string>();
      const incomeByCourse = new Map<string, { count: number; amount: number; agreementAmount: number }>();
      const incomeByAgent = new Map<string, { count: number; amount: number }>();

      for (const income of incomes as Array<{
        id: string;
        type: string;
        lifecycleStatus: string;
        paymentAmount: number;
        coursePriceAmount: number | null;
        remainingDebtAmount: number;
        entryDate: Date;
        customerId: string;
        customer: { customerNumber: string; name: string };
        manager: { id: string; name: string | null; username: string | null };
        course: { id: string; name: string } | null;
        tariff: { name: string } | null;
      }>) {
        if (income.lifecycleStatus === INCOME_LIFECYCLE_REFUNDED) {
          totals.refundCount += 1;
          totals.refundAmount += income.paymentAmount || 0;
        }

        if (income.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE) {
          continue;
        }

        const paymentAmount = income.paymentAmount || 0;
        totals.totalIncomeAmount += paymentAmount;

        const courseName = income.course?.name || 'No course';
        const byCourse = incomeByCourse.get(courseName) || {
          count: 0,
          amount: 0,
          agreementAmount: 0,
        };
        byCourse.count += 1;
        byCourse.amount += paymentAmount;
        if (income.type === 'new_sale') {
          byCourse.agreementAmount += income.coursePriceAmount || paymentAmount;
        }
        incomeByCourse.set(courseName, byCourse);

        const agentLabel = income.manager.name || income.manager.username || income.manager.id;
        const byAgent = incomeByAgent.get(agentLabel) || {
          count: 0,
          amount: 0,
        };
        byAgent.count += 1;
        byAgent.amount += paymentAmount;
        incomeByAgent.set(agentLabel, byAgent);

        if (income.type === 'new_sale') {
          totals.newSalesCount += 1;
          if (income.remainingDebtAmount > 0) {
            debtorCustomers.add(income.customerId);
            totals.totalDebtAmount += income.remainingDebtAmount;
          }
        } else if (income.type === 'repayment') {
          totals.repaymentCount += 1;
        }
      }

      totals.debtorsCount = debtorCustomers.size;
      const monthTrend = buildTrend(currentMonthToDateIncome, previousMonthToDateIncome);
      const monthVsLastYearTrend = buildTrend(currentMonthToDateIncome, lastYearSameMonthToDateIncome);
      const ytdTrend = buildTrend(currentYearToDateIncome, previousYearToDateIncome);

      const monthDailyMap = new Map<number, number>();
      for (const income of monthActiveIncomes as Array<{ entryDate: Date; paymentAmount: number }>) {
        const localDate = shiftToReportTimezone(income.entryDate);
        const day = localDate.getUTCDate();
        monthDailyMap.set(day, (monthDailyMap.get(day) || 0) + Number(income.paymentAmount || 0));
      }

      let monthCumulativeActual = 0;
      const monthElapsedDays = Math.max(1, currentDay);
      const monthRunRatePerDay = currentMonthToDateIncome > 0 ? currentMonthToDateIncome / monthElapsedDays : 0;
      const monthForecastSeries: Array<{ label: string; actual: number | null; forecast: number }> = [];
      for (let day = 1; day <= currentMonthTotalDays; day += 1) {
        monthCumulativeActual += monthDailyMap.get(day) || 0;
        monthForecastSeries.push({
          label: String(day),
          actual: day <= currentDay ? Math.round(monthCumulativeActual) : null,
          forecast: Math.round(monthRunRatePerDay * day),
        });
      }

      const monthProjectedTotal = Math.round(monthRunRatePerDay * currentMonthTotalDays);
      const monthRemainingAmount = Math.max(0, monthProjectedTotal - Math.round(currentMonthToDateIncome));
      const monthProgressPercent = monthProjectedTotal > 0
        ? Number(((currentMonthToDateIncome / monthProjectedTotal) * 100).toFixed(2))
        : 0;

      const yearMonthlyMap = new Map<number, number>();
      for (const income of yearActiveIncomes as Array<{ entryDate: Date; paymentAmount: number }>) {
        const localDate = shiftToReportTimezone(income.entryDate);
        const monthIndex = localDate.getUTCMonth();
        yearMonthlyMap.set(monthIndex, (yearMonthlyMap.get(monthIndex) || 0) + Number(income.paymentAmount || 0));
      }

      const yearElapsedDays = Math.max(1, getReportLocalDayOfYear(now));
      const yearTotalDays = getReportLocalDaysInYear(currentYear);
      const yearRunRatePerDay = currentYearToDateIncome > 0 ? currentYearToDateIncome / yearElapsedDays : 0;
      let yearCumulativeActual = 0;
      const yearForecastSeries: Array<{ label: string; actual: number | null; forecast: number }> = [];
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        yearCumulativeActual += yearMonthlyMap.get(monthIndex) || 0;
        yearForecastSeries.push({
          label: REPORT_MONTH_LABELS_UZ[monthIndex] || String(monthIndex + 1),
          actual: monthIndex <= currentMonth ? Math.round(yearCumulativeActual) : null,
          forecast: Math.round(yearRunRatePerDay * getReportLocalDayOfYearForMonthEnd(currentYear, monthIndex)),
        });
      }

      const yearProjectedTotal = Math.round(yearRunRatePerDay * yearTotalDays);
      const yearRemainingAmount = Math.max(0, yearProjectedTotal - Math.round(currentYearToDateIncome));
      const yearProgressPercent = yearProjectedTotal > 0
        ? Number(((currentYearToDateIncome / yearProjectedTotal) * 100).toFixed(2))
        : 0;

      const managerOptions = (managers as Array<{ id: string; name: string | null; username: string | null; roles: string[] }>)
        .map((manager) => ({
          id: manager.id,
          label: manager.name || manager.username || manager.id,
          roles: manager.roles,
        }));
      const visibleManagerOptions = scope.isScoped
        ? managerOptions.filter((manager) => manager.id === ctx.user.userId)
        : managerOptions;

      return {
        range: input.range,
        dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
        dateTo: input.range === 'custom' ? input.dateTo || null : null,
        filters: {
          courseId: input.courseId || null,
          managerUserId: effectiveManagerUserId || null,
          agentScoped: scope.isScoped,
        },
        comparisons: {
          monthToDateVsLastMonthToDate: {
            ...monthTrend,
            currentStart: currentMonthStart.toISOString(),
            currentEnd: now.toISOString(),
            previousStart: previousMonthStart.toISOString(),
            previousEnd: previousMonthSameMoment.toISOString(),
          },
          monthToDateVsLastYearSameMonth: {
            ...monthVsLastYearTrend,
            currentStart: currentMonthStart.toISOString(),
            currentEnd: now.toISOString(),
            previousStart: lastYearSameMonthStart.toISOString(),
            previousEnd: lastYearSameMonthMoment.toISOString(),
          },
          ytdVsLastYearYtd: {
            ...ytdTrend,
            currentStart: currentYearStart.toISOString(),
            currentEnd: now.toISOString(),
            previousStart: previousYearStart.toISOString(),
            previousEnd: previousYearYtdMoment.toISOString(),
          },
        },
        forecast: {
          monthEnd: {
            currentToDate: Math.round(currentMonthToDateIncome),
            projectedTotal: monthProjectedTotal,
            remainingAmount: monthRemainingAmount,
            progressPercent: monthProgressPercent,
            runRatePerDay: Number(monthRunRatePerDay.toFixed(2)),
            periodStart: currentMonthStart.toISOString(),
            periodEnd: fromReportLocalParts(currentYear, currentMonth, currentMonthTotalDays, 23, 59, 59, 999).toISOString(),
          },
          yearEnd: {
            currentToDate: Math.round(currentYearToDateIncome),
            projectedTotal: yearProjectedTotal,
            remainingAmount: yearRemainingAmount,
            progressPercent: yearProgressPercent,
            runRatePerDay: Number(yearRunRatePerDay.toFixed(2)),
            periodStart: currentYearStart.toISOString(),
            periodEnd: fromReportLocalParts(currentYear, 11, 31, 23, 59, 59, 999).toISOString(),
          },
          monthSeries: monthForecastSeries,
          yearSeries: yearForecastSeries,
        },
        totals,
        incomeByCourse: Array.from(incomeByCourse.entries())
          .map(([courseName, value]) => ({
            courseName,
            count: value.count,
            amount: value.amount,
            agreementAmount: value.agreementAmount,
          }))
          .sort((a, b) => b.amount - a.amount),
        incomeByAgent: Array.from(incomeByAgent.entries())
          .map(([agent, value]) => ({
            agent,
            count: value.count,
            amount: value.amount,
          }))
          .sort((a, b) => b.amount - a.amount),
        courseOptions: (courses as Array<{ id: string; name: string }>).map((course) => ({
          ...course,
          category: classifyCourseCategoryFromField(course.name),
        })),
        managerOptions: visibleManagerOptions,
        recentIncomes: (incomes as Array<{
          id: string;
          type: string;
          lifecycleStatus: string;
          paymentAmount: number;
          coursePriceAmount: number | null;
          remainingDebtAmount: number;
          entryDate: Date;
          customer: { customerNumber: string; name: string };
          manager: { id: string; name: string | null; username: string | null };
          course: { id: string; name: string } | null;
          tariff: { name: string } | null;
        }>).map((income) => ({
          id: income.id,
          type: income.type,
          lifecycleStatus: income.lifecycleStatus,
          paymentAmount: income.paymentAmount,
          coursePriceAmount: income.coursePriceAmount,
          remainingDebtAmount: income.remainingDebtAmount,
          entryDate: income.entryDate,
          customerNumber: income.customer.customerNumber,
          customerName: income.customer.name,
          managerLabel: income.manager.name || income.manager.username || income.manager.id,
          courseName: income.course?.name || null,
          tariffName: income.tariff?.name || null,
        })),
        updatedAt: now.toISOString(),
      };
    }),

  salarySummary: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const { monthStart, monthEnd } = getCurrentMonthRange(now);
    const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;

    const [tenant, allAgents] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      }),
      prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          roles: {
            has: 'Agent',
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

    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const salarySettings = extractSalarySettings(tenant.settings);
    const agents = scopedManagerUserId
      ? allAgents.filter((agent) => agent.id === scopedManagerUserId)
      : allAgents;
    const agentIds = agents.map((agent) => agent.id);

    if (!agentIds.length) {
      return {
        monthStart: monthStart.toISOString(),
        monthEnd: monthEnd.toISOString(),
        scopedToCurrentAgent: Boolean(scopedManagerUserId),
        bonusMode: salarySettings.bonusMode,
        bonusPercentages: salarySettings.bonusPercentages,
        totals: {
          fixedSalary: 0,
          bonus: 0,
          planBonus: 0,
          kpi: 0,
          salary: 0,
        },
        byAgent: [] as Array<{
          userId: string;
          name: string;
          fixedSalary: number;
          kpiAmount: number;
          bonusAmount: number;
          planBonusAmount: number;
          totalSalary: number;
          bonusBreakdown: SalaryBreakdown;
          planProgress: Array<{
            planId: string;
            name: string;
            periodMode: PlanBonusPeriodMode;
            target: number;
            fact: number;
            completionPercent: number;
            completedUnits: number;
            earnedAmount: number;
          }>;
        }>,
        currentUser: null,
      };
    }

    const salaryByAgent = new Map<
      string,
      {
        userId: string;
        name: string;
        fixedSalary: number;
        kpiAmount: number;
        bonusAmount: number;
        planBonusAmount: number;
        bonusBreakdown: SalaryBreakdown;
        planProgress: Array<{
          planId: string;
          name: string;
          periodMode: PlanBonusPeriodMode;
          target: number;
          fact: number;
          completionPercent: number;
          completedUnits: number;
          earnedAmount: number;
        }>;
      }
    >();

    for (const agent of agents) {
      salaryByAgent.set(agent.id, {
        userId: agent.id,
        name: agent.name || agent.username || agent.id,
        fixedSalary: salarySettings.fixedSalaries.get(agent.id) ?? 0,
        kpiAmount: 0,
        bonusAmount: 0,
        planBonusAmount: 0,
        bonusBreakdown: createZeroBreakdown(),
        planProgress: [],
      });
    }

    if (salarySettings.bonusMode === 'on_income') {
      const incomes = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        select: {
          managerUserId: true,
          paymentAmount: true,
          course: {
            select: {
              name: true,
            },
          },
          relatedDebtIncome: {
            select: {
              course: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      for (const income of incomes) {
        const category = classifyCourseCategoryFromField(
          income.course?.name ?? income.relatedDebtIncome?.course?.name,
        );
        if (category === 'other') {
          continue;
        }
        const salaryRow = salaryByAgent.get(income.managerUserId);
        if (!salaryRow) {
          continue;
        }

        const bonusAmount = getBonusAmount(income.paymentAmount ?? 0, salarySettings.bonusPercentages[category]);
        salaryRow.bonusAmount += bonusAmount;
        salaryRow.bonusBreakdown[category] += bonusAmount;
      }
    } else {
      const [fullyPaidNewSales, closingRepayments] = await Promise.all([
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'new_sale',
            managerUserId: { in: agentIds },
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            remainingDebtAmount: 0,
            entryDate: {
              gte: monthStart,
              lte: monthEnd,
            },
          },
          select: {
            id: true,
            managerUserId: true,
            coursePriceAmount: true,
            paymentAmount: true,
            course: {
              select: {
                name: true,
              },
            },
          },
        }),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'repayment',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            remainingDebtAmount: 0,
            relatedDebtIncomeId: { not: null },
            entryDate: {
              gte: monthStart,
              lte: monthEnd,
            },
            relatedDebtIncome: {
              managerUserId: { in: agentIds },
            },
          },
          select: {
            relatedDebtIncome: {
              select: {
                id: true,
                managerUserId: true,
                coursePriceAmount: true,
                paymentAmount: true,
                course: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        }),
      ]);

      const processedSaleIds = new Set<string>();
      const applyClosedSaleBonus = (sale: {
        id: string;
        managerUserId: string;
        coursePriceAmount: number | null;
        paymentAmount: number;
        course: { name: string } | null;
      }) => {
        if (processedSaleIds.has(sale.id)) {
          return;
        }
        processedSaleIds.add(sale.id);

        const category = classifyCourseCategoryFromField(sale.course?.name);
        if (category === 'other') {
          return;
        }

        const salaryRow = salaryByAgent.get(sale.managerUserId);
        if (!salaryRow) {
          return;
        }

        const agreementAmount = sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
        const bonusAmount = getBonusAmount(agreementAmount, salarySettings.bonusPercentages[category]);
        salaryRow.bonusAmount += bonusAmount;
        salaryRow.bonusBreakdown[category] += bonusAmount;
      };

      for (const sale of fullyPaidNewSales) {
        applyClosedSaleBonus({
          id: sale.id,
          managerUserId: sale.managerUserId,
          coursePriceAmount: sale.coursePriceAmount,
          paymentAmount: sale.paymentAmount,
          course: sale.course,
        });
      }

      for (const repayment of closingRepayments) {
        if (!repayment.relatedDebtIncome) {
          continue;
        }
        applyClosedSaleBonus(repayment.relatedDebtIncome);
      }
    }

    const activePlanBonuses = salarySettings.planBonuses.filter((plan) => plan.isActive);
    if (activePlanBonuses.length > 0) {
      const [closedSales, closingRepayments] = await Promise.all([
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'new_sale',
            managerUserId: { in: agentIds },
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            remainingDebtAmount: 0,
          },
          select: {
            id: true,
            managerUserId: true,
            entryDate: true,
            courseId: true,
            tariffId: true,
            customer: {
              select: {
                profileSubTariffId: true,
              },
            },
            course: {
              select: {
                category: true,
              },
            },
          },
        }),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'repayment',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            remainingDebtAmount: 0,
            relatedDebtIncomeId: { not: null },
            relatedDebtIncome: {
              managerUserId: { in: agentIds },
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            },
          },
          orderBy: {
            entryDate: 'asc',
          },
          select: {
            entryDate: true,
            relatedDebtIncomeId: true,
          },
        }),
      ]);

      const closeDateBySaleId = new Map<string, Date>();
      for (const repayment of closingRepayments) {
        if (!repayment.relatedDebtIncomeId) {
          continue;
        }
        if (!closeDateBySaleId.has(repayment.relatedDebtIncomeId)) {
          closeDateBySaleId.set(repayment.relatedDebtIncomeId, repayment.entryDate);
        }
      }

      const monthStartMs = monthStart.getTime();
      const monthEndMs = monthEnd.getTime();
      const closedSalesFactsByAgentAndPlan = new Map<string, number>();

      const incrementPlanFact = (agentId: string, planId: string) => {
        const key = `${agentId}:${planId}`;
        closedSalesFactsByAgentAndPlan.set(key, (closedSalesFactsByAgentAndPlan.get(key) ?? 0) + 1);
      };

      for (const sale of closedSales) {
        const closeDate = closeDateBySaleId.get(sale.id) ?? sale.entryDate;
        const closeTimestamp = closeDate.getTime();
        const saleCourseCategory = String(sale.course?.category || '').trim().toLowerCase();

        for (const plan of activePlanBonuses) {
          if (plan.courseCategory !== saleCourseCategory) {
            continue;
          }
          if (plan.courseId && plan.courseId !== sale.courseId) {
            continue;
          }
          if (plan.tariffId && plan.tariffId !== sale.tariffId) {
            continue;
          }
          if (plan.subTariffId && plan.subTariffId !== sale.customer?.profileSubTariffId) {
            continue;
          }
          if (plan.periodMode === 'monthly' && (closeTimestamp < monthStartMs || closeTimestamp > monthEndMs)) {
            continue;
          }

          incrementPlanFact(sale.managerUserId, plan.id);
        }
      }

      for (const salaryRow of salaryByAgent.values()) {
        const planProgress = activePlanBonuses.map((plan) => {
          const fact = closedSalesFactsByAgentAndPlan.get(`${salaryRow.userId}:${plan.id}`) ?? 0;
          const completionPercent = plan.targetClosedSales > 0
            ? Number(((fact / plan.targetClosedSales) * 100).toFixed(1))
            : 0;
          const completedUnits = Math.floor(fact / plan.targetClosedSales);
          const earnedAmount = completedUnits * plan.bonusAmount;

          return {
            planId: plan.id,
            name: plan.name,
            periodMode: plan.periodMode,
            target: plan.targetClosedSales,
            fact,
            completionPercent,
            completedUnits,
            earnedAmount,
          };
        });

        salaryRow.planProgress = planProgress;
        salaryRow.planBonusAmount = planProgress.reduce((sum, item) => sum + item.earnedAmount, 0);
      }
    }

    const byAgent = Array.from(salaryByAgent.values())
      .map((row) => ({
        ...row,
        totalSalary: row.fixedSalary + row.kpiAmount + row.bonusAmount + row.planBonusAmount,
      }))
      .sort((a, b) => b.totalSalary - a.totalSalary);

    const totals = byAgent.reduce(
      (acc, row) => ({
        fixedSalary: acc.fixedSalary + row.fixedSalary,
        bonus: acc.bonus + row.bonusAmount,
        planBonus: acc.planBonus + row.planBonusAmount,
        kpi: acc.kpi + row.kpiAmount,
        salary: acc.salary + row.totalSalary,
      }),
      {
        fixedSalary: 0,
        bonus: 0,
        planBonus: 0,
        kpi: 0,
        salary: 0,
      },
    );

    return {
      monthStart: monthStart.toISOString(),
      monthEnd: monthEnd.toISOString(),
      scopedToCurrentAgent: Boolean(scopedManagerUserId),
      bonusMode: salarySettings.bonusMode,
      bonusPercentages: salarySettings.bonusPercentages,
      totals,
      byAgent,
      currentUser: byAgent.find((row) => row.userId === ctx.user.userId) || null,
    };
  }),

  fieldOptions: adminProcedure.query(async ({ ctx }) => {
    const catalogOptions = await collectCatalogFieldOptions(ctx.tenantId);
    const merged = new Map<string, LeadFieldOption>();

    for (const option of getSystemLeadFieldOptions()) {
      merged.set(option.key, option);
    }

    for (const option of catalogOptions) {
      merged.set(option.key, option);
    }

    return {
      options: Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }),

  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });

    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const settings = asObject(tenant.settings);
    const dashboardSettings = asObject(settings?.dashboard);

    return {
      reasonFieldKey: typeof dashboardSettings?.reasonFieldKey === 'string' ? dashboardSettings.reasonFieldKey : null,
      sourceFieldKey: typeof dashboardSettings?.sourceFieldKey === 'string' ? dashboardSettings.sourceFieldKey : null,
      qualifiedStageIds: asStringArray(dashboardSettings?.qualifiedStageIds),
      qualifiedValues: asStringArray(dashboardSettings?.qualifiedValues),
      nonQualifiedValues: asStringArray(dashboardSettings?.nonQualifiedValues),
    };
  }),

  reasonValueOptions: adminProcedure
    .input(z.object({ fieldKey: z.string().optional(), pipelineIds: z.array(z.string()).optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!input?.fieldKey) {
        return { values: [] as string[] };
      }

      const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
      if (!amoContext) {
        return { values: [] as string[] };
      }

      const selectedPipelineIds = input.pipelineIds && input.pipelineIds.length > 0
        ? input.pipelineIds
        : (amoContext.selectedPipelineIds || null);

      const values = new Set<string>();
      let page = 1;
      let stagnantPages = 0;
      const maxPages = 40;

      while (page <= maxPages) {
        const response = await amocrmService.fetchLeads(
          amoContext.accessToken,
          '',
          {
            page,
            limit: 250,
            pipelineIds: selectedPipelineIds || undefined,
          },
          amoContext.baseUrl,
        );

        const leads = Array.isArray(response._embedded?.leads) ? response._embedded.leads : [];
        const sizeBefore = values.size;

        for (const lead of leads) {
          const value = extractLeadValue(lead, input.fieldKey);
          if (value) {
            values.add(value);
          }
        }

        if (values.size === sizeBefore) {
          stagnantPages += 1;
        } else {
          stagnantPages = 0;
        }

        const hasNext = Boolean(response._links?.next?.href);
        if (!hasNext || stagnantPages >= 5) {
          break;
        }

        page += 1;
      }

      return {
        values: Array.from(values).sort((a, b) => a.localeCompare(b)),
      };
    }),
});
