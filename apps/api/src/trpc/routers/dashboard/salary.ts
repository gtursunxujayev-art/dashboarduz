import type { DbClient } from '@dashboarduz/db';
import { dateRangeInput, normalizeSubTariffName, reportRangeSchema, toTashkentDateKey } from '@dashboarduz/shared';
import { z } from 'zod';

import { resolveCallerDataScope } from '../../../lib/access';
import { resolveDateRange } from '../../../lib/dates';
import { calculateBonusRange, getApprovedAdjustmentsForMonth, getTashkentMonthStart, loadSaleClosures, resolveEffectiveBonusPolicy } from '../../../services/bonus-engine';
import { buildCacheKey, getOrSet } from '../../../services/cache';
import { countedCallsWhere } from '../../../services/calls-source';
import { pickScopedUsers } from '../../../services/dashboard/data-scope';
import { buildRequiredWorkdaysByMonth, calculateProratedFixedSalary } from '../../../services/dashboard/salary-helpers';
import { loadSalarySettingsAndAgents } from '../../../services/dashboard/salary-settings';
import { addApprovedAdjustments, addBonusItems, applyKpiScores, applyPlanProgress, computeAbsencePenalty, countNewLeadsByAgent, createSalaryAgentRow, describeKpiSettings, emptySalaryTotals, finalizeSalaryRows, mapAgentsToAmoUsers, type SalaryAgentResult, type SalaryRows, splitAttendancePenalty, summarizeAttendanceDays, summarizeKpiCalls, summarizeKpiIncomes, sumSalaryTotals } from '../../../services/dashboard/salary-summary';
import { INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { excludeTechnicalRows, loadTechnicalSaleIdsForRows } from '../../../services/income-facts';
import { type AmoCRMActivityMetrics, getAmoCRMActivityMetrics } from '../../../services/integrations/amocrm-activity';
import { getAmoLeads } from '../../../services/integrations/amocrm-lead-snapshot-read';
import { getTenantAmoCRMContext } from '../../../services/integrations/amocrm-live';
import { computePlanProgressByAgent } from '../../../services/plan-bonus';

import { bonusIncomeDetails, exportBonusIncomeDetails } from './bonus-income-details';
import { getCurrentMonthRange, type KpiSettings, protectedProcedure, type SalaryPlanBonus, type SalarySettingsSnapshot } from './helpers';

/** KPI metrics whose values come from amoCRM tasks and events. */
const AMO_ACTIVITY_KPI_METRICS: readonly string[] = ['followUpCount', 'followUpDonePercent', 'stageChangeCount'];

type SalaryPeriod = { db: DbClient; tenantId: string; rangeStart: Date; rangeEnd: Date; agentIds: string[] };

/** Plan ("reja") bonus progress per agent, from the sale closures up to the range end. */
async function loadPlanProgress(period: SalaryPeriod, activePlanBonuses: SalaryPlanBonus[]) {
  const { db, tenantId, rangeStart, rangeEnd, agentIds } = period;
  const closures = await loadSaleClosures({ tenantId, rangeEnd, db });
  const profileSubTariffIds = Array.from(new Set(
    closures.map((closure) => closure.profileSubTariffId).filter((value): value is string => Boolean(value)),
  ));
  const subTariffNameById = new Map<string, string>();

  if (profileSubTariffIds.length > 0) {
    const subTariffs = await db.subTariff.findMany({
      where: { tenantId, id: { in: profileSubTariffIds } },
      select: { id: true, name: true },
    });

    for (const subTariff of subTariffs) {
      subTariffNameById.set(subTariff.id, normalizeSubTariffName(subTariff.name));
    }
  }

  return computePlanProgressByAgent({ plans: activePlanBonuses, closures, agentIds, rangeStart, rangeEnd, subTariffNameById });
}

/** Scores every agent's KPI from amoCRM leads and activity, calls and incomes of the range. */
async function scoreKpiForRows(period: SalaryPeriod, rows: SalaryRows, kpi: KpiSettings): Promise<void> {
  const { db, tenantId, rangeStart, rangeEnd, agentIds } = period;
  const agentAmoMappings = await db.user.findMany({
    where: { tenantId, id: { in: agentIds }, isActive: true },
    select: { id: true, amocrmResponsibleUserId: true },
  });
  const { amoIdByAgentId, agentIdByAmoId } = mapAgentsToAmoUsers(agentAmoMappings);
  const amoManagerIds = Array.from(new Set(amoIdByAgentId.values()));
  const activeAgentIds = agentAmoMappings.map((mapping) => mapping.id);
  // amoCRM activity is paged live from amoCRM (slow over long ranges); fetch it only when a selected KPI is scored from it.
  const needsAmoActivity = kpi.selectedMetrics.some((metric) => AMO_ACTIVITY_KPI_METRICS.includes(metric));
  const amoContext = await getTenantAmoCRMContext(tenantId, db);
  const [newLeads, calls, activityByManager, allIncomes] = await Promise.all([
    amoContext && amoManagerIds.length > 0
      ? getAmoLeads(tenantId, { responsibleUserIds: amoManagerIds, createdAtFrom: rangeStart, createdAtTo: rangeEnd }, amoContext, db)
      : Promise.resolve([]),
    activeAgentIds.length > 0
      ? db.call.findMany({
          where: { ...countedCallsWhere(tenantId, activeAgentIds), startedAt: { gte: rangeStart, lte: rangeEnd } },
          select: { managerUserId: true, duration: true, startedAt: true },
        })
      : Promise.resolve([]),
    amoContext && amoManagerIds.length > 0 && needsAmoActivity
      ? getAmoCRMActivityMetrics({
          db,
          tenantId,
          accessToken: amoContext.accessToken,
          baseUrl: amoContext.baseUrl,
          managerIds: amoManagerIds,
          rangeStart,
          rangeEnd,
          rangeKind: 'custom',
        })
      : Promise.resolve(new Map<string, AmoCRMActivityMetrics>()),
    db.income.findMany({
      where: { tenantId, managerUserId: { in: agentIds }, lifecycleStatus: INCOME_LIFECYCLE_ACTIVE, entryDate: { gte: rangeStart, lte: rangeEnd } },
      select: { id: true, relatedDebtIncomeId: true, managerUserId: true, type: true, paymentAmount: true, coursePriceAmount: true, debtAmount: true },
    }),
  ]);
  // Technical sales (agreement == 1) and their repayments are not real sales or collections.
  const kpiIncomes = excludeTechnicalRows(allIncomes, await loadTechnicalSaleIdsForRows(tenantId, allIncomes, db));

  applyKpiScores(rows, kpi, {
    amoIdByAgentId,
    newLeadCountByAgent: countNewLeadsByAgent(newLeads, agentIdByAmoId),
    calls: summarizeKpiCalls(calls),
    incomes: summarizeKpiIncomes(kpiIncomes),
    activityByManager,
  });
}

/** Late, missing-hour and absence penalties from the attendance day summaries of the range. */
async function applyAttendancePenalties(period: SalaryPeriod, rows: SalaryRows, salarySettings: SalarySettingsSnapshot): Promise<void> {
  const { db, tenantId, rangeStart, rangeEnd, agentIds } = period;
  const settings = salarySettings.attendancePenaltySettings;
  const summaries = await db.attendanceDaySummary.findMany({
    where: {
      tenantId,
      userId: { in: agentIds },
      summaryDate: { gte: toTashkentDateKey(rangeStart), lte: toTashkentDateKey(rangeEnd) },
    },
    select: { userId: true, summaryDate: true, lateMinutes: true, missingSeconds: true, absence: true, firstInAt: true },
  });
  const { totalsByUser, presenceByUserMonth } = summarizeAttendanceDays(summaries);
  const requiredWorkdaysByMonth = buildRequiredWorkdaysByMonth(rangeStart, rangeEnd);

  for (const row of rows.values()) {
    const totals = totalsByUser.get(row.userId) ?? { lateMinutes: 0, missingSeconds: 0 };
    const { fixedPenalty, kpiPenalty } = splitAttendancePenalty({
      row,
      settings,
      lateMinutes: totals.lateMinutes,
      missingSeconds: totals.missingSeconds,
      absencePenalty: computeAbsencePenalty({
        userId: row.userId,
        monthlyFixedSalary: salarySettings.fixedSalaries.get(row.userId) ?? row.fixedSalary,
        absenceDayPenaltyUZS: settings.absenceDayPenaltyUZS,
        requiredWorkdaysByMonth,
        presenceByUserMonth,
      }),
    });

    row.attendancePenaltyFixed = fixedPenalty;
    row.attendancePenaltyKpi = kpiPenalty;
    row.attendancePenaltyTotal = fixedPenalty + kpiPenalty;
  }
}

const salarySummary = protectedProcedure
  .input(
    z.object({
      range: reportRangeSchema.default('month').optional(),
      ...dateRangeInput.shape,
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
      const resolvedRange = input
        ? resolveDateRange(input.range || 'month', now, input.dateFrom, input.dateTo)
        : getCurrentMonthRange(now);
      const rangeStart = 'rangeStart' in resolvedRange ? resolvedRange.rangeStart : resolvedRange.monthStart;
      const rangeEnd = 'rangeEnd' in resolvedRange ? resolvedRange.rangeEnd : resolvedRange.monthEnd;
      // Agents see their own row, team leaders / OnlineAdmin their group, everyone else every agent.
      const dataScope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
      const { salarySettings, allAgents } = await loadSalarySettingsAndAgents(ctx.db, ctx.tenantId);
      // Label with the bonus policy that applies to the viewed period, not whatever was saved last.
      const viewedBonusMode = (await resolveEffectiveBonusPolicy(ctx.tenantId, rangeEnd, ctx.db)).policy.bonusMode;
      const { users: agents, agentScoped } = pickScopedUsers(dataScope, allAgents, { callerId: ctx.user.userId, requestedUserId: input?.managerUserId });
      const period: SalaryPeriod = { db: ctx.db, tenantId: ctx.tenantId, rangeStart, rangeEnd, agentIds: agents.map((agent) => agent.id) };
      const kpi = salarySettings.kpiSettings;

      if (!period.agentIds.length) {
        return {
          monthStart: rangeStart.toISOString(),
          monthEnd: rangeEnd.toISOString(),
          scopedToCurrentAgent: agentScoped,
          bonusMode: viewedBonusMode,
          bonusPercentages: salarySettings.bonusPercentages,
          kpiSettings: describeKpiSettings(kpi),
          attendancePenaltySettings: salarySettings.attendancePenaltySettings,
          totals: emptySalaryTotals(),
          byAgent: [] as SalaryAgentResult[],
          currentUser: null,
        };
      }

      const rows: SalaryRows = new Map();

      for (const agent of agents) {
        const monthlyFixedSalary = salarySettings.fixedSalaries.get(agent.id) ?? 0;

        rows.set(agent.id, createSalaryAgentRow(agent, input?.prorateFixedSalary
          ? calculateProratedFixedSalary(monthlyFixedSalary, rangeStart, rangeEnd)
          : monthlyFixedSalary));
      }

      addBonusItems(rows, (await calculateBonusRange({ tenantId: ctx.tenantId, rangeStart, rangeEnd, db: ctx.db })).items);
      addApprovedAdjustments(rows, await getApprovedAdjustmentsForMonth(ctx.tenantId, rangeEnd, ctx.db), getTashkentMonthStart(rangeStart));

      const activePlanBonuses = salarySettings.planBonuses.filter((plan) => plan.isActive);

      if (activePlanBonuses.length > 0) {
        applyPlanProgress(rows, await loadPlanProgress(period, activePlanBonuses));
      }
      if (kpi.enabled && kpi.monthlyBudget > 0) {
        await scoreKpiForRows(period, rows, kpi);
      }

      const penalties = salarySettings.attendancePenaltySettings;

      if (penalties.lateMinutePenaltyUZS > 0 || penalties.missingHourPenaltyUZS > 0 || penalties.absenceDayPenaltyUZS > 0) {
        await applyAttendancePenalties(period, rows, salarySettings);
      }

      const byAgent = finalizeSalaryRows(rows.values());

      return {
        monthStart: rangeStart.toISOString(),
        monthEnd: rangeEnd.toISOString(),
        scopedToCurrentAgent: agentScoped,
        bonusMode: viewedBonusMode,
        bonusPercentages: salarySettings.bonusPercentages,
        attendancePenaltySettings: salarySettings.attendancePenaltySettings,
        kpiSettings: describeKpiSettings(kpi),
        totals: sumSalaryTotals(byAgent),
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
