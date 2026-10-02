import { z } from 'zod';
import {
  prisma,
  TRPCError,
  protectedProcedure,
  INCOME_LIFECYCLE_ACTIVE,
  isAgentOnly,
  isTashkiliyOnly,
  getCurrentMonthRange,
  dashboardRangeSchema,
  resolveDateRange,
  shiftToReportTimezone,
  getDaysInReportLocalMonth,
  classifyCourseCategoryFromField,
  extractSalarySettings,
  createZeroBreakdown,
  resolveBonusPercent,
  getBonusAmount,
  normalizeSubTariffName,
  type SalaryBreakdown,
  type SalaryCategory,
  type PlanBonusPeriodMode,
  type KpiThreshold,
  type KpiMetricKey,
  type KpiSettings,
  KPI_METRIC_KEYS,
  isMissingUserMappingColumnError,
} from './helpers';
import { amocrmService, type AmoCRMLead } from '../../../services/integrations/amocrm';
import { getTenantAmoCRMContext } from '../../../services/integrations/amocrm-live';
import { AGENT_ROLES, type UserRole } from '@dashboarduz/shared';
import { getAmoCRMActivityMetrics } from '../../../services/integrations/amocrm-activity';
import { buildSaleChainMetricsBySaleId } from '../../../services/income-chain';
import { buildTechnicalSaleIdSet, isRowLinkedToTechnicalSale } from '../../../services/technical-income';
import { buildCacheKey, getOrSet } from '../../../services/cache';
import { calculateBonusRange, getApprovedAdjustmentsForMonth, getTashkentMonthStart, loadSaleClosures, resolveEffectiveBonusPolicy } from '../../../services/bonus-engine';
import { computePlanProgressByAgent } from '../../../services/plan-bonus';
import { excludeTechnicalRows, loadTechnicalSaleIdsForRows, resolveSaleAgreementAmount } from '../../../services/income-facts';
import {
  BONUS_DETAIL_EXPORT_LIMIT,
  buildBonusDetailIncomeWhere,
  isBonusDetailExportOverLimit,
} from '../../../services/bonus-detail-export';

function calculateProratedFixedSalary(
  monthlyFixedSalary: number,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  if (!monthlyFixedSalary || rangeEnd < rangeStart) {
    return 0;
  }

  const localStart = shiftToReportTimezone(rangeStart);
  const localEnd = shiftToReportTimezone(rangeEnd);

  let year = localStart.getUTCFullYear();
  let month = localStart.getUTCMonth();
  const endYear = localEnd.getUTCFullYear();
  const endMonth = localEnd.getUTCMonth();
  let total = 0;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const daysInMonth = getDaysInReportLocalMonth(year, month);
    const startDay = year === localStart.getUTCFullYear() && month === localStart.getUTCMonth()
      ? localStart.getUTCDate()
      : 1;
    const endDay = year === localEnd.getUTCFullYear() && month === localEnd.getUTCMonth()
      ? localEnd.getUTCDate()
      : daysInMonth;

    total += (monthlyFixedSalary * Math.max(0, endDay - startDay + 1)) / daysInMonth;

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return Math.round(total);
}

function extractBonusDetailSubTariffId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }
  const candidate = (meta as Record<string, unknown>).saleSubTariffId;
  if (typeof candidate !== 'string') {
    return null;
  }
  const normalized = candidate.trim();
  return normalized || null;
}

function scoreKpi(value: number, threshold: KpiThreshold, higherIsBetter: boolean): number {
  if (threshold.full <= 0 && threshold.half <= 0) return 0;
  if (higherIsBetter) {
    if (value >= threshold.full) return 1;
    if (value >= threshold.half) return 0.5;
    return 0;
  }
  // lower is better (not used currently, but safe)
  if (value <= threshold.full) return 1;
  if (value <= threshold.half) return 0.5;
  return 0;
}

type KpiBreakdownEntry = {
  value: number;
  score: number;
  amount: number;
};

