import { dateRangeInput, sellerRangeSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getAgentResponsibleScope } from '../../../lib/access';
import { resolveDateRange } from '../../../lib/dates';
import { logger } from '../../../lib/logger';
import { countedCallsWhere } from '../../../services/calls-source';
import { getCorporateCallDurationByManager } from '../../../services/corporate-call-durations';
import { type AmoCRMLead } from '../../../services/integrations/amocrm';
import { getAmoCRMActivityMetrics, summarizeAmoCRMActivityMetrics } from '../../../services/integrations/amocrm-activity';
import { getAmoReference } from '../../../services/integrations/amocrm-activity-snapshot-read';
import { getAmoLeads } from '../../../services/integrations/amocrm-lead-snapshot-read';
import { getTenantAmoCRMContext } from '../../../services/integrations/amocrm-live';
import { computeLeadResponseTimes, getSelectedPipelines } from '../../../services/sellers/leads';
import { buildSellersListCacheKey, SELLERS_ACTIVITY_CACHE_TTL_MS, SELLERS_LIST_CACHE_TTL_MS, sellersListCache } from '../../../services/sellers/list-cache';
import { asString, buildMetrics, excludeTechnicalSellerIncomes, getLeadResponsibleId, LOST_STATUS_ID, type SellerIncomeMetricSource, summarizeSellerIncomeMetrics, toManagerRole, WON_STATUS_ID } from '../../../services/sellers/metrics';
import { protectedProcedure } from '../../trpc';

