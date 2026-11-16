import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { CUSTOMER_NUMBER_REGEX } from '../../../services/customer-income/constants';
import { getIncomeLifecycleLabel, resolveManagerLabel } from '../../../services/customer-income/labels';
import { shouldSelfScopeManagerActions } from '../../../services/customer-income/roles';
import { extractSaleSubTariffId, getSaleAgreementAmount } from '../../../services/income-chain';
import { protectedProcedure } from '../../trpc';

export const paymentHistoryProcedures = {
  customerPaymentHistory: protectedProcedure
    .input(z.object({ customerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;
      const customerLookupValue = input.customerId.trim();

      if (!customerLookupValue) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Customer id is required.' });
      }

      const customerWhereBase: Prisma.CustomerWhereInput = {
        tenantId: ctx.tenantId,
        ...(scopedManagerUserId
          ? {
              incomes: {
                some: {
                  managerUserId: scopedManagerUserId,
                },
              },
            }
          : {}),
      };

      let customer = await ctx.db.customer.findFirst({
        where: {
          ...customerWhereBase,
          id: customerLookupValue,
        },
        select: {
          id: true,
          customerNumber: true,
          name: true,
          telegramUsername: true,
          profileCourseId: true,
          profileTariffId: true,
          profileSubTariffId: true,
        },
      });

      if (!customer && CUSTOMER_NUMBER_REGEX.test(customerLookupValue)) {
        customer = await ctx.db.customer.findFirst({
          where: {
            ...customerWhereBase,
            customerNumber: customerLookupValue,
          },
          select: {
            id: true,
            customerNumber: true,
            name: true,
            telegramUsername: true,
            profileCourseId: true,
            profileTariffId: true,
            profileSubTariffId: true,
          },
        });
      }

      if (!customer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found.' });
      }

      const [courseSales, paymentHistory] = await Promise.all([
        ctx.db.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            customerId: customer.id,
            type: 'new_sale',
            ...(scopedManagerUserId
              ? {
                  managerUserId: scopedManagerUserId,
                }
              : {}),
          },
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            type: true,
            lifecycleStatus: true,
            entryDate: true,
            coursePriceAmount: true,
            debtAmount: true,
            paymentAmount: true,
            remainingDebtAmount: true,
            legacyImportMeta: true,
            course: { select: { id: true, name: true } },
            tariff: { select: { id: true, name: true } },
            manager: { select: { id: true, name: true, username: true } },
          },
        }),
        ctx.db.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            customerId: customer.id,
            paymentAmount: { gt: 0 },
            ...(scopedManagerUserId
              ? {
                  managerUserId: scopedManagerUserId,
                }
              : {}),
          },
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            type: true,
            lifecycleStatus: true,
            entryDate: true,
            paymentAmount: true,
            remainingDebtAmount: true,
            relatedDebtIncomeId: true,
            legacyImportMeta: true,
            course: { select: { id: true, name: true } },
            tariff: { select: { id: true, name: true } },
            relatedDebtIncome: {
              select: {
                id: true,
                legacyImportMeta: true,
                course: { select: { id: true, name: true } },
                tariff: { select: { id: true, name: true } },
              },
            },
            manager: { select: { id: true, name: true, username: true } },
          },
        }),
      ]);

      const collectedSubTariffIds = new Set<string>();
      const maybeAddSubTariffId = (value: string | null) => {
        if (value) {
          collectedSubTariffIds.add(value);
        }
      };

      for (const sale of courseSales as Array<{ legacyImportMeta: Prisma.JsonValue | null }>) {
        maybeAddSubTariffId(extractSaleSubTariffId(sale.legacyImportMeta));
      }
      for (const payment of paymentHistory as Array<{
        legacyImportMeta: Prisma.JsonValue | null;
        relatedDebtIncome: { legacyImportMeta: Prisma.JsonValue | null } | null;
      }>) {
        maybeAddSubTariffId(extractSaleSubTariffId(payment.legacyImportMeta));
        maybeAddSubTariffId(extractSaleSubTariffId(payment.relatedDebtIncome?.legacyImportMeta));
      }
      maybeAddSubTariffId(customer.profileSubTariffId || null);

      const subTariffNameById = new Map<string, string>();

      if (collectedSubTariffIds.size > 0) {
        const subTariffs = await ctx.db.subTariff.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: Array.from(collectedSubTariffIds) },
          },
          select: {
            id: true,
            name: true,
          },
        });

        for (const subTariff of subTariffs) {
          subTariffNameById.set(subTariff.id, subTariff.name);
        }
      }

      return {
        customer,
        courses: courseSales.map((sale) => ({
          subTariffName: (() => {
            const saleSubTariffId = extractSaleSubTariffId(sale.legacyImportMeta);
            const profileMatchedSubTariffId = customer.profileCourseId === sale.course?.id
              && customer.profileTariffId === sale.tariff?.id
              ? (customer.profileSubTariffId || null)
              : null;
            const effectiveSubTariffId = saleSubTariffId || profileMatchedSubTariffId;

            return effectiveSubTariffId ? subTariffNameById.get(effectiveSubTariffId) || null : null;
          })(),
          saleIncomeId: sale.id,
          lifecycleStatus: getIncomeLifecycleLabel(sale.lifecycleStatus),
          entryDate: sale.entryDate,
          courseName: sale.course?.name || '-',
          tariffName: sale.tariff?.name || '-',
          agreementAmount: getSaleAgreementAmount(sale),
          firstPaymentAmount: sale.paymentAmount ?? 0,
          remainingDebtAmount: sale.remainingDebtAmount ?? 0,
          managerLabel: resolveManagerLabel(sale.manager),
        })),
        payments: paymentHistory.map((income) => {
          const fallbackCourse = income.relatedDebtIncome?.course?.name || '-';
          const fallbackTariff = income.relatedDebtIncome?.tariff?.name || '-';

          return {
            id: income.id,
            type: income.type,
            lifecycleStatus: getIncomeLifecycleLabel(income.lifecycleStatus),
            entryDate: income.entryDate,
            paymentAmount: income.paymentAmount ?? 0,
            remainingDebtAmount: income.remainingDebtAmount ?? 0,
            courseName: income.course?.name || fallbackCourse,
            tariffName: income.tariff?.name || fallbackTariff,
            subTariffName: (() => {
              const saleSubTariffId = extractSaleSubTariffId(income.legacyImportMeta)
                || extractSaleSubTariffId(income.relatedDebtIncome?.legacyImportMeta);
              const profileMatchedSubTariffId = customer.profileCourseId === (income.course?.id || income.relatedDebtIncome?.course?.id || null)
                && customer.profileTariffId === (income.tariff?.id || income.relatedDebtIncome?.tariff?.id || null)
                ? (customer.profileSubTariffId || null)
                : null;
              const effectiveSubTariffId = saleSubTariffId || profileMatchedSubTariffId;

              return effectiveSubTariffId ? subTariffNameById.get(effectiveSubTariffId) || null : null;
            })(),
            managerLabel: resolveManagerLabel(income.manager),
            debtSourceIncomeId: income.relatedDebtIncomeId || income.id,
          };
        }),
      };
    }),
};