function toLocalDateKey(date: Date): string {
  const shifted = shiftToReportTimezone(date);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDateKey(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return {
    year: Number.parseInt(match[1] || '0', 10),
    month: Number.parseInt(match[2] || '0', 10),
    day: Number.parseInt(match[3] || '0', 10),
  };
}

function formatLocalDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDayOfWeekFromLocalDateKey(value: string): number {
  const parsed = parseLocalDateKey(value);
  if (!parsed) {
    return 0;
  }
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

function addOneDayToLocalDateKey(value: string): string {
  const parsed = parseLocalDateKey(value);
  if (!parsed) {
    return value;
  }
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1));
  return formatLocalDateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function buildRequiredWorkdaysByMonth(rangeStart: Date, rangeEnd: Date): Map<string, number> {
  const result = new Map<string, number>();
  let cursor = toLocalDateKey(rangeStart);
  const end = toLocalDateKey(rangeEnd);

  while (cursor <= end) {
    const dayOfWeek = getDayOfWeekFromLocalDateKey(cursor);
    if (dayOfWeek !== 0) {
      const monthKey = cursor.slice(0, 7);
      result.set(monthKey, (result.get(monthKey) || 0) + 1);
    }
    cursor = addOneDayToLocalDateKey(cursor);
  }

  return result;
}

const salarySummary = protectedProcedure
    .input(
      z.object({
        range: dashboardRangeSchema.default('month').optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        managerUserId: z.string().uuid().optional(),
        prorateFixedSalary: z.boolean().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
    const cacheKey = buildCacheKey('salarySummary', {
      t: ctx.tenantId,
      u: ctx.user.userId,
      r: input?.range || 'month',
      df: input?.dateFrom,
      dt: input?.dateTo,
      m: input?.managerUserId,
      p: input?.prorateFixedSalary ? '1' : '0',
    });
    return getOrSet(cacheKey, 120, async () => {
    const now = new Date();
    const hasExplicitRange = Boolean(input);
    const resolvedRange = hasExplicitRange
      ? resolveDateRange(input?.range || 'month', now, input?.dateFrom, input?.dateTo)
      : getCurrentMonthRange(now);
    const rangeStart = 'rangeStart' in resolvedRange ? resolvedRange.rangeStart : resolvedRange.monthStart;
    const rangeEnd = 'rangeEnd' in resolvedRange ? resolvedRange.rangeEnd : resolvedRange.monthEnd;
    const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
    const selectedManagerUserId = scopedManagerUserId || input?.managerUserId;

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
            hasSome: [...AGENT_ROLES, 'TeamLeader'],
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
    // Label with the bonus policy that applies to the viewed period, not whatever was saved last.
    const viewedBonusMode = (await resolveEffectiveBonusPolicy(ctx.tenantId, rangeEnd)).policy.bonusMode;
    const agents = selectedManagerUserId
      ? allAgents.filter((agent) => agent.id === selectedManagerUserId)
      : allAgents;
    const agentIds = agents.map((agent) => agent.id);

    if (!agentIds.length) {
      return {
        monthStart: rangeStart.toISOString(),
        monthEnd: rangeEnd.toISOString(),
        scopedToCurrentAgent: Boolean(scopedManagerUserId),
        bonusMode: viewedBonusMode,
        bonusPercentages: salarySettings.bonusPercentages,
        kpiSettings: salarySettings.kpiSettings.enabled ? {
          monthlyBudget: salarySettings.kpiSettings.monthlyBudget,
          selectedMetrics: salarySettings.kpiSettings.selectedMetrics,
          thresholds: salarySettings.kpiSettings.thresholds,
        } : null,
        attendancePenaltySettings: salarySettings.attendancePenaltySettings,
        totals: {
          fixedSalary: 0,
          bonus: 0,
          approvedAdjustments: 0,
          planBonus: 0,
          kpi: 0,
          attendancePenaltyFixed: 0,
          attendancePenaltyKpi: 0,
          attendancePenalty: 0,
          salaryAfterAttendance: 0,
          salary: 0,
        },
        byAgent: [] as Array<{
          userId: string;
          name: string;
          fixedSalary: number;
          kpiAmount: number;
          bonusAmount: number;
          approvedAdjustmentAmount: number;
          outstandingAdjustmentBalance: number;
          planBonusAmount: number;
          attendancePenaltyFixed: number;
          attendancePenaltyKpi: number;
          attendancePenaltyTotal: number;
          salaryAfterAttendance: number;
          totalSalary: number;
          bonusBreakdown: SalaryBreakdown;
          kpiBreakdown: Record<KpiMetricKey, KpiBreakdownEntry> | null;
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
        approvedAdjustmentAmount: number;
        outstandingAdjustmentBalance: number;
        planBonusAmount: number;
        attendancePenaltyFixed: number;
        attendancePenaltyKpi: number;
        attendancePenaltyTotal: number;
        salaryAfterAttendance: number;
        bonusBreakdown: SalaryBreakdown;
        kpiBreakdown: Record<KpiMetricKey, KpiBreakdownEntry> | null;
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
        fixedSalary: input?.prorateFixedSalary
          ? calculateProratedFixedSalary(salarySettings.fixedSalaries.get(agent.id) ?? 0, rangeStart, rangeEnd)
          : (salarySettings.fixedSalaries.get(agent.id) ?? 0),
        kpiAmount: 0,
        bonusAmount: 0,
        approvedAdjustmentAmount: 0,
        outstandingAdjustmentBalance: 0,
        planBonusAmount: 0,
        attendancePenaltyFixed: 0,
        attendancePenaltyKpi: 0,
        attendancePenaltyTotal: 0,
        salaryAfterAttendance: 0,
        bonusBreakdown: createZeroBreakdown(),
        kpiBreakdown: null,
        planProgress: [],
      });
    }

    const bonusRange = await calculateBonusRange({ tenantId: ctx.tenantId, rangeStart, rangeEnd });
    for (const item of bonusRange.items) {
      const salaryRow = salaryByAgent.get(item.agentUserId);
      if (!salaryRow) continue;
      salaryRow.bonusAmount += item.bonusAmount;
      salaryRow.bonusBreakdown[item.category] += item.bonusAmount;
    }
    const approvedAdjustments = await getApprovedAdjustmentsForMonth(ctx.tenantId, rangeEnd);
    const adjustmentRangeMonthStart = getTashkentMonthStart(rangeStart);
    for (const adjustment of approvedAdjustments) {
      const salaryRow = salaryByAgent.get(adjustment.agentUserId);
      if (!salaryRow || !adjustment.payoutMonth || adjustment.payoutMonth < adjustmentRangeMonthStart) continue;
      salaryRow.approvedAdjustmentAmount += adjustment.outstandingAmount;
      salaryRow.outstandingAdjustmentBalance += adjustment.outstandingAmount;
    }

    const activePlanBonuses = salarySettings.planBonuses.filter((plan) => plan.isActive);
    if (activePlanBonuses.length > 0) {
      const closures = await loadSaleClosures({ tenantId: ctx.tenantId, rangeEnd });
      const profileSubTariffIds = Array.from(new Set(
        closures.map((closure) => closure.profileSubTariffId).filter((value): value is string => Boolean(value)),
      ));
      const subTariffNameById = new Map<string, string>();
      if (profileSubTariffIds.length > 0) {
        const subTariffs = await prisma.subTariff.findMany({
          where: { tenantId: ctx.tenantId, id: { in: profileSubTariffIds } },
          select: { id: true, name: true },
        });
        for (const subTariff of subTariffs) {
          subTariffNameById.set(subTariff.id, normalizeSubTariffName(subTariff.name));
        }
      }

      const progressByAgent = computePlanProgressByAgent({
        plans: activePlanBonuses,
        closures,
        agentIds,
        rangeStart,
        rangeEnd,
        subTariffNameById,
      });
      for (const salaryRow of salaryByAgent.values()) {
        const planProgress = progressByAgent.get(salaryRow.userId) ?? [];
        salaryRow.planProgress = planProgress;
        salaryRow.planBonusAmount = planProgress.reduce((sum, item) => sum + item.earnedAmount, 0);
      }
    }

    // ── KPI Scoring ──
    const kpi = salarySettings.kpiSettings;
    if (kpi.enabled && kpi.monthlyBudget > 0) {
      // Fetch agent -> AmoCRM mapping + extensions
      let agentAmoMappings: Array<{ id: string; amocrmResponsibleUserId: string | null; utelManagerExternalId: string | null }> = [];
      try {
        agentAmoMappings = await prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: agentIds },
            isActive: true,
          },
          select: {
            id: true,
            amocrmResponsibleUserId: true,
            utelManagerExternalId: true,
          },
        }) as Array<{ id: string; amocrmResponsibleUserId: string | null; utelManagerExternalId: string | null }>;
      } catch (error) {
        if (!isMissingUserMappingColumnError(error)) throw error;
      }

      const agentAmoIdMap = new Map<string, string>(); // agentId -> amoId
      const amoIdToAgentId = new Map<string, string>(); // amoId -> agentId
      const agentExtensions = new Map<string, string[]>(); // agentId -> extensions
      for (const mapping of agentAmoMappings) {
        if (mapping.amocrmResponsibleUserId) {
          agentAmoIdMap.set(mapping.id, mapping.amocrmResponsibleUserId);
          amoIdToAgentId.set(mapping.amocrmResponsibleUserId, mapping.id);
        }
        if (mapping.utelManagerExternalId) {
          const ext = mapping.utelManagerExternalId.replace(/[^\d]/g, '');
          if (ext.length >= 2) {
            const existing = agentExtensions.get(mapping.id) || [];
            existing.push(ext);
            agentExtensions.set(mapping.id, existing);
          }
        }
      }

      const amoManagerIds = Array.from(new Set(agentAmoIdMap.values()));
      const allExtensions = Array.from(new Set(Array.from(agentExtensions.values()).flat()));

      // Parallel fetch: new leads, calls, activity, all incomes for debt collection
      const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
      const [newLeads, calls, activityByManager, allIncomes] = await Promise.all([
        amoContext && amoManagerIds.length > 0
          ? amocrmService.fetchAllLeads(
              amoContext.accessToken,
              {
                responsibleUserIds: amoManagerIds,
                createdAtFrom: rangeStart,
                createdAtTo: rangeEnd,
                limit: 250,
                maxPages: 20,
              },
              amoContext.baseUrl,
            )
          : Promise.resolve([]),
        allExtensions.length > 0
          ? prisma.call.findMany({
              where: {
                tenantId: ctx.tenantId,
                provider: 'utel',
                startedAt: { gte: rangeStart, lte: rangeEnd },
                OR: [
                  { from: { in: allExtensions } },
                  { to: { in: allExtensions } },
                ],
              },
              select: {
                from: true,
                to: true,
                duration: true,
                startedAt: true,
              },
            })
          : Promise.resolve([]),
        amoContext && amoManagerIds.length > 0
          ? getAmoCRMActivityMetrics({
              tenantId: ctx.tenantId,
              accessToken: amoContext.accessToken,
              baseUrl: amoContext.baseUrl,
              managerIds: amoManagerIds,
              rangeStart,
              rangeEnd,
              rangeKind: 'custom',
            })
          : Promise.resolve(new Map<string, { followUpCount: number; noteCount: number; stageChangeCount: number; overdueFollowUpCount: number; todayFollowUpCount: number }>()),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            managerUserId: { in: agentIds },
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: { gte: rangeStart, lte: rangeEnd },
          },
          select: {
            id: true,
            relatedDebtIncomeId: true,
            managerUserId: true,
            type: true,
            paymentAmount: true,
            coursePriceAmount: true,
            debtAmount: true,
          },
        }),
      ]);
      // Technical sales (agreement == 1) and their repayments are not real sales or collections.
      const kpiIncomes = excludeTechnicalRows(allIncomes, await loadTechnicalSaleIdsForRows(ctx.tenantId, allIncomes));

      // Group new leads by AmoCRM manager -> count per agent
      const newLeadCountByAgent = new Map<string, number>();
      for (const lead of newLeads) {
        const amoId = String(lead.responsible_user_id ?? '').trim();
        const agentId = amoIdToAgentId.get(amoId);
        if (agentId) {
          newLeadCountByAgent.set(agentId, (newLeadCountByAgent.get(agentId) || 0) + 1);
        }
      }

      // Group calls by agent -> total duration
      const extensionToAgent = new Map<string, string>();
      for (const [agentId, exts] of agentExtensions.entries()) {
        for (const ext of exts) {
          extensionToAgent.set(ext, agentId);
        }
      }
      const callDurationByAgent = new Map<string, number>();
      const callCountByAgent = new Map<string, number>();
      const callDaysByAgent = new Map<string, Set<string>>();
      for (const call of calls) {
        const fromExt = (call.from || '').replace(/[^\d]/g, '');
        const toExt = (call.to || '').replace(/[^\d]/g, '');
        const agentId = extensionToAgent.get(fromExt) || extensionToAgent.get(toExt);
        if (!agentId) continue;
        callDurationByAgent.set(agentId, (callDurationByAgent.get(agentId) || 0) + (call.duration || 0));
        callCountByAgent.set(agentId, (callCountByAgent.get(agentId) || 0) + 1);
        if (call.startedAt) {
          // Working day in Tashkent time, not the UTC date.
          const dayKey = new Date(call.startedAt.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const days = callDaysByAgent.get(agentId) || new Set<string>();
          days.add(dayKey);
          callDaysByAgent.set(agentId, days);
        }
      }

      // Group incomes for debt collection by agent
      const paidByAgent = new Map<string, number>();
      const agreementByAgent = new Map<string, number>();
      const salesCountByAgent = new Map<string, number>();
      for (const inc of kpiIncomes) {
        const agentId = inc.managerUserId;
        paidByAgent.set(agentId, (paidByAgent.get(agentId) || 0) + (inc.paymentAmount || 0));
        if (inc.type === 'new_sale') {
          agreementByAgent.set(agentId, (agreementByAgent.get(agentId) || 0) + resolveSaleAgreementAmount(inc));
        }
        if (inc.type === 'new_sale') {
          salesCountByAgent.set(agentId, (salesCountByAgent.get(agentId) || 0) + 1);
        }
      }

      // Score each agent
      const selectedKpiMetrics = kpi.selectedMetrics.filter((metric): metric is KpiMetricKey => KPI_METRIC_KEYS.includes(metric));
      const metricCount = selectedKpiMetrics.length;
      if (metricCount === 0) {
        for (const salaryRow of salaryByAgent.values()) {
          salaryRow.kpiAmount = 0;
          salaryRow.kpiBreakdown = null;
        }
      }
      const perKpiBudget = metricCount > 0 ? kpi.monthlyBudget / metricCount : 0;
      for (const salaryRow of salaryByAgent.values()) {
        const agentId = salaryRow.userId;
        const amoId = agentAmoIdMap.get(agentId);

        const salesCount = salesCountByAgent.get(agentId) || 0;
        const newLeadCount = newLeadCountByAgent.get(agentId) || 0;
        const conversionRate = newLeadCount > 0 ? (salesCount / newLeadCount) * 100 : 0;
        const totalDuration = callDurationByAgent.get(agentId) || 0;
        const activeDays = (callDaysByAgent.get(agentId) || new Set()).size;
        const dailyTalkTime = activeDays > 0 ? totalDuration / activeDays : 0;
        const totalPaid = paidByAgent.get(agentId) || 0;
        const totalAgreement = agreementByAgent.get(agentId) || 0;
        const debtCollectionRate = totalAgreement > 0 ? (totalPaid / totalAgreement) * 100 : 0;
        const activity = amoId ? activityByManager.get(amoId) : null;
        const followUpCount = activity?.followUpCount ?? 0;
        const callCount = callCountByAgent.get(agentId) || 0;
        const overdueFollowUpCount = activity?.overdueFollowUpCount ?? 0;
        const stageChangeCount = activity?.stageChangeCount ?? 0;
        const followUpDonePercent = (followUpCount + overdueFollowUpCount) > 0
          ? (followUpCount / (followUpCount + overdueFollowUpCount)) * 100
          : 0;

        const metricValues: Record<KpiMetricKey, number> = {
          conversion: Number(conversionRate.toFixed(2)),
          avgDailyTalkTime: Math.round(dailyTalkTime),
          debtCollectPercent: Number(debtCollectionRate.toFixed(2)),
          avgLeadResponseTime: 0,
          callCount: callCount,
          followUpCount: followUpCount,
          followUpDonePercent: Number(followUpDonePercent.toFixed(2)),
          stageChangeCount: stageChangeCount,
        };

        const kpiBreakdown = {} as Record<KpiMetricKey, KpiBreakdownEntry>;
        let kpiAmount = 0;

        for (const metric of selectedKpiMetrics) {
          const threshold = kpi.thresholds[metric];
          const value = metricValues[metric] ?? 0;
          const higherIsBetter = metric !== 'avgLeadResponseTime';
          const score = scoreKpi(value, threshold, higherIsBetter);
          const amount = Math.round(score * perKpiBudget);
          kpiBreakdown[metric] = {
            value,
            score,
            amount,
          };
          kpiAmount += amount;
        }

        salaryRow.kpiAmount = Math.round(kpiAmount);
        salaryRow.kpiBreakdown = selectedKpiMetrics.length > 0 ? kpiBreakdown : null;
      }
    }

    const attendancePenaltySettings = salarySettings.attendancePenaltySettings;
    const hasAttendancePenalty =
      attendancePenaltySettings.lateMinutePenaltyUZS > 0
      || attendancePenaltySettings.missingHourPenaltyUZS > 0
      || attendancePenaltySettings.absenceDayPenaltyUZS > 0;

    if (hasAttendancePenalty) {
      const dateFrom = toLocalDateKey(rangeStart);
      const dateTo = toLocalDateKey(rangeEnd);
      const summaries = await prisma.attendanceDaySummary.findMany({
        where: {
          tenantId: ctx.tenantId,
          userId: { in: agentIds },
          summaryDate: {
            gte: dateFrom,
            lte: dateTo,
          },
        },
        select: {
          userId: true,
          summaryDate: true,
          lateMinutes: true,
          missingSeconds: true,
          absence: true,
          firstInAt: true,
        },
      });

      const aggregate = new Map<string, { lateMinutes: number; missingSeconds: number }>();
      const presenceByUserMonth = new Map<string, { weekdayDates: Set<string>; sundayDates: Set<string> }>();
      const requiredWorkdaysByMonth = buildRequiredWorkdaysByMonth(rangeStart, rangeEnd);
      for (const row of summaries) {
        const existing = aggregate.get(row.userId) ?? { lateMinutes: 0, missingSeconds: 0 };
        existing.lateMinutes += Math.max(0, row.lateMinutes ?? 0);
        existing.missingSeconds += Math.max(0, row.missingSeconds ?? 0);
        aggregate.set(row.userId, existing);

        if (row.firstInAt) {
          const monthKey = row.summaryDate.slice(0, 7);
          const key = `${row.userId}|${monthKey}`;
          const monthPresence = presenceByUserMonth.get(key) ?? { weekdayDates: new Set<string>(), sundayDates: new Set<string>() };
          const dayOfWeek = getDayOfWeekFromLocalDateKey(row.summaryDate);
          if (dayOfWeek === 0) {
            monthPresence.sundayDates.add(row.summaryDate);
          } else {
            monthPresence.weekdayDates.add(row.summaryDate);
          }
          presenceByUserMonth.set(key, monthPresence);
        }
      }

      for (const salaryRow of salaryByAgent.values()) {
        const metrics = aggregate.get(salaryRow.userId) ?? { lateMinutes: 0, missingSeconds: 0 };
        const rawLatePenalty = metrics.lateMinutes * attendancePenaltySettings.lateMinutePenaltyUZS;
        const rawMissingHourPenalty = Math.round((metrics.missingSeconds / 3600) * attendancePenaltySettings.missingHourPenaltyUZS);
        const monthlyFixedSalary = salarySettings.fixedSalaries.get(salaryRow.userId) ?? salaryRow.fixedSalary;
        let rawAbsencePenalty = 0;
        if (monthlyFixedSalary > 0 && attendancePenaltySettings.absenceDayPenaltyUZS > 0) {
          for (const [monthKey, requiredWorkdays] of requiredWorkdaysByMonth.entries()) {
            if (requiredWorkdays <= 0) {
              continue;
            }
            const monthPresence = presenceByUserMonth.get(`${salaryRow.userId}|${monthKey}`);
            const weekdayAttended = monthPresence?.weekdayDates.size ?? 0;
            const sundayCredits = monthPresence?.sundayDates.size ?? 0;
            const creditedDays = weekdayAttended + sundayCredits;
            const missingDays = Math.max(requiredWorkdays - creditedDays, 0);
            if (missingDays <= 0) {
              continue;
            }
            const perDayPenalty = Math.round(monthlyFixedSalary / requiredWorkdays);
            rawAbsencePenalty += perDayPenalty * missingDays;
          }
        }

        const cap = attendancePenaltySettings.monthlyPenaltyCapUZS > 0
          ? attendancePenaltySettings.monthlyPenaltyCapUZS
          : Number.MAX_SAFE_INTEGER;
        let remainingCap = cap;
        const cappedLatePenalty = Math.min(rawLatePenalty, remainingCap);
        remainingCap -= cappedLatePenalty;
        const cappedMissingHourPenalty = Math.min(rawMissingHourPenalty, remainingCap);
        remainingCap -= cappedMissingHourPenalty;
        const cappedAbsencePenalty = Math.min(rawAbsencePenalty, remainingCap);

        let fixedPenalty = 0;
        let kpiPenalty = 0;

        const addPenalty = (amount: number, target: 'fixed' | 'kpi') => {
          if (amount <= 0) {
            return;
          }
          if (target === 'fixed') {
            const allowed = Math.max(0, salaryRow.fixedSalary - fixedPenalty);
            fixedPenalty += Math.min(amount, allowed);
            return;
          }
          const allowed = Math.max(0, salaryRow.kpiAmount - kpiPenalty);
          kpiPenalty += Math.min(amount, allowed);
        };

        addPenalty(cappedLatePenalty, attendancePenaltySettings.latePenaltyTarget);
        addPenalty(cappedMissingHourPenalty, attendancePenaltySettings.missingHourPenaltyTarget);
        addPenalty(cappedAbsencePenalty, 'fixed');

        salaryRow.attendancePenaltyFixed = fixedPenalty;
        salaryRow.attendancePenaltyKpi = kpiPenalty;
        salaryRow.attendancePenaltyTotal = fixedPenalty + kpiPenalty;
      }
    }

    const byAgent = Array.from(salaryByAgent.values())
      .map((row) => ({
        ...row,
        totalSalary: Math.max(0, row.fixedSalary + row.kpiAmount + row.bonusAmount + row.planBonusAmount + row.approvedAdjustmentAmount),
        salaryAfterAttendance:
          row.fixedSalary
          + row.kpiAmount
          + row.bonusAmount
          + row.planBonusAmount
          + row.approvedAdjustmentAmount
          - row.attendancePenaltyTotal,
      }))
      .map((row) => ({ ...row, salaryAfterAttendance: Math.max(0, row.salaryAfterAttendance) }))
      .sort((a, b) => b.salaryAfterAttendance - a.salaryAfterAttendance);

    const totals = byAgent.reduce(
      (acc, row) => ({
        fixedSalary: acc.fixedSalary + row.fixedSalary,
        bonus: acc.bonus + row.bonusAmount,
        approvedAdjustments: acc.approvedAdjustments + row.approvedAdjustmentAmount,
        planBonus: acc.planBonus + row.planBonusAmount,
        kpi: acc.kpi + row.kpiAmount,
        attendancePenaltyFixed: acc.attendancePenaltyFixed + row.attendancePenaltyFixed,
        attendancePenaltyKpi: acc.attendancePenaltyKpi + row.attendancePenaltyKpi,
        attendancePenalty: acc.attendancePenalty + row.attendancePenaltyTotal,
        salaryAfterAttendance: acc.salaryAfterAttendance + row.salaryAfterAttendance,
        salary: acc.salary + row.totalSalary,
      }),
      {
        fixedSalary: 0,
        bonus: 0,
        approvedAdjustments: 0,
        planBonus: 0,
        kpi: 0,
        attendancePenaltyFixed: 0,
        attendancePenaltyKpi: 0,
        attendancePenalty: 0,
        salaryAfterAttendance: 0,
        salary: 0,
      },
    );

    return {
      monthStart: rangeStart.toISOString(),
      monthEnd: rangeEnd.toISOString(),
      scopedToCurrentAgent: Boolean(scopedManagerUserId),
      bonusMode: viewedBonusMode,
      bonusPercentages: salarySettings.bonusPercentages,
      attendancePenaltySettings: salarySettings.attendancePenaltySettings,
      kpiSettings: kpi.enabled ? {
        monthlyBudget: kpi.monthlyBudget,
        selectedMetrics: kpi.selectedMetrics,
        thresholds: kpi.thresholds,
      } : null,
      totals,
      byAgent,
      currentUser: byAgent.find((row) => row.userId === ctx.user.userId) || null,
    };
    });
    });

