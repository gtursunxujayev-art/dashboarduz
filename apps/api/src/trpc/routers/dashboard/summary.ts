import type { DbClient } from '@dashboarduz/db';
import { AGENT_ROLES, dateRangeInput, isTashkiliyOnly, type ReportRangePreset, reportRangeSchema, TEAM_LEADER_ROLES } from '@dashboarduz/shared';

import { type ResolvedDataScope, resolveCallerDataScope } from '../../../lib/access';
import { withTimeout } from '../../../lib/async';
import { resolveDateRange } from '../../../lib/dates';
import { logger } from '../../../lib/logger';
import { loadTenantSettings } from '../../../lib/tenant-settings';
import { buildCacheKey, getOrSet, invalidateCache } from '../../../services/cache';
import { countedCallsWhere } from '../../../services/calls-source';
import { getCorporateCallDurationByManager } from '../../../services/corporate-call-durations';
import { readDashboardSettings } from '../../../services/dashboard/dashboard-settings';
import { canQueryScopedLeads, scopedManagerWhere, scopedResponsibleIds, scopedUserIdWhere } from '../../../services/dashboard/data-scope';
import { buildSellerPerformance, buildSummaryPieChart, countLeadsByResponsibleUser, countSummaryLeads, listUnmappedSellerNames, markSummarySourceUnavailable, resolveSummaryActivityStatus, summarizeIncomeByManager, summarizeNewSalesByCategory, summarizeTalkTime } from '../../../services/dashboard/summary-metrics';
import { createSummarySourceStatus, runSummarySourceWithRetry } from '../../../services/dashboard/summary-sources';
import { INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { excludeTechnicalRows, loadTechnicalSaleIdsForRows } from '../../../services/income-facts';
import type { AmoCRMLead } from '../../../services/integrations/amocrm';
import type { AmoCRMActivityMetrics } from '../../../services/integrations/amocrm-activity';
import { getAmoLeads } from '../../../services/integrations/amocrm-lead-snapshot-read';

import { buildFieldLabelMap, collectCatalogFieldOptions, createAmoCRMActivityDiagnostics, getAmoCRMActivityMetricsWithin, getSystemLeadFieldOptions, getTenantAmoCRMContext, protectedProcedure, summarizeAmoCRMActivityMetrics, z } from './helpers';

/** How long the dashboard summary waits for amoCRM activity before answering without it. */
const SUMMARY_ACTIVITY_WAIT_MS = 3_000;

type SummarySourceStatus = ReturnType<typeof createSummarySourceStatus>;
type AmoContext = NonNullable<Awaited<ReturnType<typeof getTenantAmoCRMContext>>>;
type SummaryPeriod = { tenantId: string; userId: string; scope: ResolvedDataScope; rangeStart: Date; rangeEnd: Date };
type SourceRun = { status: SummarySourceStatus; logContext: { tenantId: string; userId: string } };

const COURSE_SELECT = { select: { name: true, category: true } } as const;

/** amoCRM connection, lead field catalog and the period's leads; each degrades to a fallback with its status set. */
async function loadSummaryAmoSources(db: DbClient, period: SummaryPeriod, run: SourceRun, pipelineIds: string[] | undefined) {
  const { status } = run;
  const amoContext = await runSummarySourceWithRetry({
    ...run,
    key: 'amoContext',
    reasonFallback: 'amo_context_failed',
    fallback: null as AmoContext | null,
    run: async () => withTimeout(getTenantAmoCRMContext(period.tenantId, db), 2500, 'amo_context_timeout'),
  });

  if (!amoContext) {
    markSummarySourceUnavailable(status.amoContext, status.amoContext.reason || 'amo_not_connected');
  }

  const catalogOptions = amoContext
    ? await runSummarySourceWithRetry({
        ...run,
        key: 'catalog',
        reasonFallback: 'catalog_fetch_failed',
        fallback: [] as Awaited<ReturnType<typeof collectCatalogFieldOptions>>,
        run: async () => withTimeout(collectCatalogFieldOptions(period.tenantId, db), 2500, 'catalog_timeout'),
      })
    : [];

  if (!amoContext) {
    markSummarySourceUnavailable(status.catalog, 'amo_unavailable');
  }

  const selectedPipelineIds = pipelineIds && pipelineIds.length > 0 ? pipelineIds : (amoContext?.selectedPipelineIds ?? null);
  const { scope } = period;
  let leads: AmoCRMLead[] = [];

  if (amoContext && canQueryScopedLeads(scope)) {
    leads = await runSummarySourceWithRetry({
      ...run,
      key: 'leads',
      reasonFallback: 'amo_fetch_failed',
      fallback: [] as AmoCRMLead[],
      // Snapshot inside its window (instant); a range starting earlier is read from amoCRM.
      run: async () => withTimeout(
        getAmoLeads(
          period.tenantId,
          {
            pipelineIds: selectedPipelineIds,
            responsibleUserIds: scopedResponsibleIds(scope),
            createdAtFrom: period.rangeStart,
            createdAtTo: period.rangeEnd,
          },
          amoContext,
          db,
        ),
        30_000,
        'amo_leads_timeout',
      ),
    });
  } else {
    markSummarySourceUnavailable(status.leads, amoContext ? 'scope_unavailable' : 'amo_unavailable');
  }

  return { amoContext, catalogOptions, selectedPipelineIds, leads, leadsDataAvailable: status.leads.ok };
}

/** Notifications, integrations, the period's incomes (technical sales removed), calls and the agents to list. */
async function loadDashboardSummaryRows(db: DbClient, period: SummaryPeriod) {
  const { tenantId, scope, rangeStart, rangeEnd } = period;
  // Agents see their own rows, team leaders / OnlineAdmin their group, everyone else the company.
  const isScoped = scope.userIds !== null;
  const managerFilter = scopedManagerWhere(scope);
  const periodWhere = { lifecycleStatus: INCOME_LIFECYCLE_ACTIVE, entryDate: { gte: rangeStart, lte: rangeEnd } };
  const [pendingNotifications, activeIntegrations, newSalesIncomesRaw, incomesForSellersRaw, callsForSellers, agentUsers] = await Promise.all([
    isScoped
      ? Promise.resolve(0)
      : db.notification.count({
          where: { tenantId, status: { in: ['pending', 'retrying'] }, createdAt: { gte: rangeStart, lte: rangeEnd } },
        }),
    isScoped ? Promise.resolve(0) : db.integration.count({ where: { tenantId, status: 'active' } }),
    db.income.findMany({
      where: { tenantId, type: 'new_sale', ...periodWhere, ...managerFilter },
      select: { id: true, type: true, relatedDebtIncomeId: true, paymentAmount: true, coursePriceAmount: true, debtAmount: true, managerUserId: true, course: COURSE_SELECT },
    }),
    db.income.findMany({
      where: { tenantId, ...periodWhere, ...managerFilter },
      select: { id: true, relatedDebtIncomeId: true, managerUserId: true, type: true, paymentAmount: true, coursePriceAmount: true, debtAmount: true, course: COURSE_SELECT },
    }),
    db.call.findMany({
      where: { ...countedCallsWhere(tenantId), ...managerFilter, startedAt: { gte: rangeStart, lte: rangeEnd } },
      select: { managerUserId: true, duration: true },
    }),
    db.user.findMany({
      where: {
        tenantId,
        isActive: true,
        roles: { hasSome: [...AGENT_ROLES, ...TEAM_LEADER_ROLES] },
        ...scopedUserIdWhere(scope),
      },
      orderBy: [{ name: 'asc' }, { username: 'asc' }],
      select: { id: true, name: true, username: true, amocrmResponsibleUserId: true },
    }),
  ]);

  // Technical sales (agreement == 1) and their repayments are bookkeeping rows, not real income.
  const technicalSaleIds = await loadTechnicalSaleIdsForRows(tenantId, incomesForSellersRaw, db);

  return {
    pendingNotifications,
    activeIntegrations,
    newSalesIncomes: excludeTechnicalRows(newSalesIncomesRaw, technicalSaleIds),
    incomesForSellers: excludeTechnicalRows(incomesForSellersRaw, technicalSaleIds),
    callsForSellers,
    agentUsers,
  };
}

/**
 * amoCRM activity (tasks, notes, stage changes) per linked agent. It is paged from amoCRM live and can take longer
 * than the whole page should wait: wait briefly; otherwise it finishes in the background and the next refresh shows
 * it, instead of every widget in this batched request spinning for 30 s.
 */
async function loadSummaryActivity(db: DbClient, period: SummaryPeriod, run: SourceRun, params: {
  amoContext: AmoContext | null;
  managerIds: string[];
  rangeKind: ReportRangePreset;
}) {
  const diagnostics = createAmoCRMActivityDiagnostics();
  const { amoContext, managerIds } = params;
  let pending = false;
  const activityByManager = amoContext && managerIds.length > 0
    ? await runSummarySourceWithRetry({
        ...run,
        key: 'activity',
        reasonFallback: 'activity_fetch_failed',
        fallback: new Map<string, AmoCRMActivityMetrics>(),
        run: async () => {
          const lookup = await getAmoCRMActivityMetricsWithin({
            db,
            tenantId: period.tenantId,
            accessToken: amoContext.accessToken,
            baseUrl: amoContext.baseUrl,
            managerIds,
            rangeStart: period.rangeStart,
            rangeEnd: period.rangeEnd,
            rangeKind: params.rangeKind,
            diagnostics,
          }, SUMMARY_ACTIVITY_WAIT_MS);

          pending = lookup.pending;

          return lookup.metrics ?? new Map<string, AmoCRMActivityMetrics>();
        },
      })
    : new Map<string, AmoCRMActivityMetrics>();

  return { activityByManager, diagnostics, pending };
}

export const summaryProcedures = {
  summary: protectedProcedure
    .input(
      z.object({
        range: reportRangeSchema,
        pipelineIds: z.array(z.string()).optional(),
        ...dateRangeInput.shape,
        refreshKey: z.number().int().nonnegative().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const corporateRevision = await ctx.db.corporateCallDuration.aggregate({
        where: { tenantId: ctx.tenantId },
        _max: { updatedAt: true },
      });
      const cacheKey = buildCacheKey('summary', {
        t: ctx.tenantId,
        u: ctx.user.userId,
        r: input.range,
        p: input.pipelineIds,
        df: input.dateFrom,
        dt: input.dateTo,
        refresh: input.refreshKey === undefined ? undefined : String(input.refreshKey),
        cr: corporateRevision._max.updatedAt ? corporateRevision._max.updatedAt.toISOString() : '',
      });

      const result = await getOrSet(cacheKey, 120, async () => {
        const now = new Date();
        const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
        const tashkiliyOnly = isTashkiliyOnly(ctx.user.roles);
        const scope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
        const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);
        const leadRules = readDashboardSettings(tenantSettings);
        const period: SummaryPeriod = { tenantId: ctx.tenantId, userId: ctx.user.userId, scope, rangeStart, rangeEnd };

        // Tahlil source map:
        // - dashboard.summary (this route) => KPI/team block
        // - analyticsAi.metaInsights => Meta block
        // - analyticsAi.generateSuggestions => AI block
        const sourceStatus = createSummarySourceStatus();
        const run: SourceRun = { status: sourceStatus, logContext: { tenantId: ctx.tenantId, userId: ctx.user.userId } };
        const amo = await loadSummaryAmoSources(ctx.db, period, run, input.pipelineIds);
        const { amoContext, leads } = amo;
        const rows = await loadDashboardSummaryRows(ctx.db, period);
        const { agentUsers } = rows;

        const activityFetchStartedMs = Date.now();
        const activityManagerIds = agentUsers
          .map((agent) => (agent.amocrmResponsibleUserId ? String(agent.amocrmResponsibleUserId).trim() : ''))
          .filter(Boolean);
        const activity = await loadSummaryActivity(ctx.db, period, run, { amoContext, managerIds: activityManagerIds, rangeKind: input.range });
        const unmappedSellerNames = listUnmappedSellerNames(agentUsers);

        resolveSummaryActivityStatus(sourceStatus.activity, {
          activityPending: activity.pending,
          amoConnected: Boolean(amoContext),
          activityManagerCount: activityManagerIds.length,
          diagnostics: activity.diagnostics,
          unmappedSellerCount: unmappedSellerNames.length,
        });
        const activityFetchMs = Date.now() - activityFetchStartedMs;
        const activityTotals = summarizeAmoCRMActivityMetrics(activity.activityByManager);
        const corporateDurationByUserId = await runSummarySourceWithRetry({
          ...run,
          key: 'corporateCalls',
          reasonFallback: 'corporate_calls_fetch_failed',
          fallback: new Map<string, number>(),
          run: async () => getCorporateCallDurationByManager({
            tenantId: ctx.tenantId,
            managerUserIds: agentUsers.map((agent) => agent.id),
            rangeStart,
            rangeEnd,
            db: ctx.db,
          }),
        });

        const leadCounts = countSummaryLeads(leads, leadRules);
        const newSales = summarizeNewSalesByCategory(rows.newSalesIncomes);
        const income = summarizeIncomeByManager(rows.incomesForSellers);
        const talk = summarizeTalkTime({ calls: rows.callsForSellers, agents: agentUsers, corporateDurationByUserId });
        const totalLeads = leads.length;
        const newSalesCount = rows.newSalesIncomes.length;
        const sharePercent = (count: number) => Number((totalLeads > 0 ? (count / totalLeads) * 100 : 0).toFixed(2));
        const money = (amount: number) => (tashkiliyOnly ? 0 : amount);

        const sellerPerformance = buildSellerPerformance(agentUsers, {
          leadsByResponsibleUser: amo.leadsDataAvailable ? countLeadsByResponsibleUser(leads, leadRules) : new Map<string, { newLeads: number; qualifiedLeads: number }>(),
          salesByManager: income.salesByManager,
          activityByManager: activity.activityByManager,
          talkSecondsByAgent: talk.talkSecondsByAgent,
          callCountByAgent: talk.callCountByAgent,
          longCallCountByAgent: talk.longCallCountByAgent,
          leadsDataAvailable: amo.leadsDataAvailable,
          // While activity is still loading, show its cells as unknown rather than 0.
          activityRequestUnavailable: activity.pending
            || sourceStatus.activity.state === 'timeout'
            || sourceStatus.activity.state === 'unavailable',
          diagnostics: activity.diagnostics,
          hideMoney: tashkiliyOnly,
        });

        logger.info({
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          activityFetchMs,
          activityManagerCount: activityManagerIds.length,
          activityTotals,
        }, 'Dashboard summary activity timings');

        const fieldLabelMap = buildFieldLabelMap([...getSystemLeadFieldOptions(), ...amo.catalogOptions]);

        return {
          range: input.range,
          dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
          dateTo: input.range === 'custom' ? input.dateTo || null : null,
          selectedPipelineIds: amo.selectedPipelineIds || [],
          sourceStatus,
          unmappedSellerNames,
          sellerPerformance,
          summary: {
            totalLeads,
            qualifiedLeads: leadCounts.qualifiedLeads,
            nonQualifiedLeads: leadCounts.nonQualifiedLeads,
            totalCalls: scope.userIds
              ? scope.userIds.reduce((sum, id) => sum + (talk.callCountByAgent.get(id) ?? 0), 0)
              : rows.callsForSellers.length,
            pendingNotifications: rows.pendingNotifications,
            activeIntegrations: rows.activeIntegrations,
            totalIncomeAmount: money(income.totalIncomeAmount),
            newSalesCount,
            newSalesAgreementAmount: money(newSales.newSalesAgreementAmount),
            onlineSalesCount: newSales.onlineSalesCount,
            onlineSalesAgreementAmount: money(newSales.onlineSalesAgreementAmount),
            onlineSalesIncomeAmount: money(income.onlineSalesIncomeAmount),
            offlineSalesCount: newSales.offlineSalesCount,
            offlineSalesAgreementAmount: money(newSales.offlineSalesAgreementAmount),
            offlineSalesIncomeAmount: money(income.offlineSalesIncomeAmount),
            intensiveSalesCount: newSales.intensiveSalesCount,
            intensiveSalesAgreementAmount: money(newSales.intensiveSalesAgreementAmount),
            intensiveSalesIncomeAmount: money(income.intensiveSalesIncomeAmount),
            qualifiedLeadSharePercent: sharePercent(leadCounts.qualifiedLeads),
            nonQualifiedLeadSharePercent: sharePercent(leadCounts.nonQualifiedLeads),
            conversionPercent: sharePercent(newSalesCount),
            followUpCount: activityTotals.followUpCount,
            noteCount: activityTotals.noteCount,
            stageChangeCount: activityTotals.stageChangeCount,
            overdueFollowUpCount: activityTotals.overdueFollowUpCount,
            todayFollowUpCount: activityTotals.todayFollowUpCount,
          },
          pieCharts: {
            nonQualifiedByReason: buildSummaryPieChart(leadRules.reasonFieldKey, fieldLabelMap, leadCounts.reasonCounts),
            newLeadsBySource: buildSummaryPieChart(leadRules.sourceFieldKey, fieldLabelMap, leadCounts.sourceCounts),
          },
          updatedAt: now.toISOString(),
        };
      });

      // Don't keep a summary whose amoCRM activity was still loading: the next request should pick
      // up the activity once the background fetch lands.
      if (result.sourceStatus.activity.reason?.includes('activity_loading')) {
        await invalidateCache(cacheKey);
      }

      return result;
    }),
};