export const sellerListProcedures = {
  list: protectedProcedure
    .input(
      z.object({
        range: sellerRangeSchema.default('last30days').optional(),
        ...dateRangeInput.shape,
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
    const startedAtMs = Date.now();
    const timings: Record<string, number> = {};
    const now = new Date();
    const range = input?.range || 'last30days';
    const { rangeStart, rangeEnd } = resolveDateRange(range, now, input?.dateFrom, input?.dateTo);
    const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);

    timings.scopeMs = Date.now() - startedAtMs;

    const amoContextStartedMs = Date.now();
    const amoContext = await getTenantAmoCRMContext(ctx.tenantId, ctx.db);

    timings.amoContextMs = Date.now() - amoContextStartedMs;

    if (!amoContext) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'AmoCRM integration is not connected.',
      });
    }

    const amocrmUsersPromise = (async () => {
      const stepStartedMs = Date.now();
      const result = await getAmoReference(ctx.tenantId, 'users', amoContext, ctx.db);

      timings.amocrmUsersMs = Date.now() - stepStartedMs;

      return result;
    })();

    const pipelinesPromise = (async () => {
      const stepStartedMs = Date.now();
      const result = await getAmoReference(ctx.tenantId, 'pipelines', amoContext, ctx.db);

      timings.amocrmPipelinesMs = Date.now() - stepStartedMs;

      return result;
    })();

    const [amocrmUsers, pipelinesResponse] = await Promise.all([amocrmUsersPromise, pipelinesPromise]);
    const pipelines = Array.isArray(pipelinesResponse._embedded?.pipelines) ? pipelinesResponse._embedded.pipelines : [];
    const selectedPipelineIds = getSelectedPipelines(amoContext.selectedPipelineIds, pipelines);

    const managerPreparationStartedMs = Date.now();
    const managers = amocrmUsers
      .filter((user) => user.is_active !== false)
      .filter((user) => {
        if (!scope.isScoped) {
          return true;
        }

        return asString(user.id) === scope.responsibleUserId;
      });

    const managerIds = new Set(
      managers
        .map((manager) => asString(manager.id))
        .filter(Boolean) as string[],
    );

    timings.managerPreparationMs = Date.now() - managerPreparationStartedMs;

    const managerIdList = Array.from(managerIds);
    const corporateRevision = await ctx.db.corporateCallDuration.aggregate({
      where: { tenantId: ctx.tenantId },
      _max: { updatedAt: true },
    });
    const corporateRevisionKey = corporateRevision._max.updatedAt
      ? corporateRevision._max.updatedAt.toISOString()
      : '';
    const listCacheKey = buildSellersListCacheKey(
      ctx.tenantId,
      scope.isScoped ? (scope.responsibleUserId || '__unmapped__') : null,
      selectedPipelineIds,
      range,
      corporateRevisionKey,
      input?.dateFrom,
      input?.dateTo,
    );
    const cached = sellersListCache.get(listCacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      timings.totalMs = Date.now() - startedAtMs;
      logger.info({
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        managerCount: managers.length,
        selectedPipelineIds,
        cacheHit: true,
        timings,
      }, 'Sellers list timings');

      return cached.data;
    }

    const leadsFetchStartedMs = Date.now();
    const activeLeadsPromise = (async () => {
      const allPipelineLeads = await getAmoLeads(
        ctx.tenantId,
        {
          pipelineIds: selectedPipelineIds,
          responsibleUserIds: managerIdList,
        },
        amoContext,
        ctx.db,
      );

      return allPipelineLeads.filter((lead) => {
        const statusId = asString(lead.status_id);

        return statusId !== WON_STATUS_ID && statusId !== LOST_STATUS_ID;
      });
    })();

    const newLeadsInRangePromise = getAmoLeads(
      ctx.tenantId,
      {
        pipelineIds: selectedPipelineIds,
        responsibleUserIds: managerIdList,
        createdAtFrom: rangeStart,
        createdAtTo: rangeEnd,
      },
      amoContext,
      ctx.db,
    );

    const activityFetchStartedMs = Date.now();
    const roundedNow = new Date(Math.floor(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000));
    const activityPromise = getAmoCRMActivityMetrics({
      db: ctx.db,
      tenantId: ctx.tenantId,
      accessToken: amoContext.accessToken,
      baseUrl: amoContext.baseUrl,
      managerIds: managerIdList,
      rangeStart,
      rangeEnd: roundedNow < rangeEnd ? roundedNow : rangeEnd,
      rangeKind: range === 'today' ? 'today' : (range === 'last30days' ? 'month' : range),
      cacheTtlMs: SELLERS_ACTIVITY_CACHE_TTL_MS,
    });

    const userMappingStartedMs = Date.now();
    const userMappingsPromise = (async () => {
      return await ctx.db.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          amocrmResponsibleUserId: { in: managerIdList },
        },
        select: {
          id: true,
          amocrmResponsibleUserId: true,
        },
      });
    })();

    const [activeLeads, newLeadsInRange, activityByManager, userMappings] = await Promise.all([
      activeLeadsPromise,
      newLeadsInRangePromise,
      activityPromise,
      userMappingsPromise,
    ]);

    timings.amocrmLeadsMs = Date.now() - leadsFetchStartedMs;
    timings.activityFetchMs = Date.now() - activityFetchStartedMs;
    timings.userMappingMs = Date.now() - userMappingStartedMs;

    // Start lead response time computation in parallel (doesn't block other work)
    const leadResponseTimePromise = computeLeadResponseTimes({
      tenantId: ctx.tenantId,
      access: amoContext,
      db: ctx.db,
      managerIds: managerIdList,
      newLeads: newLeadsInRange,
      rangeStart,
      rangeEnd,
    });

    const leadsGroupingStartedMs = Date.now();
    const activeLeadsByManager = new Map<string, AmoCRMLead[]>();

    for (const lead of activeLeads) {
      const responsibleUserId = getLeadResponsibleId(lead);

      if (!responsibleUserId || !managerIds.has(responsibleUserId)) {
        continue;
      }
      const current = activeLeadsByManager.get(responsibleUserId) || [];

      current.push(lead);
      activeLeadsByManager.set(responsibleUserId, current);
    }
    const newLeadsByManager = new Map<string, AmoCRMLead[]>();

    for (const lead of newLeadsInRange) {
      const responsibleUserId = getLeadResponsibleId(lead);

      if (!responsibleUserId || !managerIds.has(responsibleUserId)) {
        continue;
      }
      const current = newLeadsByManager.get(responsibleUserId) || [];

      current.push(lead);
      newLeadsByManager.set(responsibleUserId, current);
    }
    timings.leadsGroupingMs = Date.now() - leadsGroupingStartedMs;

    const managerUserIdsByAmoId = new Map<string, string[]>();

    for (const mapping of userMappings as Array<{ id: string; amocrmResponsibleUserId: string | null }>) {
      const managerId = asString(mapping.amocrmResponsibleUserId);

      if (!managerId) {
        continue;
      }
      const current = managerUserIdsByAmoId.get(managerId) || [];

      current.push(mapping.id);
      managerUserIdsByAmoId.set(managerId, current);
    }

    const callsFetchStartedMs = Date.now();
    const mappedUserIds = Array.from(managerUserIdsByAmoId.values()).flat();
    let calls: Array<{ managerUserId: string | null; duration: number | null; direction: string; status: string; startedAt: Date | null }> = [];

    if (mappedUserIds.length > 0) {
      calls = await ctx.db.call.findMany({
        where: {
          ...countedCallsWhere(ctx.tenantId, mappedUserIds),
          startedAt: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
        select: {
          managerUserId: true,
          duration: true,
          direction: true,
          status: true,
          startedAt: true,
        },
      });
    }
    timings.callsFetchMs = Date.now() - callsFetchStartedMs;

    const incomeFetchStartedMs = Date.now();
    const allManagerUserIds = Array.from(new Set(Array.from(managerUserIdsByAmoId.values()).flat()));
    const [incomesRaw, refundRequests, incomesWithCustomer, incomesWithDeadline] = await Promise.all([
      allManagerUserIds.length > 0
        ? (async () => {
            return await ctx.db.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: 'active',
                managerUserId: { in: allManagerUserIds },
                entryDate: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
              },
              select: {
                managerUserId: true,
                type: true,
                paymentAmount: true,
                coursePriceAmount: true,
                debtAmount: true,
                id: true,
                relatedDebtIncomeId: true,
                course: {
                  select: {
                    category: true,
                    name: true,
                  },
                },
              },
            });
          })()
        : [],
      // Refund requests by manager in period
      allManagerUserIds.length > 0
        ? (async () => {
            return await ctx.db.incomeAdjustmentRequest.findMany({
              where: {
                tenantId: ctx.tenantId,
                type: 'refund',
                status: 'approved',
                createdAt: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
                income: {
                  managerUserId: { in: allManagerUserIds },
                },
              },
              select: {
                income: {
                  select: { managerUserId: true },
                },
              },
            });
          })()
        : [],
      // Incomes with customerId for new vs repeat
      allManagerUserIds.length > 0
        ? (async () => {
            return await ctx.db.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: 'active',
                type: 'new_sale',
                managerUserId: { in: allManagerUserIds },
                entryDate: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
              },
              select: {
                managerUserId: true,
                customerId: true,
              },
            });
          })()
        : [],
      // Incomes with deadline for payment adherence
      allManagerUserIds.length > 0
        ? (async () => {
            return await ctx.db.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: 'active',
                managerUserId: { in: allManagerUserIds },
                entryDate: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
                deadline: { not: null },
              },
              select: {
                managerUserId: true,
                entryDate: true,
                deadline: true,
                paymentAmount: true,
                remainingDebtAmount: true,
              },
            });
          })()
        : [],
    ]);
    const incomes = await excludeTechnicalSellerIncomes(ctx.tenantId, incomesRaw, ctx.db);

    timings.incomeFetchMs = Date.now() - incomeFetchStartedMs;

    const callsGroupingStartedMs = Date.now();
    const callsByManager = new Map<string, Array<{ duration: number | null; direction: string; status: string; startedAt: Date | null }>>();

    const amoIdByUserId = new Map<string, string>();

    for (const [managerId, userIds] of managerUserIdsByAmoId.entries()) {
      for (const userId of userIds) {
        amoIdByUserId.set(userId, managerId);
      }
    }

    for (const call of calls) {
      const managerId = call.managerUserId ? amoIdByUserId.get(call.managerUserId) : undefined;

      if (!managerId) {
        continue;
      }

      const current = callsByManager.get(managerId) || [];

      current.push({
        duration: call.duration,
        direction: call.direction,
        status: call.status,
        startedAt: call.startedAt,
      });
      callsByManager.set(managerId, current);
    }
    timings.callsGroupingMs = Date.now() - callsGroupingStartedMs;

    const incomeGroupingStartedMs = Date.now();
    const incomesByManager = new Map<string, SellerIncomeMetricSource[]>();
    const managerIdByUserId = new Map<string, string>();

    for (const [managerId, userIds] of managerUserIdsByAmoId.entries()) {
      for (const userId of userIds) {
        managerIdByUserId.set(userId, managerId);
      }
    }
    const corporateDurationByUserId = await getCorporateCallDurationByManager({
      tenantId: ctx.tenantId,
      managerUserIds: Array.from(managerIdByUserId.keys()),
      rangeStart,
      rangeEnd,
      db: ctx.db,
    });
    const corporateDurationByManager = new Map<string, number>();

    for (const [userId, durationSeconds] of corporateDurationByUserId.entries()) {
      const managerId = managerIdByUserId.get(userId);

      if (!managerId) {
        continue;
      }
      corporateDurationByManager.set(
        managerId,
        (corporateDurationByManager.get(managerId) || 0) + durationSeconds,
      );
    }

    for (const income of incomes) {
      const managerId = managerIdByUserId.get(income.managerUserId || '');

      if (!managerId) {
        continue;
      }
      const current = incomesByManager.get(managerId) || [];

      current.push({
        type: income.type,
        paymentAmount: income.paymentAmount,
        coursePriceAmount: income.coursePriceAmount,
        course: income.course,
      });
      incomesByManager.set(managerId, current);
    }
    // Group refund requests by manager
    const refundsByManager = new Map<string, number>();

    for (const req of refundRequests) {
      const managerId = managerIdByUserId.get(req.income.managerUserId || '');

      if (!managerId) continue;
      refundsByManager.set(managerId, (refundsByManager.get(managerId) || 0) + 1);
    }

    // New vs Repeat customers: find which customerIds had purchases before rangeStart
    const allCustomerIds = [...new Set(incomesWithCustomer.map((i) => i.customerId))];
    const repeatCustomerIds = new Set<string>();

    if (allCustomerIds.length > 0) {
      const priorIncomes = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          lifecycleStatus: 'active',
          customerId: { in: allCustomerIds },
          entryDate: { lt: rangeStart },
        },
        select: { customerId: true },
        distinct: ['customerId'],
      });

      for (const pi of priorIncomes) {
        repeatCustomerIds.add(pi.customerId);
      }
    }
    // Group new vs repeat by manager
    const newCustomersByManager = new Map<string, number>();
    const repeatCustomersByManager = new Map<string, number>();
    const seenCustomerByManager = new Map<string, Set<string>>();

    for (const inc of incomesWithCustomer) {
      const managerId = managerIdByUserId.get(inc.managerUserId || '');

      if (!managerId) continue;
      const seen = seenCustomerByManager.get(managerId) || new Set();

      if (seen.has(inc.customerId)) continue;
      seen.add(inc.customerId);
      seenCustomerByManager.set(managerId, seen);
      if (repeatCustomerIds.has(inc.customerId)) {
        repeatCustomersByManager.set(managerId, (repeatCustomersByManager.get(managerId) || 0) + 1);
      } else {
        newCustomersByManager.set(managerId, (newCustomersByManager.get(managerId) || 0) + 1);
      }
    }

    // Payment deadline adherence by manager
    const deadlineMetByManager = new Map<string, number>();
    const deadlineTotalByManager = new Map<string, number>();

    for (const inc of incomesWithDeadline) {
      const managerId = managerIdByUserId.get(inc.managerUserId || '');

      if (!managerId || !inc.deadline) continue;
      deadlineTotalByManager.set(managerId, (deadlineTotalByManager.get(managerId) || 0) + 1);
      if (inc.remainingDebtAmount <= 0 || inc.entryDate <= inc.deadline) {
        deadlineMetByManager.set(managerId, (deadlineMetByManager.get(managerId) || 0) + 1);
      }
    }
    timings.incomeGroupingMs = Date.now() - incomeGroupingStartedMs;

    const leadResponseTimeByManager = await leadResponseTimePromise;

    const buildResponseStartedMs = Date.now();
    const result = managers
      .map((manager) => {
        const managerId = asString(manager.id) || '';
        const managerActiveLeads = activeLeadsByManager.get(managerId) || [];
        const managerCalls = callsByManager.get(managerId) || [];
        const managerActivity = activityByManager.get(managerId) || null;
        const managerIncomes = incomesByManager.get(managerId) || [];
        const salesMetrics = summarizeSellerIncomeMetrics(managerIncomes, rangeStart, rangeEnd);

        const managerNewLeads = newLeadsByManager.get(managerId) || [];
        const newLeadCount = managerNewLeads.length;
        const listConversionRate = newLeadCount > 0
          ? Number(((salesMetrics.newSalesCount / newLeadCount) * 100).toFixed(2))
          : 0;

        return {
          id: managerId,
          name: manager.name || manager.login || `Manager ${managerId}`,
          email: manager.email || null,
          phone: null,
          roles: toManagerRole(manager),
          lastLoginAt: null,
          createdAt: new Date(0),
          metrics: {
            ...buildMetrics(managerActiveLeads, [], [], managerCalls, {
            neutralizeLeadOutcomes: true,
            activityMetrics: managerActivity,
            incomeAmountOverride: salesMetrics.incomeAmount,
            manualDurationSeconds: corporateDurationByManager.get(managerId) || 0,
            }),
            salesCount: salesMetrics.newSalesCount,
            totalDealAmount: salesMetrics.newSalesAgreementAmount,
            averageDealAmount: salesMetrics.averageAgreementAmount,
            ...salesMetrics,
            newLeadsInRange: newLeadCount,
            conversionRate: listConversionRate,
            refundCount: refundsByManager.get(managerId) || 0,
            refundRate: salesMetrics.newSalesCount > 0
              ? Number((((refundsByManager.get(managerId) || 0) / salesMetrics.newSalesCount) * 100).toFixed(2))
              : 0,
            newCustomers: newCustomersByManager.get(managerId) || 0,
            repeatCustomers: repeatCustomersByManager.get(managerId) || 0,
            newCustomerRate: ((newCustomersByManager.get(managerId) || 0) + (repeatCustomersByManager.get(managerId) || 0)) > 0
              ? Number((((newCustomersByManager.get(managerId) || 0) / ((newCustomersByManager.get(managerId) || 0) + (repeatCustomersByManager.get(managerId) || 0))) * 100).toFixed(2))
              : 0,
            deadlineTotal: deadlineTotalByManager.get(managerId) || 0,
            deadlineMet: deadlineMetByManager.get(managerId) || 0,
            deadlineAdherenceRate: (deadlineTotalByManager.get(managerId) || 0) > 0
              ? Number((((deadlineMetByManager.get(managerId) || 0) / (deadlineTotalByManager.get(managerId) || 0)) * 100).toFixed(2))
              : 0,
            leadResponseTime: leadResponseTimeByManager.get(managerId) || { avgResponseSeconds: 0, medianResponseSeconds: 0, respondedCount: 0, totalCount: 0 },
          },
        };
      })
      .sort((a, b) => (
        (b.metrics.salesCount - a.metrics.salesCount)
        || (b.metrics.incomeAmount - a.metrics.incomeAmount)
        || (b.metrics.totalCallDuration - a.metrics.totalCallDuration)
        || a.name.localeCompare(b.name)
      ));

    timings.buildResponseMs = Date.now() - buildResponseStartedMs;
    timings.totalMs = Date.now() - startedAtMs;

    logger.info({
      tenantId: ctx.tenantId,
      userId: ctx.user.userId,
      managerCount: managers.length,
      selectedPipelineIds,
      activeLeadsCount: activeLeads.length,
      callsCount: calls.length,
      activityTotals: summarizeAmoCRMActivityMetrics(activityByManager),
      cacheHit: false,
      timings,
    }, 'Sellers list timings');

    sellersListCache.set(listCacheKey, {
      expiresAt: Date.now() + SELLERS_LIST_CACHE_TTL_MS,
      data: result,
    });

    return result;
  }),
};