const bonusIncomeDetailsInputSchema = z.object({
  range: dashboardRangeSchema.default('month'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  courseId: z.string().uuid().optional(),
  managerUserId: z.string().uuid().optional(),
});

type BonusIncomeDetailsInput = z.infer<typeof bonusIncomeDetailsInputSchema>;

type BonusIncomeDetailsContext = {
  tenantId: string;
  user: {
    userId: string;
    roles: UserRole[];
  };
};

type BonusIncomeDetailsOptions = {
  rowLimit?: number;
  rejectAboveLimit?: number;
};

async function loadBonusIncomeDetails({
  ctx,
  input,
  options = {},
}: {
  ctx: BonusIncomeDetailsContext;
  input: BonusIncomeDetailsInput;
  options?: BonusIncomeDetailsOptions;
}) {
      if (isTashkiliyOnly(ctx.user.roles)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Tashkiliy role cannot access bonus income details." });
      }

      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
      const selectedManagerUserId = scopedManagerUserId || input.managerUserId;

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
              hasSome: [...AGENT_ROLES, 'TeamLeader'],
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
      // Label with the bonus policy that applies to the viewed period, not whatever was saved last.
      const viewedBonusMode = (await resolveEffectiveBonusPolicy(ctx.tenantId, rangeEnd)).policy.bonusMode;
      const visibleAgents = selectedManagerUserId
        ? allAgents.filter((agent) => agent.id === selectedManagerUserId)
        : allAgents;
      const visibleAgentIds = visibleAgents.map((agent) => agent.id);

      if (!visibleAgentIds.length) {
        return {
          rangeStart: rangeStart.toISOString(),
          rangeEnd: rangeEnd.toISOString(),
          scopedToCurrentAgent: Boolean(scopedManagerUserId),
          bonusMode: viewedBonusMode,
          agentOptions: [],
          totals: {
            incomeAmount: 0,
            bonusAmount: 0,
            rowCount: 0,
          },
          summaryTotals: {
            incomeAmount: 0,
            closedAgreementAmount: 0,
            totalBonusAmount: 0,
            bonusByCategory: createZeroBreakdown(),
          },
          agentSummary: [] as Array<{
            managerUserId: string;
            managerLabel: string;
            incomeAmount: number;
            closedAgreementAmount: number;
            totalBonusAmount: number;
            bonusByCategory: SalaryBreakdown;
          }>,
          rows: [] as Array<{
            id: string;
            saleId: string | null;
            entryDate: Date;
            type: string;
            customerNumber: string;
            customerName: string;
            managerUserId: string;
            managerLabel: string;
            courseName: string | null;
            tariffName: string | null;
            subTariffName: string | null;
            agreementAmount: number;
            paymentAmount: number;
            remainingDebtAmount: number;
            calculatedBonus: number;
            isLastPayment: boolean;
            bonusDebug: {
              category: SalaryCategory | 'other';
              closedCount: number;
              appliedPercent: number;
              usedFallback: boolean;
            };
          }>,
        };
      }

      // All sales, not only the visible agents' own: a visible agent may record the closing payment on a colleague's sale.
      const activeSalesForBonus = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          ...(input.courseId ? { courseId: input.courseId } : {}),
          entryDate: {
            lte: rangeEnd,
          },
        },
        select: {
          id: true,
          courseId: true,
          managerUserId: true,
          coursePriceAmount: true,
          debtAmount: true,
          paymentAmount: true,
          entryDate: true,
          course: {
            select: {
              name: true,
              category: true,
            },
          },
        },
      });
      const technicalSaleIdsForBonusDetails = buildTechnicalSaleIdSet(activeSalesForBonus);
      const filteredActiveSalesForBonus = activeSalesForBonus.filter((sale) => !technicalSaleIdsForBonusDetails.has(sale.id));

      const incomeWhere = buildBonusDetailIncomeWhere({
        tenantId: ctx.tenantId,
        managerUserIds: visibleAgentIds,
        rangeStart,
        rangeEnd,
        courseId: input.courseId,
        technicalSaleIds: Array.from(technicalSaleIdsForBonusDetails),
      });

      if (options.rejectAboveLimit) {
        const totalCount = await prisma.income.count({ where: incomeWhere });
        if (isBonusDetailExportOverLimit(totalCount, options.rejectAboveLimit)) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: "Tanlangan filtr bo'yicha yozuvlar juda ko'p. Iltimos, qisqaroq davr tanlang.",
          });
        }
      }

      const incomes = await prisma.income.findMany({
        where: incomeWhere,
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        take: options.rowLimit,
        select: {
          id: true,
          type: true,
          entryDate: true,
          createdAt: true,
          paymentAmount: true,
          remainingDebtAmount: true,
          coursePriceAmount: true,
          debtAmount: true,
          managerUserId: true,
          relatedDebtIncomeId: true,
          legacyImportMeta: true,
          customer: {
            select: {
              customerNumber: true,
              name: true,
              profileSubTariffId: true,
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
              name: true,
              category: true,
            },
          },
          tariff: {
            select: {
              name: true,
            },
          },
          relatedDebtIncome: {
            select: {
              id: true,
              managerUserId: true,
              coursePriceAmount: true,
              debtAmount: true,
              paymentAmount: true,
              entryDate: true,
              legacyImportMeta: true,
              course: {
                select: {
                  name: true,
                  category: true,
                },
              },
              tariff: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      const subTariffIds = Array.from(new Set(
        incomes
          .map((income) => (
            extractBonusDetailSubTariffId(income.legacyImportMeta)
            || extractBonusDetailSubTariffId(income.relatedDebtIncome?.legacyImportMeta)
            || income.customer.profileSubTariffId
            || null
          ))
          .filter((id): id is string => Boolean(id)),
      ));
      const subTariffs = subTariffIds.length > 0
        ? await prisma.subTariff.findMany({
            where: {
              tenantId: ctx.tenantId,
              id: { in: subTariffIds },
            },
            select: { id: true, name: true },
          })
        : [];
      const subTariffNameById = new Map(subTariffs.map((subTariff) => [subTariff.id, subTariff.name]));

      const saleIdsForBonus = filteredActiveSalesForBonus.map((sale) => sale.id);
      const bonusChainRows = saleIdsForBonus.length > 0
        ? await prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              OR: [
                { id: { in: saleIdsForBonus } },
                { relatedDebtIncomeId: { in: saleIdsForBonus } },
              ],
            },
            select: {
              id: true,
              type: true,
              entryDate: true,
              createdAt: true,
              relatedDebtIncomeId: true,
              paymentAmount: true,
              managerUserId: true,
            },
          })
        : [];

      const chainMetricsBySaleId = buildSaleChainMetricsBySaleId({
        sales: filteredActiveSalesForBonus,
        chainRows: bonusChainRows,
      });

      const agreementAmountBySaleId = new Map<string, number>();
      for (const sale of filteredActiveSalesForBonus) {
        agreementAmountBySaleId.set(sale.id, resolveSaleAgreementAmount(sale));
      }

      const debtAfterPaymentByRowId = new Map<string, number>();
      const chainRowsBySaleId = new Map<string, typeof bonusChainRows>();
      for (const row of bonusChainRows) {
        const saleId = row.type === 'new_sale' ? row.id : row.relatedDebtIncomeId;
        if (!saleId) {
          continue;
        }
        const existing = chainRowsBySaleId.get(saleId) ?? [];
        existing.push(row);
        chainRowsBySaleId.set(saleId, existing);
      }
      for (const [saleId, chainRows] of chainRowsBySaleId.entries()) {
        const agreementAmount = agreementAmountBySaleId.get(saleId) ?? 0;
        const sorted = [...chainRows].sort((a, b) => {
          const dateDiff = a.entryDate.getTime() - b.entryDate.getTime();
          if (dateDiff !== 0) {
            return dateDiff;
          }
          const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
          if (createdDiff !== 0) {
            return createdDiff;
          }
          return a.id.localeCompare(b.id);
        });
        let runningPaid = 0;
        for (const row of sorted) {
          runningPaid += Number(row.paymentAmount ?? 0);
          const remaining = Math.max(agreementAmount - runningPaid, 0);
          debtAfterPaymentByRowId.set(row.id, remaining);
        }
      }

      // Closures come from the bonus engine so "closed" means exactly what it means for the bonus itself.
      const closuresInRange = (await loadSaleClosures({ tenantId: ctx.tenantId, rangeEnd }))
        .filter((closure) => closure.closedAt >= rangeStart && (!input.courseId || closure.courseId === input.courseId));
      const closingIncomeIds = new Set(closuresInRange.map((closure) => closure.closingIncomeId));
      const managerLabelById = new Map(
        visibleAgents.map((agent) => [agent.id, agent.name || agent.username || agent.id]),
      );

      const centralizedBonus = await calculateBonusRange({ tenantId: ctx.tenantId, rangeStart, rangeEnd });
      const bonusItemByIncomeId = new Map(
        centralizedBonus.items
          .filter((item) => visibleAgentIds.includes(item.agentUserId))
          .filter((item) => !input.courseId || item.courseId === input.courseId)
          .map((item) => [item.sourceIncomeId, item]),
      );

      const rows = incomes
        .filter((income) => !isRowLinkedToTechnicalSale({
          rowType: income.type,
          rowId: income.id,
          relatedDebtIncomeId: income.relatedDebtIncomeId,
          technicalSaleIds: technicalSaleIdsForBonusDetails,
        }))
        .map((income) => {
        const saleId = income.type === 'new_sale' ? income.id : income.relatedDebtIncomeId;
        const isLastPayment = closingIncomeIds.has(income.id);

        const courseCategory = income.course?.category ?? income.relatedDebtIncome?.course?.category;
        const courseName = income.course?.name ?? income.relatedDebtIncome?.course?.name;
        const category = classifyCourseCategoryFromField(courseCategory || courseName);
        const subTariffId = extractBonusDetailSubTariffId(income.legacyImportMeta)
          || extractBonusDetailSubTariffId(income.relatedDebtIncome?.legacyImportMeta)
          || income.customer.profileSubTariffId
          || null;

        const bonusItem = bonusItemByIncomeId.get(income.id);
        const calculatedBonus = bonusItem?.bonusAmount || 0;
        const appliedPercent = bonusItem?.appliedPercent || 0;
        const closedCount = bonusItem?.closedCount || 0;
        const usedFallback = bonusItem?.usedFallback || false;

        const agreementAmount = (saleId ? agreementAmountBySaleId.get(saleId) : undefined)
          ?? resolveSaleAgreementAmount(income.type === 'new_sale' ? income : (income.relatedDebtIncome ?? income));

        const debtAfterPaymentAmount = debtAfterPaymentByRowId.get(income.id);
        const chainRemainingDebtAmount = debtAfterPaymentAmount ?? (
          saleId
            ? (chainMetricsBySaleId.get(saleId)?.currentDebtAmount ?? Number(income.remainingDebtAmount ?? 0))
            : Number(income.remainingDebtAmount ?? 0)
        );

        return {
          id: income.id,
          saleId: saleId || null,
          entryDate: income.entryDate,
          type: income.type,
          customerNumber: income.customer.customerNumber,
          customerName: income.customer.name,
          managerUserId: income.managerUserId,
          managerLabel: income.manager.name || income.manager.username || income.manager.id,
          courseName: income.course?.name ?? income.relatedDebtIncome?.course?.name ?? null,
          tariffName: income.tariff?.name ?? income.relatedDebtIncome?.tariff?.name ?? null,
          subTariffName: subTariffId ? subTariffNameById.get(subTariffId) || null : null,
          agreementAmount,
          paymentAmount: income.paymentAmount ?? 0,
          remainingDebtAmount: chainRemainingDebtAmount,
          calculatedBonus,
          isLastPayment,
          bonusDebug: {
            category: bonusItem?.category || category,
            closedCount,
            appliedPercent,
            usedFallback,
            calculationMode: bonusItem?.calculationMode || null,
            finalized: centralizedBonus.months.some((month) => month.finalized),
          },
        };
      });

      // Totals are computed over the whole range, never from `rows`, which is capped for display.
      const incomeByManager = await prisma.income.groupBy({
        by: ['managerUserId'],
        where: incomeWhere,
        _sum: { paymentAmount: true },
        _count: { _all: true },
      });
      const visibleBonusItems = [...bonusItemByIncomeId.values()];
      const totals = {
        incomeAmount: incomeByManager.reduce((sum, group) => sum + Number(group._sum.paymentAmount || 0), 0),
        bonusAmount: visibleBonusItems.reduce((sum, item) => sum + item.bonusAmount, 0),
        rowCount: incomeByManager.reduce((sum, group) => sum + group._count._all, 0),
      };

      const agentSummaryMap = new Map<string, {
        managerUserId: string;
        managerLabel: string;
        incomeAmount: number;
        closedAgreementAmount: number;
        totalBonusAmount: number;
        bonusByCategory: SalaryBreakdown;
      }>();

      for (const agent of visibleAgents) {
        agentSummaryMap.set(agent.id, {
          managerUserId: agent.id,
          managerLabel: managerLabelById.get(agent.id) || agent.id,
          incomeAmount: 0,
          closedAgreementAmount: 0,
          totalBonusAmount: 0,
          bonusByCategory: createZeroBreakdown(),
        });
      }

      for (const group of incomeByManager) {
        const summary = agentSummaryMap.get(group.managerUserId);
        if (summary) summary.incomeAmount += Number(group._sum.paymentAmount || 0);
      }
      for (const item of visibleBonusItems) {
        const summary = agentSummaryMap.get(item.agentUserId);
        if (!summary) continue;
        summary.totalBonusAmount += item.bonusAmount;
        summary.bonusByCategory[item.category] += item.bonusAmount;
      }

      for (const closure of closuresInRange) {
        const summary = agentSummaryMap.get(closure.closerUserId);
        if (summary) summary.closedAgreementAmount += closure.agreementAmount;
      }

      const agentSummary = Array.from(agentSummaryMap.values()).sort((a, b) =>
        a.managerLabel.localeCompare(b.managerLabel),
      );

      const summaryTotals = agentSummary.reduce(
        (acc, row) => {
          acc.incomeAmount += row.incomeAmount;
          acc.closedAgreementAmount += row.closedAgreementAmount;
          acc.totalBonusAmount += row.totalBonusAmount;
          acc.bonusByCategory.online += row.bonusByCategory.online;
          acc.bonusByCategory.offline += row.bonusByCategory.offline;
          acc.bonusByCategory.intensive += row.bonusByCategory.intensive;
          acc.bonusByCategory.additional_service += row.bonusByCategory.additional_service;
          return acc;
        },
        {
          incomeAmount: 0,
          closedAgreementAmount: 0,
          totalBonusAmount: 0,
          bonusByCategory: createZeroBreakdown(),
        },
      );

      return {
        rangeStart: rangeStart.toISOString(),
        rangeEnd: rangeEnd.toISOString(),
        scopedToCurrentAgent: Boolean(scopedManagerUserId),
        bonusMode: viewedBonusMode,
        agentOptions: visibleAgents.map((agent) => ({
          id: agent.id,
          label: agent.name || agent.username || agent.id,
        })),
        totals,
        summaryTotals,
        agentSummary,
        rows,
      };
}

const bonusIncomeDetails = protectedProcedure
  .input(bonusIncomeDetailsInputSchema)
  .query(({ ctx, input }) => loadBonusIncomeDetails({
    ctx,
    input,
    options: { rowLimit: 3000 },
  }));

const exportBonusIncomeDetails = protectedProcedure
  .input(bonusIncomeDetailsInputSchema)
  .mutation(async ({ ctx, input }) => {
    const result = await loadBonusIncomeDetails({
      ctx,
      input,
      options: { rowLimit: BONUS_DETAIL_EXPORT_LIMIT, rejectAboveLimit: BONUS_DETAIL_EXPORT_LIMIT },
    });

    return {
      rangeStart: result.rangeStart,
      rangeEnd: result.rangeEnd,
      totalCount: result.rows.length,
      rows: result.rows,
    };
  });

export const salaryProcedures = {
  salarySummary,
  bonusIncomeDetails,
  exportBonusIncomeDetails,
};
