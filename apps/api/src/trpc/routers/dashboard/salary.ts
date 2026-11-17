import { AGENT_ROLES, isAgentOnly, normalizeSubTariffName, reportRangeSchema, TASHKENT_OFFSET_MS, toTashkentDateKey } from '@dashboarduz/shared';
import { z } from 'zod';

import { resolveDateRange } from '../../../lib/dates';
import { calculateBonusRange, getApprovedAdjustmentsForMonth, getTashkentMonthStart, loadSaleClosures, resolveEffectiveBonusPolicy } from '../../../services/bonus-engine';
import { buildCacheKey, getOrSet } from '../../../services/cache';
import { countedCallsWhere } from '../../../services/calls-source';
import { buildRequiredWorkdaysByMonth, calculateProratedFixedSalary, getDayOfWeekFromLocalDateKey, type KpiBreakdownEntry, scoreKpi } from '../../../services/dashboard/salary-helpers';
import { INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { excludeTechnicalRows, loadTechnicalSaleIdsForRows, resolveSaleAgreementAmount } from '../../../services/income-facts';
import { getAmoCRMActivityMetrics } from '../../../services/integrations/amocrm-activity';
import { fetchSnapshotLeads } from '../../../services/integrations/amocrm-lead-snapshot-read';
import { getTenantAmoCRMContext } from '../../../services/integrations/amocrm-live';
import { computePlanProgressByAgent } from '../../../services/plan-bonus';

import { bonusIncomeDetails, exportBonusIncomeDetails } from './bonus-income-details';
import { createZeroBreakdown, extractSalarySettings, getCurrentMonthRange, KPI_METRIC_KEYS, type KpiMetricKey, type PlanBonusPeriodMode, protectedProcedure, type SalaryBreakdown, TRPCError } from './helpers';

const salarySummary = protectedProcedure
    .input(
      z.object({
        range: reportRangeSchema.default('month').optional(),
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
      ctx.db.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      }),
      ctx.db.user.findMany({
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
    const viewedBonusMode = (await resolveEffectiveBonusPolicy(ctx.tenantId, rangeEnd, ctx.db)).policy.bonusMode;
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

    const bonusRange = await calculateBonusRange({ tenantId: ctx.tenantId, rangeStart, rangeEnd, db: ctx.db });

    for (const item of bonusRange.items) {
      const salaryRow = salaryByAgent.get(item.agentUserId);

      if (!salaryRow) continue;
      salaryRow.bonusAmount += item.bonusAmount;
      salaryRow.bonusBreakdown[item.category] += item.bonusAmount;
    }
    const approvedAdjustments = await getApprovedAdjustmentsForMonth(ctx.tenantId, rangeEnd, ctx.db);
    const adjustmentRangeMonthStart = getTashkentMonthStart(rangeStart);

    for (const adjustment of approvedAdjustments) {
      const salaryRow = salaryByAgent.get(adjustment.agentUserId);

      if (!salaryRow || !adjustment.payoutMonth || adjustment.payoutMonth < adjustmentRangeMonthStart) continue;
      salaryRow.approvedAdjustmentAmount += adjustment.outstandingAmount;
      salaryRow.outstandingAdjustmentBalance += adjustment.outstandingAmount;
    }

    const activePlanBonuses = salarySettings.planBonuses.filter((plan) => plan.isActive);

    if (activePlanBonuses.length > 0) {
      const closures = await loadSaleClosures({ tenantId: ctx.tenantId, rangeEnd, db: ctx.db });
      const profileSubTariffIds = Array.from(new Set(
        closures.map((closure) => closure.profileSubTariffId).filter((value): value is string => Boolean(value)),
      ));
      const subTariffNameById = new Map<string, string>();

      if (profileSubTariffIds.length > 0) {
        const subTariffs = await ctx.db.subTariff.findMany({
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
      // Fetch agent -> AmoCRM mapping
      let agentAmoMappings: Array<{ id: string; amocrmResponsibleUserId: string | null }> = [];

      agentAmoMappings = await ctx.db.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: agentIds },
          isActive: true,
        },
        select: {
          id: true,
          amocrmResponsibleUserId: true,
        },
      }) as Array<{ id: string; amocrmResponsibleUserId: string | null }>;

      const agentAmoIdMap = new Map<string, string>(); // agentId -> amoId
      const amoIdToAgentId = new Map<string, string>(); // amoId -> agentId

      for (const mapping of agentAmoMappings) {
        if (mapping.amocrmResponsibleUserId) {
          agentAmoIdMap.set(mapping.id, mapping.amocrmResponsibleUserId);
          amoIdToAgentId.set(mapping.amocrmResponsibleUserId, mapping.id);
        }
      }

      const amoManagerIds = Array.from(new Set(agentAmoIdMap.values()));
      const activeAgentIds = agentAmoMappings.map((mapping) => mapping.id);

      // Parallel fetch: new leads, calls, activity, all incomes for debt collection
      const amoContext = await getTenantAmoCRMContext(ctx.tenantId, ctx.db);
      const [newLeads, calls, activityByManager, allIncomes] = await Promise.all([
        amoContext && amoManagerIds.length > 0
          ? fetchSnapshotLeads(
              ctx.tenantId,
              {
                responsibleUserIds: amoManagerIds,
                createdAtFrom: rangeStart,
                createdAtTo: rangeEnd,
              },
              ctx.db,
            )
          : Promise.resolve([]),
        activeAgentIds.length > 0
          ? ctx.db.call.findMany({
              where: {
                ...countedCallsWhere(ctx.tenantId, activeAgentIds),
                startedAt: { gte: rangeStart, lte: rangeEnd },
              },
              select: {
                managerUserId: true,
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
        ctx.db.income.findMany({
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
      const kpiIncomes = excludeTechnicalRows(allIncomes, await loadTechnicalSaleIdsForRows(ctx.tenantId, allIncomes, ctx.db));

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
      const callDurationByAgent = new Map<string, number>();
      const callCountByAgent = new Map<string, number>();
      const callDaysByAgent = new Map<string, Set<string>>();

      for (const call of calls) {
        const agentId = call.managerUserId;

        if (!agentId) continue;
        callDurationByAgent.set(agentId, (callDurationByAgent.get(agentId) || 0) + (call.duration || 0));
        callCountByAgent.set(agentId, (callCountByAgent.get(agentId) || 0) + 1);
        if (call.startedAt) {
          // Working day in Tashkent time, not the UTC date.
          const dayKey = new Date(call.startedAt.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
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
      const dateFrom = toTashkentDateKey(rangeStart);
      const dateTo = toTashkentDateKey(rangeEnd);
      const summaries = await ctx.db.attendanceDaySummary.findMany({
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

export const salaryProcedures = {
  salarySummary,
  bonusIncomeDetails,
  exportBonusIncomeDetails,
};
