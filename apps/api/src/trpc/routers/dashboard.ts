import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { amocrmService } from '../../services/integrations/amocrm';
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
const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'Finance']);
const SALARY_CATEGORIES = ['online', 'offline', 'intensive'] as const;
const INCOME_LIFECYCLE_ACTIVE = 'active';
const INCOME_LIFECYCLE_PENDING_REFUND = 'pending_refund';
const INCOME_LIFECYCLE_REFUNDED = 'refunded';

type SalaryCategory = (typeof SALARY_CATEGORIES)[number];
type SalaryBonusMode = 'on_income' | 'on_debt_closed';
type SalaryBreakdown = Record<SalaryCategory, number>;

type SalarySettingsSnapshot = {
  bonusMode: SalaryBonusMode;
  bonusPercentages: SalaryBreakdown;
  fixedSalaries: Map<string, number>;
};

function isMissingUserMappingColumnError(error: unknown) {
  const message = String((error as any)?.message || '');
  return message.includes('amocrmResponsibleUserId') || message.includes('utelManagerExternalId');
}

function normalizeTextToken(value: unknown): string {
  return String(value || '').trim().toLowerCase();
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
  const offsetMs = REPORT_TZ_OFFSET_MINUTES * 60 * 1000;
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

function extractSalarySettings(settings: unknown): SalarySettingsSnapshot {
  const settingsObject = asObject(settings);
  const salarySettings = asObject(settingsObject?.salary);
  const rawPercentages = asObject(salarySettings?.bonusPercentages);
  const rawFixedSalaries = Array.isArray(salarySettings?.fixedSalaries) ? salarySettings.fixedSalaries : [];
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
    const userId = typeof row?.userId === 'string' ? row.userId : '';
    if (!userId) {
      continue;
    }
    fixedSalaries.set(userId, Math.max(0, Math.round(toFiniteNumber(row?.amount, 0))));
  }

  return {
    bonusMode,
    bonusPercentages,
    fixedSalaries,
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

      const [totalCalls, pendingNotifications, activeIntegrations, totalIncomeAggregate, newSalesIncomes, incomesForSellers, callsForSellers] = await Promise.all([
        prisma.call.count({
          where: {
            tenantId: ctx.tenantId,
            startedAt: {
              gte: rangeStart,
              lte: rangeEnd,
            },
            ...(scope.isScoped
              ? {
                  lead: {
                    responsibleUserId: scope.responsibleUserId || '__unmapped__',
                  },
                }
              : {}),
          },
        }),
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
            startedAt: {
              gte: rangeStart,
              lte: rangeEnd,
            },
          },
          select: {
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
      for (const agent of agentUsers) {
        const keyByUtel = normalizeTextToken(agent.utelManagerExternalId);
        const keyByAmo = normalizeTextToken(agent.amocrmResponsibleUserId);
        const hasCallMapping = Boolean(keyByUtel || keyByAmo);

        if (!hasCallMapping) {
          continue;
        }

        let talkSeconds = 0;
        for (const call of callsForSellers) {
          const callDuration = call.duration ?? 0;
          if (!callDuration) {
            continue;
          }

          const callLeadResponsibleId = normalizeTextToken(call.lead?.responsibleUserId);
          const metadataKey = extractUtelManagerKey(call.metadata);
          const normalizedMetadataKey = normalizeTextToken(metadataKey);
          const matched = (keyByAmo && callLeadResponsibleId && keyByAmo === callLeadResponsibleId)
            || (keyByUtel && normalizedMetadataKey && keyByUtel === normalizedMetadataKey);

          if (matched) {
            talkSeconds += callDuration;
          }
        }

        talkSecondsByAgent.set(agent.id, talkSeconds);
      }

      const sellerPerformance = agentUsers.map((agent) => {
        const responsibleUserId = agent.amocrmResponsibleUserId ? String(agent.amocrmResponsibleUserId) : '';
        const leadStats = responsibleUserId ? leadsByResponsibleUser.get(responsibleUserId) : undefined;
        const salesStats = salesByManager.get(agent.id) || {
          sales: 0,
          agreementsAmount: 0,
          incomeAmount: 0,
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
          agreementsAmount: salesStats.agreementsAmount,
          incomeAmount: salesStats.incomeAmount,
          talkedSeconds: talkedSecondsValue,
        };
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
          totalCalls,
          pendingNotifications,
          activeIntegrations,
          totalIncomeAmount,
          newSalesCount,
          newSalesAgreementAmount,
          onlineSalesCount,
          onlineSalesAgreementAmount,
          offlineSalesCount,
          offlineSalesAgreementAmount,
          intensiveSalesCount,
          intensiveSalesAgreementAmount,
          qualifiedLeadSharePercent: Number(qualifiedLeadSharePercent.toFixed(2)),
          nonQualifiedLeadSharePercent: Number(nonQualifiedLeadSharePercent.toFixed(2)),
          conversionPercent: Number(conversionPercent.toFixed(2)),
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

      const [incomes, courses, managers] = await Promise.all([
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
          kpi: 0,
          salary: 0,
        },
        byAgent: [] as Array<{
          userId: string;
          name: string;
          fixedSalary: number;
          kpiAmount: number;
          bonusAmount: number;
          totalSalary: number;
          bonusBreakdown: SalaryBreakdown;
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
        bonusBreakdown: SalaryBreakdown;
      }
    >();

    for (const agent of agents) {
      salaryByAgent.set(agent.id, {
        userId: agent.id,
        name: agent.name || agent.username || agent.id,
        fixedSalary: salarySettings.fixedSalaries.get(agent.id) ?? 0,
        kpiAmount: 0,
        bonusAmount: 0,
        bonusBreakdown: createZeroBreakdown(),
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

    const byAgent = Array.from(salaryByAgent.values())
      .map((row) => ({
        ...row,
        totalSalary: row.fixedSalary + row.kpiAmount + row.bonusAmount,
      }))
      .sort((a, b) => b.totalSalary - a.totalSalary);

    const totals = byAgent.reduce(
      (acc, row) => ({
        fixedSalary: acc.fixedSalary + row.fixedSalary,
        bonus: acc.bonus + row.bonusAmount,
        kpi: acc.kpi + row.kpiAmount,
        salary: acc.salary + row.totalSalary,
      }),
      {
        fixedSalary: 0,
        bonus: 0,
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
