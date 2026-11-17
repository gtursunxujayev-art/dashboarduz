import { dateRangeInput, sellerRangeSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getAgentResponsibleScope } from '../../../lib/access';
import { resolveDateRange } from '../../../lib/dates';
import { resolveTelegramBotTokenForTenant } from '../../../lib/telegram';
import { countedCallsWhere } from '../../../services/calls-source';
import { getCorporateCallDurationByManager } from '../../../services/corporate-call-durations';
import { getAmoCRMActivityMetrics } from '../../../services/integrations/amocrm-activity';
import { getTenantAmoCRMContext } from '../../../services/integrations/amocrm-live';
import { telegramService } from '../../../services/integrations/telegram';
import { fetchLeadsByStatusFilters, loadSellerPipelineContext } from '../../../services/sellers/leads';
import { asString, buildMetrics, excludeTechnicalSellerIncomes, getManagerUserIdsMap, summarizeSellerIncomeMetrics, toManagerRole } from '../../../services/sellers/metrics';
import { buildSellerReportPdf, type SellerReportPayload } from '../../../services/sellers/report-pdf';
import { protectedProcedure } from '../../trpc';

export const sellerReportProcedures = {
  sendPdfToAdmins: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        range: sellerRangeSchema.default('last30days'),
        ...dateRangeInput.shape,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);

      if (scope.isScoped && input.id !== scope.responsibleUserId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const botToken = await resolveTelegramBotTokenForTenant(ctx.tenantId, ctx.db);

      if (!botToken) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Telegram bot token topilmadi.' });
      }

      const [amoContext, adminUsers] = await Promise.all([
        getTenantAmoCRMContext(ctx.tenantId, ctx.db),
        ctx.db.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            roles: { has: 'Admin' },
            telegramId: { not: null },
          },
          select: {
            telegramId: true,
            name: true,
          },
        }),
      ]);

      if (!amoContext) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AmoCRM integration is not connected.',
        });
      }

      const adminChatIds = adminUsers
        .map((user) => String(user.telegramId || '').trim())
        .filter(Boolean);

      if (!adminChatIds.length) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Telegram chat id bilan admin topilmadi.' });
      }

      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);

      const { amocrmUsers, selectedPipelineIds, activeStatusFilters } = await loadSellerPipelineContext(ctx.tenantId, amoContext, ctx.db);

      const sellerUser = amocrmUsers.find((user) => asString(user.id) === input.id);

      if (!sellerUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const [activeLeads, userIdsByManager, mappedUsers] = await Promise.all([
        fetchLeadsByStatusFilters(
          ctx.tenantId,
          ctx.db,
          amoContext,
          selectedPipelineIds,
          activeStatusFilters,
          [input.id],
          rangeStart,
          rangeEnd,
        ),
        getManagerUserIdsMap(ctx.tenantId, [input.id], ctx.db),
        ctx.db.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            amocrmResponsibleUserId: input.id,
          },
          select: { id: true },
        }),
      ]);

      const managerUserIds = userIdsByManager.get(input.id) || [];
      const [callsForMetrics, sellerIncomesRaw, activityMetricsMap] = await Promise.all([
        managerUserIds.length > 0
          ? ctx.db.call.findMany({
              where: {
                ...countedCallsWhere(ctx.tenantId, managerUserIds),
                startedAt: {
                  gte: rangeStart,
                  lte: rangeEnd,
                },
              },
              select: {
                duration: true,
                status: true,
                direction: true,
                startedAt: true,
              },
            })
          : Promise.resolve([]),
        mappedUsers.length > 0
          ? ctx.db.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: 'active',
                managerUserId: { in: mappedUsers.map((row) => row.id) },
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
          : Promise.resolve([]),
        getAmoCRMActivityMetrics({
          db: ctx.db,
          tenantId: ctx.tenantId,
          accessToken: amoContext.accessToken,
          baseUrl: amoContext.baseUrl,
          managerIds: [input.id],
          rangeStart,
          rangeEnd,
          rangeKind: input.range === 'last30days' ? 'custom' : input.range,
        }),
      ]);
      const sellerIncomes = await excludeTechnicalSellerIncomes(ctx.tenantId, sellerIncomesRaw, ctx.db);
      const corporateDurationByUserId = await getCorporateCallDurationByManager({
        tenantId: ctx.tenantId,
        managerUserIds: mappedUsers.map((row) => row.id),
        rangeStart,
        rangeEnd,
        db: ctx.db,
      });
      const manualDurationSeconds = Array.from(corporateDurationByUserId.values())
        .reduce((sum, value) => sum + value, 0);

      const salesMetrics = summarizeSellerIncomeMetrics(sellerIncomes, rangeStart, rangeEnd);
      const activityMetrics = activityMetricsMap.get(input.id) || null;
      const baseMetrics = buildMetrics(
        activeLeads,
        [],
        [],
        (callsForMetrics as Array<{ duration: number | null; direction: string; status: string; startedAt: Date | null }>).map((call) => ({
          duration: call.duration,
          direction: call.direction,
          status: call.status,
          startedAt: call.startedAt,
        })),
        {
          neutralizeLeadOutcomes: true,
          incomeAmountOverride: salesMetrics.incomeAmount,
          activityMetrics,
          manualDurationSeconds,
        },
      );

      const payload: SellerReportPayload = {
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
          ...baseMetrics,
          salesCount: salesMetrics.newSalesCount,
          totalDealAmount: salesMetrics.newSalesAgreementAmount,
          averageDealAmount: salesMetrics.averageAgreementAmount,
          ...salesMetrics,
        },
        rangeStart,
        rangeEnd,
      };

      const pdfBuffer = buildSellerReportPdf(payload);
      const safeName = payload.seller.name.replace(/[^a-zA-Z0-9-_]+/g, '-');
      const fileName = `seller-report-${safeName || input.id}.pdf`;
      const caption = `${payload.seller.name} hisobot PDF`;

      for (const chatId of adminChatIds) {
        await telegramService.sendDocument(botToken, chatId, pdfBuffer, fileName, caption);
      }

      return {
        success: true,
        recipientCount: adminChatIds.length,
      };
    }),
};
