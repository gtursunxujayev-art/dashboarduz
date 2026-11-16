import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { parseCustomDate } from '../../../lib/dates';
import { CUSTOM_DATE_OPTIONS } from '../../../services/customer-income/constants';
import { getIncomeLifecycleLabel, resolveManagerLabel } from '../../../services/customer-income/labels';
import { shouldSelfScopeManagerActions } from '../../../services/customer-income/roles';
import { extractSaleSubTariffId, getSaleAgreementAmount, INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { adminProcedure, protectedProcedure } from '../../trpc';

export const incomeListProcedures = {
  listIncomes: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(200).default(30),
          query: z.string().trim().max(120).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;
      const searchQuery = (input?.query || '').trim();
        const incomes = await ctx.db.income.findMany({
          where: {
            tenantId: ctx.tenantId,
          ...(scopedManagerUserId
            ? {
                managerUserId: scopedManagerUserId,
              }
            : {}),
          ...(searchQuery
            ? {
                customer: {
                  OR: [
                    {
                      customerNumber: {
                        contains: searchQuery,
                        mode: 'insensitive',
                      },
                    },
                    {
                      name: {
                        contains: searchQuery,
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: input?.limit ?? 30,
          include: {
            customer: {
            select: {
              customerNumber: true,
              name: true,
              profileCourseId: true,
              profileTariffId: true,
              profileSubTariffId: true,
            },
            },
            manager: {
              select: {
                name: true,
                username: true,
              },
            },
            course: {
              select: { name: true },
            },
            tariff: {
              select: { name: true },
            },
            relatedDebtIncome: {
              select: { id: true },
            },
          },
        });

        const manualIncomeIds = incomes
          .filter((income) => !income.legacyImportSource)
          .map((income) => income.id);

        const auditLogs = manualIncomeIds.length
          ? await ctx.db.auditLog.findMany({
              where: {
                tenantId: ctx.tenantId,
                action: 'income_create',
                resource: 'income',
                resourceId: {
                  in: manualIncomeIds,
                },
              },
              orderBy: { createdAt: 'asc' },
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    username: true,
                    phone: true,
                    email: true,
                  },
                },
              },
            })
          : [];

        const createdByLabelByIncomeId = new Map<string, string>();

        for (const log of auditLogs) {
          if (!log.resourceId || createdByLabelByIncomeId.has(log.resourceId)) {
            continue;
          }
          const label = log.user?.name
            || log.user?.username
            || log.user?.phone
            || log.user?.email
            || 'qo‘lda';

          createdByLabelByIncomeId.set(log.resourceId, label);
        }
  
        return incomes.map((income) => {
          const saleSubTariffId = extractSaleSubTariffId(income.legacyImportMeta);
          const profileMatchedSubTariffId = (
            income.customer?.profileCourseId === income.courseId
            && income.customer?.profileTariffId === income.tariffId
          )
            ? (income.customer?.profileSubTariffId || null)
            : null;
          const effectiveSubTariffId = saleSubTariffId || profileMatchedSubTariffId || null;

          return {
            ...income,
            lifecycleStatus: getIncomeLifecycleLabel(income.lifecycleStatus),
            createdByLabel: income.legacyImportSource
              ? 'import'
              : (createdByLabelByIncomeId.get(income.id) || 'qo‘lda'),
            effectiveSubTariffId,
          };
        });
      }),
  exportIncomesByDateRange: adminProcedure
    .input(
      z.object({
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rangeStart = parseCustomDate(input.dateFrom, false, CUSTOM_DATE_OPTIONS);
      const rangeEnd = parseCustomDate(input.dateTo, true, CUSTOM_DATE_OPTIONS);

      if (rangeEnd < rangeStart) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas.",
        });
      }

      const totalCount = await ctx.db.income.count({
        where: {
          tenantId: ctx.tenantId,
          entryDate: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
      });

      if (totalCount > 20000) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Tanlangan davrda yozuvlar juda ko'p. Iltimos, kichikroq davr tanlang.",
        });
      }

      const incomes = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          entryDate: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          customer: {
            select: {
              customerNumber: true,
              name: true,
              telegramUsername: true,
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
          course: {
            select: { name: true },
          },
          tariff: {
            select: { name: true },
          },
        },
      });

      const subTariffIds = Array.from(
        new Set(
          incomes
            .map((income) => extractSaleSubTariffId(income.legacyImportMeta))
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const subTariffNameById = new Map<string, string>();

      if (subTariffIds.length > 0) {
        const subTariffs = await ctx.db.subTariff.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: subTariffIds },
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
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        totalCount,
        rows: incomes.map((income) => {
          const saleSubTariffId = extractSaleSubTariffId(income.legacyImportMeta);
          const profileSubTariffId = income.customer?.profileSubTariffId || null;
          const subTariffId = saleSubTariffId || profileSubTariffId || null;
          const subTariffName = subTariffId ? subTariffNameById.get(subTariffId) || null : null;

          return {
            id: income.id,
            entryDate: income.entryDate,
            deadline: income.deadline,
            type: income.type,
            lifecycleStatus: getIncomeLifecycleLabel(income.lifecycleStatus),
            customerNumber: income.customer?.customerNumber || '',
            customerName: income.customer?.name || '',
            telegramUsername: income.customer?.telegramUsername || '',
            managerLabel: income.manager?.name || income.manager?.username || income.managerUserId || '',
            courseName: income.course?.name || '',
            tariffName: income.tariff?.name || '',
            subTariffName,
            // Only the sale row carries the agreement; repeating it on repayment rows doubled the column's total.
            agreementAmount: income.type === 'new_sale' ? getSaleAgreementAmount(income) : null,
            paymentAmount: Number(income.paymentAmount ?? 0),
            remainingDebtAmount: Number(income.remainingDebtAmount ?? 0),
          };
        }),
      };
    }),
  listAdjustableIncomes: protectedProcedure
    .input(z.object({ customerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;

      const customer = await ctx.db.customer.findFirst({
        where: {
          id: input.customerId,
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

      if (!customer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found.' });
      }

      const sales = await ctx.db.income.findMany({
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
        take: 80,
        select: {
          id: true,
          type: true,
          lifecycleStatus: true,
          paymentAmount: true,
          coursePriceAmount: true,
          debtAmount: true,
          remainingDebtAmount: true,
          entryDate: true,
          course: { select: { id: true, name: true } },
          tariff: { select: { id: true, name: true } },
          manager: { select: { id: true, name: true, username: true } },
        },
      });

      const saleIds = sales.map((sale) => sale.id);
      const saleChainPayments = saleIds.length
        ? await ctx.db.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              customerId: customer.id,
              paymentAmount: { gt: 0 },
              OR: [
                { id: { in: saleIds } },
                { relatedDebtIncomeId: { in: saleIds } },
              ],
              ...(scopedManagerUserId
                ? {
                    managerUserId: scopedManagerUserId,
                  }
                : {}),
            },
            select: {
              id: true,
              relatedDebtIncomeId: true,
              paymentAmount: true,
            },
          })
        : [];

      const paidBySaleId = new Map<string, number>();

      for (const payment of saleChainPayments) {
        const saleId = payment.relatedDebtIncomeId || payment.id;

        paidBySaleId.set(saleId, (paidBySaleId.get(saleId) ?? 0) + Number(payment.paymentAmount || 0));
      }

      return {
        customer,
        incomes: sales.map((sale) => ({
          ...sale,
          paymentAmount: paidBySaleId.get(sale.id) ?? Number(sale.paymentAmount || 0),
          lifecycleStatus: getIncomeLifecycleLabel(sale.lifecycleStatus),
          managerLabel: resolveManagerLabel(sale.manager),
          canCreateRequest: sale.lifecycleStatus === INCOME_LIFECYCLE_ACTIVE,
          canChangeTariff: sale.lifecycleStatus === INCOME_LIFECYCLE_ACTIVE,
        })),
      };
    }),
};
