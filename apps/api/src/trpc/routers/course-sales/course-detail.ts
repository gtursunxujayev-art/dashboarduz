import { normalizeSubTariffName } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

import { describeCourse } from '../../../services/course-sales/catalog';
import { activeSalesWhere, courseScopeInput, echoReportRange, loadSalePaymentTotals, resolveCourseScope, splitTechnicalSales } from '../../../services/course-sales/queries';
import { resolveSaleAgreementAmount, resolveSaleSubTariffId } from '../../../services/income-facts';
import { buildTariffBreakdown } from '../../../services/tariff-breakdown';
import { protectedProcedure } from '../../trpc';

export const courseDetailProcedures = {
  courseDetail: protectedProcedure
    .input(courseScopeInput)
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const { rangeStart, rangeEnd, scopedManagerUserId, scopedFilters } = await resolveCourseScope(ctx, input, now);

      const [course, sales] = await Promise.all([
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
            tariffs: {
              where: { isActive: true },
              orderBy: [{ name: 'asc' }],
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
        ctx.db.income.findMany({
          where: activeSalesWhere({ tenantId: ctx.tenantId, scopedManagerUserId, filters: scopedFilters }),
          select: {
            id: true,
            customerId: true,
            managerUserId: true,
            courseId: true,
            tariffId: true,
            entryDate: true,
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
            manager: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
          },
        }),
      ]);

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kurs topilmadi.' });
      }

      const { nonTechnicalSales, chainMetricsBySaleId } = await splitTechnicalSales({
        db: ctx.db,
        tenantId: ctx.tenantId,
        sales,
      });
      const profileSubTariffIds = Array.from(
        new Set(
          sales
            .map((sale) => sale.customer.profileSubTariffId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const [{ rangeIncomeBySaleId: incomeBySaleId, currentIncomeBySaleId }, subTariffs] = await Promise.all([
        loadSalePaymentTotals({
          db: ctx.db,
          tenantId: ctx.tenantId,
          saleIds: nonTechnicalSales.map((sale) => sale.id),
          rangeStart,
          rangeEnd,
        }),
        profileSubTariffIds.length > 0
          ? ctx.db.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                id: { in: profileSubTariffIds },
              },
              select: {
                id: true,
                name: true,
              },
            })
          : Promise.resolve([]),
      ]);

      const subTariffNameById = new Map(subTariffs.map((subTariff) => [subTariff.id, normalizeSubTariffName(subTariff.name)]));

      let rangeAgreementAmount = 0;
      let rangeSalesPaidAmount = 0;
      let currentAgreementAmount = 0;
      let currentDebtAmount = 0;

      for (const sale of nonTechnicalSales) {
        const metric = chainMetricsBySaleId.get(sale.id);
        const agreement = metric?.agreementAmount ?? resolveSaleAgreementAmount(sale);
        const debt = metric?.currentDebtAmount ?? (sale.remainingDebtAmount ?? 0);

        currentAgreementAmount += agreement;
        if (sale.entryDate >= rangeStart && sale.entryDate <= rangeEnd) {
          rangeAgreementAmount += agreement;
          rangeSalesPaidAmount += metric?.paidAmount ?? currentIncomeBySaleId.get(sale.id) ?? 0;
        }
        currentDebtAmount += debt;
      }

      // Every tariff of the course, including deactivated ones: old sales on a retired tariff must still be counted.
      const allCourseTariffs = await ctx.db.tariff.findMany({
        where: { tenantId: ctx.tenantId, courseId: course.id },
        select: { id: true, name: true },
      });
      // Real tariff / sub-tariff names instead of the old hard-coded VIP/Standart lookup on the customer profile.
      const courseTariffById = new Map(allCourseTariffs.map((tariff) => [tariff.id, tariff]));
      const breakdownSales = nonTechnicalSales.map((sale) => ({
        tariff: sale.tariffId ? courseTariffById.get(sale.tariffId) ?? null : null,
        resolvedSubTariffId: resolveSaleSubTariffId(sale),
      }));
      const breakdownSubTariffIds = Array.from(new Set(
        breakdownSales.map((sale) => sale.resolvedSubTariffId).filter((id): id is string => Boolean(id)),
      ));
      const breakdownSubTariffs = breakdownSubTariffIds.length
        ? await ctx.db.subTariff.findMany({ where: { tenantId: ctx.tenantId, id: { in: breakdownSubTariffIds } }, select: { id: true, name: true } })
        : [];
      const tariffBreakdown = buildTariffBreakdown({
        sales: breakdownSales,
        subTariffNameById: new Map(breakdownSubTariffs.map((subTariff) => [subTariff.id, subTariff.name])),
        knownTariffs: course.tariffs,
      });
      const currentCustomerCount = new Set(nonTechnicalSales.map((sale) => sale.customerId)).size;
      const rangeIncomeAmount = Array.from(incomeBySaleId.values()).reduce((sum, value) => sum + value, 0);
      const currentIncomeAmount = nonTechnicalSales.reduce((sum, sale) => {
        const metric = chainMetricsBySaleId.get(sale.id);

        return sum + (metric?.paidAmount ?? currentIncomeBySaleId.get(sale.id) ?? 0);
      }, 0);
      // Share of the agreements made in this period that has been paid so far. Payments on older sales used to be
      // divided by this period's agreements, which pushed the percentage above 100.
      const collectionPercent = rangeAgreementAmount > 0
        ? Number(((rangeSalesPaidAmount / rangeAgreementAmount) * 100).toFixed(1))
        : 0;

      const tariffRowMap = new Map<
        string,
        {
          tariffId: string;
          tariffName: string;
          saleIds: string[];
          customerIds: Set<string>;
          agreementAmount: number;
          debtAmount: number;
          incomeAmount: number;
        }
      >();

      for (const tariff of course.tariffs) {
        tariffRowMap.set(tariff.id, {
          tariffId: tariff.id,
          tariffName: tariff.name,
          saleIds: [],
          customerIds: new Set(),
          agreementAmount: 0,
          debtAmount: 0,
          incomeAmount: 0,
        });
      }

      const managerMap = new Map<
        string,
        {
          managerUserId: string;
          managerLabel: string;
          saleCount: number;
          customerIds: Set<string>;
          agreementAmount: number;
          debtAmount: number;
          incomeAmount: number;
        }
      >();

      const NO_TARIFF_ROW_KEY = '';
      const ensureTariffRow = (tariffId: string | null) => {
        const key = tariffId ?? NO_TARIFF_ROW_KEY;
        let row = tariffRowMap.get(key);

        if (!row) {
          row = {
            tariffId: key,
            tariffName: tariffId ? courseTariffById.get(tariffId)?.name || 'Tarif' : 'Tarifsiz',
            saleIds: [],
            customerIds: new Set(),
            agreementAmount: 0,
            debtAmount: 0,
            incomeAmount: 0,
          };
          tariffRowMap.set(key, row);
        }

        return row;
      };

      for (const sale of nonTechnicalSales) {
        // Sales on a deactivated tariff, or with no tariff, used to be dropped from this table.
        const tariffRow = ensureTariffRow(sale.tariffId);

        tariffRow.saleIds.push(sale.id);
        tariffRow.customerIds.add(sale.customerId);
        if (sale.entryDate >= rangeStart && sale.entryDate <= rangeEnd) {
          tariffRow.agreementAmount += chainMetricsBySaleId.get(sale.id)?.agreementAmount
            ?? resolveSaleAgreementAmount(sale);
        }
        tariffRow.debtAmount += chainMetricsBySaleId.get(sale.id)?.currentDebtAmount ?? (sale.remainingDebtAmount ?? 0);

        const managerLabel = sale.manager.name || sale.manager.username || sale.manager.id;
        const managerRow = managerMap.get(sale.managerUserId) || {
          managerUserId: sale.managerUserId,
          managerLabel,
          saleCount: 0,
          customerIds: new Set<string>(),
          agreementAmount: 0,
          debtAmount: 0,
          incomeAmount: 0,
        };

        managerRow.saleCount += 1;
        managerRow.customerIds.add(sale.customerId);
        if (sale.entryDate >= rangeStart && sale.entryDate <= rangeEnd) {
          managerRow.agreementAmount += chainMetricsBySaleId.get(sale.id)?.agreementAmount
            ?? resolveSaleAgreementAmount(sale);
        }
        managerRow.debtAmount += chainMetricsBySaleId.get(sale.id)?.currentDebtAmount ?? (sale.remainingDebtAmount ?? 0);
        managerMap.set(sale.managerUserId, managerRow);
      }

      const saleById = new Map(nonTechnicalSales.map((sale) => [sale.id, sale]));

      for (const [saleId, amount] of incomeBySaleId.entries()) {
        const sale = saleById.get(saleId);

        if (!sale) {
          continue;
        }
        ensureTariffRow(sale.tariffId).incomeAmount += amount;
        const managerRow = managerMap.get(sale.managerUserId);

        if (managerRow) {
          managerRow.incomeAmount += amount;
        }
      }

      const tariffRows = Array.from(tariffRowMap.values()).map((row) => {
        const collectionPercentByTariff = row.agreementAmount > 0
          ? Number(((row.incomeAmount / row.agreementAmount) * 100).toFixed(1))
          : 0;

        return {
          tariffId: row.tariffId,
          tariffName: row.tariffName,
          customerCount: row.customerIds.size,
          saleCount: row.saleIds.length,
          agreementAmount: row.agreementAmount,
          incomeAmount: row.incomeAmount,
          debtAmount: row.debtAmount,
          collectionPercent: collectionPercentByTariff,
          isSelected: input.tariffId ? input.tariffId === row.tariffId : false,
        };
      });

      const managerRows = Array.from(managerMap.values())
        .map((row) => {
          const collectionPercentByManager = row.agreementAmount > 0
            ? Number(((row.incomeAmount / row.agreementAmount) * 100).toFixed(1))
            : 0;

          return {
            managerUserId: row.managerUserId,
            managerLabel: row.managerLabel,
            saleCount: row.saleCount,
            customerCount: row.customerIds.size,
            agreementAmount: row.agreementAmount,
            incomeAmount: row.incomeAmount,
            debtAmount: row.debtAmount,
            collectionPercent: collectionPercentByManager,
          };
        })
        .sort((a, b) => b.incomeAmount - a.incomeAmount);

      return {
        ...echoReportRange(input),
        course: describeCourse(course),
        selectedTariffId: input.tariffId || null,
        selectedSubTariffId: input.subTariffId || null,
        summary: {
          factSalesCount: nonTechnicalSales.length,
          currentCustomerCount,
          currentAgreementAmount,
          currentIncomeAmount,
          rangeAgreementAmount,
          rangeIncomeAmount,
          currentDebtAmount,
          tariffBreakdown,
          collectionPercent,
        },
        tariffRows,
        managerRows,
        updatedAt: now.toISOString(),
      };
    }),
};
