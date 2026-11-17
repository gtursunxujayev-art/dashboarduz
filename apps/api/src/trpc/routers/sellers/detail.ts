import { sellerRangeSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getAgentResponsibleScope } from '../../../lib/access';
import { resolveDateRange } from '../../../lib/dates';
import { getCallsProvider } from '../../../services/calls-source';
import { getCorporateCallDurationByManager } from '../../../services/corporate-call-durations';
import { getAmoCRMActivityMetrics } from '../../../services/integrations/amocrm-activity';
import { getAmoReference } from '../../../services/integrations/amocrm-activity-snapshot-read';
import { fetchSnapshotLeads } from '../../../services/integrations/amocrm-lead-snapshot-read';
import { getTenantAmoCRMContext } from '../../../services/integrations/amocrm-live';
import { buildStatusFilters, computeLeadResponseTimes, fetchLeadsByStatusFilters, getSelectedPipelines } from '../../../services/sellers/leads';
import { asString, buildMetrics, excludeTechnicalSellerIncomes, getManagerExtensionsMap, LOST_STATUS_ID, parseAmoDate, summarizeSellerIncomeMetrics, toManagerRole, WON_STATUS_ID } from '../../../services/sellers/metrics';
import { protectedProcedure } from '../../trpc';

export const sellerDetailProcedures = {
  getById: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        range: sellerRangeSchema.default('today'),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);

      if (scope.isScoped && input.id !== scope.responsibleUserId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);

      const amoContext = await getTenantAmoCRMContext(ctx.tenantId, ctx.db);

      if (!amoContext) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AmoCRM integration is not connected.',
        });
      }

      const [amocrmUsers, pipelinesResponse] = await Promise.all([
        getAmoReference(ctx.tenantId, 'users', amoContext, ctx.db),
        getAmoReference(ctx.tenantId, 'pipelines', amoContext, ctx.db),
      ]);
      const pipelines = Array.isArray(pipelinesResponse._embedded?.pipelines) ? pipelinesResponse._embedded.pipelines : [];
      const selectedPipelineIds = getSelectedPipelines(amoContext.selectedPipelineIds, pipelines);

      const activeStatusFilters = buildStatusFilters(
        selectedPipelineIds,
        pipelines,
        pipelines
          .flatMap((pipeline) => (Array.isArray(pipeline._embedded?.statuses) ? pipeline._embedded.statuses : []))
          .map((status) => asString(status.id))
          .filter((statusId): statusId is string => Boolean(statusId) && statusId !== WON_STATUS_ID && statusId !== LOST_STATUS_ID),
      );
      const wonStatusFilters = buildStatusFilters(selectedPipelineIds, pipelines, [WON_STATUS_ID]);
      const lostStatusFilters = buildStatusFilters(selectedPipelineIds, pipelines, [LOST_STATUS_ID]);

      const [activeLeads, wonLeads, lostLeads] = await Promise.all([
        fetchLeadsByStatusFilters(
          ctx.tenantId,
          ctx.db,
          selectedPipelineIds,
          activeStatusFilters,
          [input.id],
          rangeStart,
          rangeEnd,
        ),
        fetchLeadsByStatusFilters(
          ctx.tenantId,
          ctx.db,
          selectedPipelineIds,
          wonStatusFilters,
          [input.id],
          rangeStart,
          rangeEnd,
        ),
        fetchLeadsByStatusFilters(
          ctx.tenantId,
          ctx.db,
          selectedPipelineIds,
          lostStatusFilters,
          [input.id],
          rangeStart,
          rangeEnd,
        ),
      ]);

      const sellerUser = amocrmUsers.find((user) => asString(user.id) === input.id);

      if (!sellerUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const extensionsByManager = await getManagerExtensionsMap(ctx.tenantId, [input.id], ctx.db);
      const extensions = extensionsByManager.get(input.id) || [];

      const callsForMetrics = extensions.length > 0
        ? await ctx.db.call.findMany({
            where: {
              tenantId: ctx.tenantId,
              provider: await getCallsProvider(ctx.tenantId, ctx.db),
              startedAt: {
                gte: rangeStart,
                lte: rangeEnd,
              },
              OR: [
                { from: { in: extensions } },
                { to: { in: extensions } },
              ],
            },
            select: {
              duration: true,
              status: true,
              direction: true,
              startedAt: true,
            },
          })
      : [];

      const recentCalls = extensions.length > 0
        ? await ctx.db.call.findMany({
            where: {
              tenantId: ctx.tenantId,
              provider: await getCallsProvider(ctx.tenantId, ctx.db),
              startedAt: {
                gte: rangeStart,
                lte: rangeEnd,
              },
              OR: [
                { from: { in: extensions } },
                { to: { in: extensions } },
              ],
            },
            select: {
              id: true,
              from: true,
              to: true,
              duration: true,
              status: true,
              direction: true,
              startedAt: true,
            },
            orderBy: {
              startedAt: 'desc',
            },
            take: 50,
          })
        : [];

      let mappedManagerUserIds: string[] = [];

      mappedManagerUserIds = (
        await ctx.db.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            amocrmResponsibleUserId: input.id,
          },
          select: { id: true },
        })
      ).map((user) => user.id);

      const [sellerIncomesRaw, detailRefundRequests, detailIncomesWithCustomer, detailIncomesWithDeadline] = await Promise.all([
        mappedManagerUserIds.length > 0
          ? ctx.db.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: 'active',
                managerUserId: { in: mappedManagerUserIds },
                entryDate: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
              },
              select: {
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
            })
          : [],
        mappedManagerUserIds.length > 0
          ? ctx.db.incomeAdjustmentRequest.findMany({
              where: {
                tenantId: ctx.tenantId,
                type: 'refund',
                status: 'approved',
                createdAt: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
                income: {
                  managerUserId: { in: mappedManagerUserIds },
                },
              },
              select: { id: true },
            })
          : [],
        mappedManagerUserIds.length > 0
          ? ctx.db.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: 'active',
                type: 'new_sale',
                managerUserId: { in: mappedManagerUserIds },
                entryDate: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
              },
              select: { customerId: true },
            })
          : [],
        mappedManagerUserIds.length > 0
          ? ctx.db.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: 'active',
                managerUserId: { in: mappedManagerUserIds },
                entryDate: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
                deadline: { not: null },
              },
              select: {
                entryDate: true,
                deadline: true,
                paymentAmount: true,
                remainingDebtAmount: true,
              },
            })
          : [],
      ]);
      const sellerIncomes = await excludeTechnicalSellerIncomes(ctx.tenantId, sellerIncomesRaw, ctx.db);
      const [corporateDurationByUserId, newLeadsForManager, activityMetricsMap] = await Promise.all([
        getCorporateCallDurationByManager({
          tenantId: ctx.tenantId,
          managerUserIds: mappedManagerUserIds,
          rangeStart,
          rangeEnd,
          db: ctx.db,
        }),
        fetchSnapshotLeads(
          ctx.tenantId,
          {
            pipelineIds: selectedPipelineIds,
            responsibleUserIds: [input.id],
            createdAtFrom: rangeStart,
            createdAtTo: rangeEnd,
          },
          ctx.db,
        ),
        getAmoCRMActivityMetrics({
          tenantId: ctx.tenantId,
          accessToken: amoContext.accessToken,
          baseUrl: amoContext.baseUrl,
          managerIds: [input.id],
          rangeStart,
          rangeEnd,
          rangeKind: input.range === 'last30days' ? 'custom' : input.range,
        }),
      ]);
      // Start lead response time (runs while we build metrics below)
      const detailLeadResponsePromise = computeLeadResponseTimes({
        tenantId: ctx.tenantId,
        db: ctx.db,
        managerIds: [input.id],
        newLeads: newLeadsForManager,
        rangeStart,
        rangeEnd,
      });
      const manualDurationSeconds = Array.from(corporateDurationByUserId.values())
        .reduce((sum, value) => sum + value, 0);
      const salesMetrics = summarizeSellerIncomeMetrics(sellerIncomes, rangeStart, rangeEnd);
      const activityMetrics = activityMetricsMap.get(input.id) || null;

      const metrics = buildMetrics(
        activeLeads,
        wonLeads,
        lostLeads,
        (callsForMetrics as Array<{ duration: number | null; direction: string; status: string; startedAt: Date | null }>).map((call) => ({
          duration: call.duration,
          direction: call.direction,
          status: call.status,
          startedAt: call.startedAt,
        })),
        {
          incomeAmountOverride: salesMetrics.incomeAmount,
          activityMetrics,
          manualDurationSeconds,
        },
      );

      const recentLeads = activeLeads
        .slice()
        .sort((a, b) => parseAmoDate(b.created_at).getTime() - parseAmoDate(a.created_at).getTime())
        .slice(0, 50)
        .map((lead) => {
          const firstContact = Array.isArray(lead._embedded?.contacts) ? lead._embedded?.contacts[0] : null;
          const contact = firstContact && typeof firstContact === 'object'
            ? {
                name: asString((firstContact).name),
                phone: null,
                email: null,
              }
            : null;

          return {
            id: asString(lead.id) || '',
            title: lead.name || 'Untitled lead',
            status: asString(lead.status_id),
            metadata: lead,
            createdAt: parseAmoDate(lead.created_at),
            updatedAt: parseAmoDate(lead.updated_at),
            contact,
          };
        });

      const detailNewLeadCount = newLeadsForManager.length;
      const detailConversionRate = detailNewLeadCount > 0
        ? Number(((salesMetrics.newSalesCount / detailNewLeadCount) * 100).toFixed(2))
        : 0;

      // Refund rate
      const detailRefundCount = detailRefundRequests.length;
      const detailRefundRate = salesMetrics.newSalesCount > 0
        ? Number(((detailRefundCount / salesMetrics.newSalesCount) * 100).toFixed(2))
        : 0;

      // New vs repeat customers
      const detailCustomerIds = [...new Set(detailIncomesWithCustomer.map((i) => i.customerId))];
      let detailNewCustomers = 0;
      let detailRepeatCustomers = 0;

      if (detailCustomerIds.length > 0) {
        const detailPriorCustomers = await ctx.db.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            lifecycleStatus: 'active',
            customerId: { in: detailCustomerIds },
            entryDate: { lt: rangeStart },
          },
          select: { customerId: true },
          distinct: ['customerId'],
        });
        const detailRepeatSet = new Set(detailPriorCustomers.map((p) => p.customerId));

        for (const cid of detailCustomerIds) {
          if (detailRepeatSet.has(cid)) {
            detailRepeatCustomers++;
          } else {
            detailNewCustomers++;
          }
        }
      }
      const detailTotalCustomers = detailNewCustomers + detailRepeatCustomers;
      const detailNewCustomerRate = detailTotalCustomers > 0
        ? Number(((detailNewCustomers / detailTotalCustomers) * 100).toFixed(2))
        : 0;

      // Payment deadline adherence
      let detailDeadlineTotal = 0;
      let detailDeadlineMet = 0;

      for (const inc of detailIncomesWithDeadline) {
        if (!inc.deadline) continue;
        detailDeadlineTotal++;
        if (inc.remainingDebtAmount <= 0 || inc.entryDate <= inc.deadline) {
          detailDeadlineMet++;
        }
      }
      const detailDeadlineAdherenceRate = detailDeadlineTotal > 0
        ? Number(((detailDeadlineMet / detailDeadlineTotal) * 100).toFixed(2))
        : 0;

      const detailLeadResponseMap = await detailLeadResponsePromise;
      const detailLeadResponseTime = detailLeadResponseMap.get(input.id) || { avgResponseSeconds: 0, medianResponseSeconds: 0, respondedCount: 0, totalCount: 0 };

      return {
        seller: {
          id: input.id,
          name: sellerUser.name || sellerUser.login || `Manager ${input.id}`,
          email: sellerUser.email || null,
          phone: null,
          roles: toManagerRole(sellerUser),
          lastLoginAt: null,
          createdAt: new Date(0),
        },
        metrics: {
          ...metrics,
          salesCount: salesMetrics.newSalesCount,
          totalDealAmount: salesMetrics.newSalesAgreementAmount,
          averageDealAmount: salesMetrics.averageAgreementAmount,
          ...salesMetrics,
          newLeadsInRange: detailNewLeadCount,
          conversionRate: detailConversionRate,
          refundCount: detailRefundCount,
          refundRate: detailRefundRate,
          newCustomers: detailNewCustomers,
          repeatCustomers: detailRepeatCustomers,
          newCustomerRate: detailNewCustomerRate,
          deadlineTotal: detailDeadlineTotal,
          deadlineMet: detailDeadlineMet,
          deadlineAdherenceRate: detailDeadlineAdherenceRate,
          leadResponseTime: detailLeadResponseTime,
        },
        recentLeads,
        recentCalls,
        period: {
          range: input.range,
          dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
          dateTo: input.range === 'custom' ? input.dateTo || null : null,
          rangeStart,
          rangeEnd,
        },
      };
    }),
};
