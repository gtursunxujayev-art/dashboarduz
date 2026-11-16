import { courseTypeCategorySchema, isAgentOnly } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { buildCategoryLabel, buildTechnicalSaleIdSetByAgreement } from '../../../services/course-sales/helpers';
import { buildActiveSaleChainMetrics, INCOME_LIFECYCLE_ACTIVE, type SaleChainSaleRow } from '../../../services/income-chain';
import { resolveSaleAgreementAmount, resolveSaleSubTariffId } from '../../../services/income-facts';
import { buildTariffBreakdown, type TariffBreakdownRow } from '../../../services/tariff-breakdown';
import { protectedProcedure } from '../../trpc';

export const courseSalesTypeSummaryProcedures = {
  typeSummary: protectedProcedure
    .input(
      z.object({
        category: courseTypeCategorySchema,
        courseId: z.string().uuid().optional(),
        tariffId: z.string().uuid().optional(),
        subTariffId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
      const categoryCourses = await ctx.db.course.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          category: input.category,
        },
        select: { id: true, name: true },
      });
      const categoryCourseIds = categoryCourses.map((course) => course.id);

      if (categoryCourseIds.length === 0) {
        return {
          category: input.category,
          categoryLabel: buildCategoryLabel(input.category),
          selectedCourseId: input.courseId || null,
          selectedTariffId: input.tariffId || null,
          selectedSubTariffId: input.subTariffId || null,
          totals: {
            soldCount: 0,
            fullyPaidCount: 0,
            debtorsCount: 0,
            agreementAmount: 0,
            paidAmount: 0,
            remainingDebtAmount: 0,
            customerCount: 0,
          },
          tariffBreakdown: [] as TariffBreakdownRow[],
          salesBreakdown: {
            newSalesCount: 0,
            movedInCount: 0,
            serviceExchangeCount: 0,
          },
          updatedAt: new Date().toISOString(),
        };
      }

      const scopedFilters: Record<string, unknown>[] = [];

      if (input.courseId) {
        if (!categoryCourseIds.includes(input.courseId)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: "Kurs tanlangan turga tegishli emas." });
        }
        scopedFilters.push({ courseId: input.courseId });
      } else {
        scopedFilters.push({ courseId: { in: categoryCourseIds } });
      }

      if (input.tariffId) {
        scopedFilters.push({ tariffId: input.tariffId });
      }

      const matchedSales = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          ...(scopedManagerUserId ? { managerUserId: scopedManagerUserId } : {}),
          ...(scopedFilters.length ? { AND: scopedFilters } : {}),
        },
        select: {
          id: true,
          entryDate: true,
          customerId: true,
          courseId: true,
          tariffId: true,
          coursePriceAmount: true,
          debtAmount: true,
          paymentAmount: true,
          remainingDebtAmount: true,
          legacyImportMeta: true,
          customer: {
            select: {
              profileCourseId: true,
              profileTariffId: true,
              profileSubTariffId: true,
            },
          },
          tariff: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      const salesWithResolvedSubTariff = matchedSales.map((sale) => ({
        ...sale,
        resolvedSubTariffId: resolveSaleSubTariffId(sale),
      }));
      const filteredSales = input.subTariffId
        ? salesWithResolvedSubTariff.filter((sale) => sale.resolvedSubTariffId === input.subTariffId)
        : salesWithResolvedSubTariff;
      const allChainMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: filteredSales as SaleChainSaleRow[],
        db: ctx.db,
      });
      const technicalSaleIds = buildTechnicalSaleIdSetByAgreement({
        sales: filteredSales,
        chainMetricsBySaleId: allChainMetricsBySaleId,
      });
      const filteredNonTechnicalSales = filteredSales.filter((sale) => !technicalSaleIds.has(sale.id));
      const nonTechnicalSaleIdSet = new Set(filteredNonTechnicalSales.map((sale) => sale.id));
      const nonTechnicalSaleCustomerById = new Map(filteredNonTechnicalSales.map((sale) => [sale.id, sale.customerId]));
      const chainMetricsBySaleId = new Map(
        Array.from(allChainMetricsBySaleId.entries()).filter(([saleId]) => nonTechnicalSaleIdSet.has(saleId)),
      );
      const technicalCustomerCount = new Set(
        filteredSales
          .filter((sale) => technicalSaleIds.has(sale.id))
          .map((sale) => sale.customerId),
      ).size;
      let movedInCount = 0;
      const movedInSaleIdSet = new Set<string>();

      if (nonTechnicalSaleIdSet.size > 0) {
        const [relinkLogs, tariffChangeRequests, saleUpdateLogs] = await Promise.all([
          ctx.db.auditLog.findMany({
            where: {
              tenantId: ctx.tenantId,
              action: { in: ['customer_course_relink', 'income_debug_destructive_relink'] },
            },
            select: {
              metadata: true,
            },
          }),
          ctx.db.incomeAdjustmentRequest.findMany({
            where: {
              tenantId: ctx.tenantId,
              type: 'tariff_change',
              status: 'approved',
              incomeId: { in: Array.from(nonTechnicalSaleIdSet) },
              ...(input.courseId ? { newCourseId: input.courseId } : {}),
              ...(input.tariffId ? { newTariffId: input.tariffId } : {}),
            },
            select: {
              incomeId: true,
              customerId: true,
            },
          }),
          ctx.db.auditLog.findMany({
            where: {
              tenantId: ctx.tenantId,
              action: 'customer_course_sale_update',
              resourceId: { in: Array.from(nonTechnicalSaleIdSet) },
            },
            select: {
              resourceId: true,
              metadata: true,
            },
          }),
        ]);
        const movedCustomerIds = new Set<string>();

        for (const log of relinkLogs) {
          const metadata = (log.metadata && typeof log.metadata === 'object')
            ? (log.metadata as Record<string, unknown>)
            : null;

          if (!metadata) {
            continue;
          }
          const targetSaleIncomeId = typeof metadata.targetSaleIncomeId === 'string'
            ? metadata.targetSaleIncomeId
            : '';

          if (!targetSaleIncomeId || !nonTechnicalSaleIdSet.has(targetSaleIncomeId)) {
            continue;
          }
          movedInSaleIdSet.add(targetSaleIncomeId);
          const customerId = typeof metadata.customerId === 'string'
            ? metadata.customerId
            : (nonTechnicalSaleCustomerById.get(targetSaleIncomeId) || '');

          if (customerId) {
            movedCustomerIds.add(customerId);
          }
        }
        for (const request of tariffChangeRequests) {
          movedInSaleIdSet.add(request.incomeId);
          movedCustomerIds.add(request.customerId);
        }
        for (const log of saleUpdateLogs) {
          const saleId = log.resourceId || '';
          const metadata = (log.metadata && typeof log.metadata === 'object')
            ? (log.metadata as Record<string, unknown>)
            : null;
          const newCourseId = typeof metadata?.newCourseId === 'string' ? metadata.newCourseId : '';
          const newTariffId = typeof metadata?.newTariffId === 'string' ? metadata.newTariffId : '';

          if (input.courseId && newCourseId && newCourseId !== input.courseId) {
            continue;
          }
          if (input.tariffId && newTariffId && newTariffId !== input.tariffId) {
            continue;
          }
          if (!saleId || !nonTechnicalSaleIdSet.has(saleId)) {
            continue;
          }
          movedInSaleIdSet.add(saleId);
          const customerId = nonTechnicalSaleCustomerById.get(saleId) || '';

          if (customerId) {
            movedCustomerIds.add(customerId);
          }
        }
        movedInCount = movedCustomerIds.size;
      }
      const directNewSalesCount = filteredNonTechnicalSales.filter((sale) => !movedInSaleIdSet.has(sale.id)).length;

      let agreementAmount = 0;
      let remainingDebtAmount = 0;
      let paidAmount = 0;
      let fullyPaidCount = 0;
      let debtorsCount = 0;

      for (const sale of filteredNonTechnicalSales) {
        const metric = chainMetricsBySaleId.get(sale.id);
        const agreement = metric?.agreementAmount ?? resolveSaleAgreementAmount(sale);
        const debt = metric?.currentDebtAmount ?? (sale.remainingDebtAmount ?? 0);
        const paid = metric?.paidAmount ?? (sale.paymentAmount ?? 0);

        agreementAmount += agreement;
        remainingDebtAmount += debt;
        paidAmount += paid;
        if (debt <= 0) {
          fullyPaidCount += 1;
        } else {
          debtorsCount += 1;
        }
      }

      const breakdownSubTariffIds = Array.from(new Set(
        filteredNonTechnicalSales.map((sale) => sale.resolvedSubTariffId).filter((id): id is string => Boolean(id)),
      ));
      const [breakdownSubTariffs, selectedCourseTariffs] = await Promise.all([
        breakdownSubTariffIds.length
          ? ctx.db.subTariff.findMany({ where: { tenantId: ctx.tenantId, id: { in: breakdownSubTariffIds } }, select: { id: true, name: true } })
          : Promise.resolve([] as Array<{ id: string; name: string }>),
        input.courseId && !input.tariffId
          ? ctx.db.tariff.findMany({
              where: { tenantId: ctx.tenantId, courseId: input.courseId, isActive: true },
              orderBy: { name: 'asc' },
              select: { id: true, name: true },
            })
          : Promise.resolve([] as Array<{ id: string; name: string }>),
      ]);
      const tariffBreakdown = buildTariffBreakdown({
        sales: filteredNonTechnicalSales,
        subTariffNameById: new Map(breakdownSubTariffs.map((subTariff) => [subTariff.id, subTariff.name])),
        knownTariffs: selectedCourseTariffs,
      });

      return {
        category: input.category,
        categoryLabel: buildCategoryLabel(input.category),
        selectedCourseId: input.courseId || null,
        selectedTariffId: input.tariffId || null,
        selectedSubTariffId: input.subTariffId || null,
        totals: {
          soldCount: filteredNonTechnicalSales.length,
          fullyPaidCount,
          debtorsCount,
          agreementAmount,
          paidAmount,
          remainingDebtAmount,
          customerCount: new Set(filteredNonTechnicalSales.map((sale) => sale.customerId)).size,
        },
        tariffBreakdown,
        salesBreakdown: {
          newSalesCount: directNewSalesCount,
          movedInCount,
          serviceExchangeCount: technicalCustomerCount,
        },
        updatedAt: new Date().toISOString(),
      };
    }),
};
