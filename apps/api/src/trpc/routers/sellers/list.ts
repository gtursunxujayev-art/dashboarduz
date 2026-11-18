import type { DbClient } from '@dashboarduz/db';
import { dateRangeInput, sellerRangeSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getAgentResponsibleScope } from '../../../lib/access';
import { resolveDateRange } from '../../../lib/dates';
import { logger } from '../../../lib/logger';
import { countedCallsWhere } from '../../../services/calls-source';
import { getCorporateCallDurationByManager } from '../../../services/corporate-call-durations';
import { getAmoCRMActivityMetrics, summarizeAmoCRMActivityMetrics } from '../../../services/integrations/amocrm-activity';
import { getAmoReference } from '../../../services/integrations/amocrm-activity-snapshot-read';
import { getAmoLeads } from '../../../services/integrations/amocrm-lead-snapshot-read';
import { getTenantAmoCRMContext } from '../../../services/integrations/amocrm-live';
import { computeLeadResponseTimes, getSelectedPipelines } from '../../../services/sellers/leads';
import { buildSellersListCacheKey, SELLERS_ACTIVITY_CACHE_TTL_MS, SELLERS_LIST_CACHE_TTL_MS, sellersListCache } from '../../../services/sellers/list-cache';
import { buildSellerListRow, compareSellerListRows, countByManager, countDeadlineAdherence, countNewAndRepeatCustomers, groupCallsByManager, groupLeadsByManager, groupSellerIncomesByManager, managerIdByMappedUserId, sumByManager } from '../../../services/sellers/list-rows';
import { asString, excludeTechnicalSellerIncomes, getManagerUserIdsMap, LOST_STATUS_ID, WON_STATUS_ID } from '../../../services/sellers/metrics';
import { protectedProcedure } from '../../trpc';

type SellerPeriod = { db: DbClient; tenantId: string; rangeStart: Date; rangeEnd: Date };

/**
 * The period's incomes of the mapped users (technical sales removed), approved refund requests, new sales with
 * their customer (for new vs repeat customers) and incomes with a payment deadline.
 */
async function loadSellerIncomeRows(period: SellerPeriod, userIds: string[]) {
  const { db, tenantId, rangeStart, rangeEnd } = period;
  const entryDate = { gte: rangeStart, lte: rangeEnd };
  const [incomesRaw, refundRequests, incomesWithCustomer, incomesWithDeadline] = userIds.length > 0
    ? await Promise.all([
        db.income.findMany({
          where: { tenantId, lifecycleStatus: 'active', managerUserId: { in: userIds }, entryDate },
          select: {
            managerUserId: true,
            type: true,
            paymentAmount: true,
            coursePriceAmount: true,
            debtAmount: true,
            id: true,
            relatedDebtIncomeId: true,
            course: { select: { category: true, name: true } },
          },
        }),
        db.incomeAdjustmentRequest.findMany({
          where: { tenantId, type: 'refund', status: 'approved', createdAt: entryDate, income: { managerUserId: { in: userIds } } },
          select: { income: { select: { managerUserId: true } } },
        }),
        db.income.findMany({
          where: { tenantId, lifecycleStatus: 'active', type: 'new_sale', managerUserId: { in: userIds }, entryDate },
          select: { managerUserId: true, customerId: true },
        }),
        db.income.findMany({
          where: { tenantId, lifecycleStatus: 'active', managerUserId: { in: userIds }, entryDate, deadline: { not: null } },
          select: { managerUserId: true, entryDate: true, deadline: true, paymentAmount: true, remainingDebtAmount: true },
        }),
      ])
    : [[], [], [], []];

  return {
    incomes: await excludeTechnicalSellerIncomes(tenantId, incomesRaw, db),
    refundRequests,
    incomesWithCustomer,
    incomesWithDeadline,
  };
}

