import { reportRangeSchema } from '@dashboarduz/shared';

import { getAgentResponsibleScope } from '../../../lib/access';
import { resolveDateRange } from '../../../lib/dates';
import { loadActiveCourseCatalog } from '../../../services/course-sales/catalog';
import { INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { buildTechnicalSaleIdSet, resolveSaleAgreementAmount, resolveSaleSubTariffId } from '../../../services/income-facts';

import { z, protectedProcedure, } from './helpers';

export const widgetProcedures = {
  widgetCatalogOptions: protectedProcedure.query(async ({ ctx }) => ({
    courses: await loadActiveCourseCatalog({ db: ctx.db, tenantId: ctx.tenantId }),
  })),

  customSalesWidgets: protectedProcedure
    .input(
      z.object({
        range: reportRangeSchema,
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        widgets: z
          .array(
            z.object({
              id: z.string().min(1).max(120),
              courseId: z.string().uuid(),
              tariffId: z.string().uuid().nullable().optional(),
              subTariffId: z.string().uuid().nullable().optional(),
            }),
          )
          .max(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!input.widgets.length) {
        return { widgets: [] as Array<{ id: string; salesCount: number; agreementAmount: number }> };
      }

      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);

      const widgetCourseIds = Array.from(new Set(input.widgets.map((widget) => widget.courseId)));
      const salesRaw = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: {
            gte: rangeStart,
            lte: rangeEnd,
          },
          courseId: { in: widgetCourseIds },
          ...(scope.isScoped
            ? {
                managerUserId: ctx.user.userId,
              }
            : {}),
        },
        select: {
          id: true,
          type: true,
          courseId: true,
          tariffId: true,
          paymentAmount: true,
          coursePriceAmount: true,
          debtAmount: true,
          legacyImportMeta: true,
          customer: {
            select: {
              profileCourseId: true,
              profileTariffId: true,
              profileSubTariffId: true,
            },
          },
        },
      });
      // Per-row sums with the shared agreement formula; technical (agreement == 1) sales are not real sales.
      const technicalSaleIds = buildTechnicalSaleIdSet(salesRaw);
      const sales = salesRaw.filter((sale) => !technicalSaleIds.has(sale.id));

      const widgets = input.widgets.map((widget) => {
        // A widget without a tariff covers the whole course; without a sub-tariff, every sub-tariff.
        const matching = sales.filter((sale) => (
          sale.courseId === widget.courseId
          && (!widget.tariffId || sale.tariffId === widget.tariffId)
          && (!widget.subTariffId || resolveSaleSubTariffId(sale) === widget.subTariffId)
        ));

        return {
          id: widget.id,
          salesCount: matching.length,
          agreementAmount: matching.reduce((sum, sale) => sum + resolveSaleAgreementAmount(sale), 0),
        };
      });

      return { widgets };
    }),
};
