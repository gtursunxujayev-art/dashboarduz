import { dateRangeInput, isAgentOnly, reportRangeSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveDateRange } from '../../../lib/dates';
import { ACTIVE_TARIFFS_WITH_SUB_TARIFFS_SELECT, describeCourse } from '../../../services/course-sales/catalog';
import { activeSalesWhere, buildCourseSaleFilters, echoReportRange, loadSalePaymentTotals, splitTechnicalSales } from '../../../services/course-sales/queries';
import { extractSaleSubTariffId } from '../../../services/income-chain';
import { resolveSaleAgreementAmount } from '../../../services/income-facts';
import { protectedProcedure } from '../../trpc';

export const courseSalesSummaryProcedures = {
  summary: protectedProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        tariffId: z.string().uuid().optional(),
        subTariffId: z.string().uuid().optional(),
        range: reportRangeSchema,
        ...dateRangeInput.shape,
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
      const scopedFilters = await buildCourseSaleFilters({
        db: ctx.db,
        tenantId: ctx.tenantId,
        courseId: input.courseId,
        tariffId: input.tariffId,
        subTariffId: input.subTariffId,
      });

      const [course, matchedSales, profileSubTariffs] = await Promise.all([
        ctx.db.course.findFirst({
          where: {
            tenantId: ctx.tenantId,
            id: input.courseId,
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            category: true,
            tariffs: ACTIVE_TARIFFS_WITH_SUB_TARIFFS_SELECT,
          },
        }),
        ctx.db.income.findMany({
          where: activeSalesWhere({ tenantId: ctx.tenantId, scopedManagerUserId, filters: scopedFilters }),
          select: {
            id: true,
            customerId: true,
            tariffId: true,
            coursePriceAmount: true,
            debtAmount: true,
            paymentAmount: true,
            remainingDebtAmount: true,
            entryDate: true,
            customer: {
              select: {
                profileCourseId: true,
                profileTariffId: true,
                profileSubTariffId: true,
              },
            },
            legacyImportMeta: true,
          },
        }),
        input.subTariffId
          ? ctx.db.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                id: input.subTariffId,
              },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi.' });
      }

      const salesWithResolvedSubTariff = matchedSales.map((sale) => {
        const saleSubTariffId = extractSaleSubTariffId(sale.legacyImportMeta);
        const profileMatchedSubTariffId = (
          sale.customer.profileCourseId === input.courseId
          && sale.customer.profileTariffId
          && sale.customer.profileTariffId === sale.tariffId
        )
          ? sale.customer.profileSubTariffId || null
          : null;

        return {
          ...sale,
          resolvedSubTariffId: saleSubTariffId || profileMatchedSubTariffId || null,
        };
      });

      const filteredSales = input.subTariffId
        ? salesWithResolvedSubTariff.filter((sale) => sale.resolvedSubTariffId === input.subTariffId)
        : salesWithResolvedSubTariff;
      const { nonTechnicalSales: filteredNonTechnicalSales, chainMetricsBySaleId } = await splitTechnicalSales({
        db: ctx.db,
        tenantId: ctx.tenantId,
        sales: filteredSales,
      });
      const { rangeIncomeBySaleId, currentIncomeBySaleId } = await loadSalePaymentTotals({
        db: ctx.db,
        tenantId: ctx.tenantId,
        saleIds: filteredNonTechnicalSales.map((sale) => sale.id),
        rangeStart,
        rangeEnd,
      });

      let rangeAgreementAmount = 0;
      let currentAgreementAmount = 0;
      let currentDebtAmount = 0;

      for (const sale of filteredNonTechnicalSales) {
        const metric = chainMetricsBySaleId.get(sale.id);
        const agreement = metric?.agreementAmount ?? resolveSaleAgreementAmount(sale);
        const debt = metric?.currentDebtAmount ?? (sale.remainingDebtAmount ?? 0);

        currentAgreementAmount += agreement;
        if (sale.entryDate >= rangeStart && sale.entryDate <= rangeEnd) {
          rangeAgreementAmount += agreement;
        }
        currentDebtAmount += debt;
      }
      const rangeIncomeAmount = Array.from(rangeIncomeBySaleId.values()).reduce((sum, value) => sum + value, 0);
      const currentIncomeAmount = filteredNonTechnicalSales.reduce((sum, sale) => {
        const metric = chainMetricsBySaleId.get(sale.id);

        return sum + (metric?.paidAmount ?? currentIncomeBySaleId.get(sale.id) ?? 0);
      }, 0);
      const currentCustomerCount = new Set(filteredNonTechnicalSales.map((sale) => sale.customerId)).size;

      const tariffCustomerSets = new Map<string, Set<string>>();

      for (const tariff of course.tariffs) {
        tariffCustomerSets.set(tariff.id, new Set());
      }
      const selectedTariff = input.tariffId
        ? course.tariffs.find((tariff) => tariff.id === input.tariffId) || null
        : null;
      const subTariffCustomerSets = new Map<string, Set<string>>();

      if (selectedTariff) {
        for (const subTariff of selectedTariff.subTariffs || []) {
          subTariffCustomerSets.set(subTariff.id, new Set());
        }
      }
      for (const sale of filteredNonTechnicalSales) {
        const effectiveTariffId = sale.tariffId;

        if (!effectiveTariffId) {
          continue;
        }
        const set = tariffCustomerSets.get(effectiveTariffId);

        if (set) {
          set.add(sale.customerId);
        }
        if (selectedTariff && effectiveTariffId === selectedTariff.id && sale.resolvedSubTariffId) {
          const subTariffSet = subTariffCustomerSets.get(sale.resolvedSubTariffId);

          if (subTariffSet) {
            subTariffSet.add(sale.customerId);
          }
        }
      }

      const selectedSubTariffName = profileSubTariffs[0]?.name || null;

      return {
        ...echoReportRange(input),
        course: describeCourse(course),
        selectedTariffId: input.tariffId || null,
        selectedSubTariffId: input.subTariffId || null,
        selectedSubTariffName,
        totals: {
          currentCustomerCount,
          currentAgreementAmount,
          currentIncomeAmount,
          rangeAgreementAmount,
          rangeIncomeAmount,
          currentDebtAmount,
        },
        tariffDistribution: course.tariffs.map((tariff) => ({
          tariffId: tariff.id,
          tariffName: tariff.name,
          customerCount: tariffCustomerSets.get(tariff.id)?.size ?? 0,
          isSelected: input.tariffId ? input.tariffId === tariff.id : false,
        })),
        subTariffDistribution: selectedTariff
          ? (selectedTariff.subTariffs || []).map((subTariff) => ({
              subTariffId: subTariff.id,
              subTariffName: subTariff.name,
              customerCount: subTariffCustomerSets.get(subTariff.id)?.size ?? 0,
              isSelected: input.subTariffId ? input.subTariffId === subTariff.id : false,
            }))
          : [],
        updatedAt: now.toISOString(),
      };
    }),
};