/** Customers among `customerIds` who bought before the period. */
async function loadRepeatCustomerIds(period: SellerPeriod, customerIds: string[]): Promise<Set<string>> {
  const repeatCustomerIds = new Set<string>();

  if (customerIds.length > 0) {
    const priorIncomes = await period.db.income.findMany({
      where: { tenantId: period.tenantId, lifecycleStatus: 'active', customerId: { in: customerIds }, entryDate: { lt: period.rangeStart } },
      select: { customerId: true },
      distinct: ['customerId'],
    });

    for (const prior of priorIncomes) {
      repeatCustomerIds.add(prior.customerId);
    }
  }

  return repeatCustomerIds;
}

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
      const period: SellerPeriod = { db: ctx.db, tenantId: ctx.tenantId, rangeStart, rangeEnd };
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
      const timed = async <T>(key: string, work: Promise<T>): Promise<T> => {
        const stepStartedMs = Date.now();
        const result = await work;

        timings[key] = Date.now() - stepStartedMs;

        return result;
      };

      timings.scopeMs = Date.now() - startedAtMs;

      const amoContext = await timed('amoContextMs', getTenantAmoCRMContext(ctx.tenantId, ctx.db));

      if (!amoContext) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AmoCRM integration is not connected.',
        });
      }

      const [amocrmUsers, pipelinesResponse] = await Promise.all([
        timed('amocrmUsersMs', getAmoReference(ctx.tenantId, 'users', amoContext, ctx.db)),
        timed('amocrmPipelinesMs', getAmoReference(ctx.tenantId, 'pipelines', amoContext, ctx.db)),
      ]);
      const pipelines = Array.isArray(pipelinesResponse._embedded?.pipelines) ? pipelinesResponse._embedded.pipelines : [];
      const selectedPipelineIds = getSelectedPipelines(amoContext.selectedPipelineIds, pipelines);

      const managerPreparationStartedMs = Date.now();
      const managers = amocrmUsers
        .filter((user) => user.is_active !== false)
        .filter((user) => !scope.isScoped || asString(user.id) === scope.responsibleUserId);
      const managerIds = new Set(managers.map((manager) => asString(manager.id)).filter((id): id is string => Boolean(id)));

      timings.managerPreparationMs = Date.now() - managerPreparationStartedMs;

      const managerIdList = Array.from(managerIds);
      const corporateRevision = await ctx.db.corporateCallDuration.aggregate({
        where: { tenantId: ctx.tenantId },
        _max: { updatedAt: true },
      });
      const listCacheKey = buildSellersListCacheKey(
        ctx.tenantId,
        scope.isScoped ? (scope.responsibleUserId || '__unmapped__') : null,
        selectedPipelineIds,
        range,
        corporateRevision._max.updatedAt ? corporateRevision._max.updatedAt.toISOString() : '',
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
      const leadQuery = { pipelineIds: selectedPipelineIds, responsibleUserIds: managerIdList };
      const roundedNow = new Date(Math.floor(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000));
      const [activeLeads, newLeadsInRange, activityByManager, managerUserIdsByAmoId] = await Promise.all([
        getAmoLeads(ctx.tenantId, leadQuery, amoContext, ctx.db).then((leads) => leads.filter((lead) => {
          const statusId = asString(lead.status_id);

          return statusId !== WON_STATUS_ID && statusId !== LOST_STATUS_ID;
        })),
        getAmoLeads(ctx.tenantId, { ...leadQuery, createdAtFrom: rangeStart, createdAtTo: rangeEnd }, amoContext, ctx.db),
        timed('activityFetchMs', getAmoCRMActivityMetrics({
          db: ctx.db,
          tenantId: ctx.tenantId,
          accessToken: amoContext.accessToken,
          baseUrl: amoContext.baseUrl,
          managerIds: managerIdList,
          rangeStart,
          rangeEnd: roundedNow < rangeEnd ? roundedNow : rangeEnd,
          rangeKind: range === 'today' ? 'today' : (range === 'last30days' ? 'month' : range),
          cacheTtlMs: SELLERS_ACTIVITY_CACHE_TTL_MS,
        })),
        timed('userMappingMs', getManagerUserIdsMap(ctx.tenantId, managerIdList, ctx.db)),
      ]);

      timings.amocrmLeadsMs = Date.now() - leadsFetchStartedMs;

      // Lead response times are computed in parallel with the rest (they do not block other work).
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
      const activeLeadsByManager = groupLeadsByManager(activeLeads, managerIds);
      const newLeadsByManager = groupLeadsByManager(newLeadsInRange, managerIds);

      timings.leadsGroupingMs = Date.now() - leadsGroupingStartedMs;

      const mappedUserIds = Array.from(managerUserIdsByAmoId.values()).flat();
      const calls = await timed('callsFetchMs', mappedUserIds.length > 0
        ? ctx.db.call.findMany({
            where: { ...countedCallsWhere(ctx.tenantId, mappedUserIds), startedAt: { gte: rangeStart, lte: rangeEnd } },
            select: { managerUserId: true, duration: true, direction: true, status: true, startedAt: true },
          })
        : Promise.resolve([]));
      const incomeRows = await timed('incomeFetchMs', loadSellerIncomeRows(period, Array.from(new Set(mappedUserIds))));
      const managerIdByUserId = managerIdByMappedUserId(managerUserIdsByAmoId);

      const callsGroupingStartedMs = Date.now();
      const callsByManager = groupCallsByManager(calls, managerIdByUserId);

      timings.callsGroupingMs = Date.now() - callsGroupingStartedMs;

      const incomeGroupingStartedMs = Date.now();
      const corporateDurationByUserId = await getCorporateCallDurationByManager({
        tenantId: ctx.tenantId,
        managerUserIds: Array.from(managerIdByUserId.keys()),
        rangeStart,
        rangeEnd,
        db: ctx.db,
      });
      const repeatCustomerIds = await loadRepeatCustomerIds(period, [...new Set(incomeRows.incomesWithCustomer.map((income) => income.customerId))]);
      const customers = countNewAndRepeatCustomers(incomeRows.incomesWithCustomer, repeatCustomerIds, managerIdByUserId);
      const deadlines = countDeadlineAdherence(incomeRows.incomesWithDeadline, managerIdByUserId);
      const sources = {
        rangeStart,
        rangeEnd,
        activeLeadsByManager,
        newLeadsByManager,
        callsByManager,
        activityByManager,
        incomesByManager: groupSellerIncomesByManager(incomeRows.incomes, managerIdByUserId),
        corporateDurationByManager: sumByManager(corporateDurationByUserId, managerIdByUserId),
        refundsByManager: countByManager(incomeRows.refundRequests.map((request) => request.income.managerUserId), managerIdByUserId),
        ...customers,
        ...deadlines,
      };

      timings.incomeGroupingMs = Date.now() - incomeGroupingStartedMs;

      const leadResponseTimeByManager = await leadResponseTimePromise;
      const buildResponseStartedMs = Date.now();
      const result = managers
        .map((manager) => buildSellerListRow(manager, { ...sources, leadResponseTimeByManager }))
        .sort(compareSellerListRows);

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
