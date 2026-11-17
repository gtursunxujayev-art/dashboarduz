import { customerSearchSchema } from '@dashboarduz/shared';
import { z } from 'zod';

import { logger } from '../../../lib/logger';
import { fetchCoursesWithTariffsSafe, toCourseOptions } from '../../../services/customer-income/catalog';
import { fetchLatestResponsibleManagerByCustomer } from '../../../services/customer-income/labels';
import { canSelectInactiveManagerForIncome, hasSalesManagerRole, shouldSelfScopeManagerActions } from '../../../services/customer-income/roles';
import { buildActiveSaleChainMetrics, getSaleAgreementAmount, INCOME_LIFECYCLE_ACTIVE, type SaleChainSaleRow } from '../../../services/income-chain';
import { NON_TECHNICAL_SALE_WHERE } from '../../../services/income-facts';
import { protectedProcedure } from '../../trpc';

export const formOptionsProcedures = {
  formOptions: protectedProcedure.query(async ({ ctx }) => {
    const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;
    const includeInactiveManagers = canSelectInactiveManagerForIncome(ctx.user.roles);

    const [managersInitial, customers, outstandingDebts] = await Promise.all([
      ctx.db.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(includeInactiveManagers ? {} : { isActive: true }),
          ...(scopedManagerUserId
            ? {
                id: scopedManagerUserId,
              }
            : {}),
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          username: true,
          roles: true,
          isActive: true,
        },
      }),
      ctx.db.customer.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(scopedManagerUserId
              ? {
                  incomes: {
                    some: {
                      managerUserId: scopedManagerUserId,
                      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                    },
                  },
                }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: {
          id: true,
          customerNumber: true,
          name: true,
          telegramUsername: true,
        },
      }),
      ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          ...(scopedManagerUserId
            ? {
                managerUserId: scopedManagerUserId,
              }
            : {}),
        },
        orderBy: { entryDate: 'desc' },
        take: 300,
        select: {
          id: true,
          entryDate: true,
          coursePriceAmount: true,
          debtAmount: true,
          paymentAmount: true,
          remainingDebtAmount: true,
          customer: {
            select: {
              customerNumber: true,
              name: true,
            },
          },
          course: {
            select: { name: true },
          },
          tariff: {
            select: { name: true },
          },
        },
      }),
    ]);

    let managers = managersInitial;

    if ((managersInitial as Array<unknown>).length === 0) {
      managers = await ctx.db.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(includeInactiveManagers ? {} : { isActive: true }),
          ...(scopedManagerUserId
            ? {
                id: scopedManagerUserId,
              }
            : {}),
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          username: true,
          roles: true,
          isActive: true,
        },
      });
    }

    let courses: Array<{
      id: string;
      name: string;
      category: string;
      tariffs: Array<{
        id: string;
        name: string;
        subTariffs: Array<{ id: string; name: string }>;
      }>;
    }> = [];

    try {
      courses = await fetchCoursesWithTariffsSafe({
        tenantId: ctx.tenantId,
        onlyActive: true,
        excludeHiddenFromIncomeForm: true,
        db: ctx.db,
      });
    } catch (courseError) {
      logger.error({ err: courseError }, '[Income/FormOptions] Failed to load courses, returning empty course list:');
      courses = [];
    }
    const outstandingDebtMetricsBySaleId = await buildActiveSaleChainMetrics({
      tenantId: ctx.tenantId,
      sales: outstandingDebts as SaleChainSaleRow[],
      db: ctx.db,
    });

    const responsibleManagerMap = await fetchLatestResponsibleManagerByCustomer({
      tenantId: ctx.tenantId,
      customerIds: (customers as Array<{ id: string }>).map((customer) => customer.id),
      scopedManagerUserId,
      db: ctx.db,
    });

    const managerRows = managers as Array<{
      id: string;
      name: string | null;
      username: string | null;
      roles: string[];
      isActive: boolean;
    }>;
    const availableManagersFiltered = managerRows.filter((manager) => hasSalesManagerRole(manager.roles));
    const availableManagers = availableManagersFiltered.length > 0 ? availableManagersFiltered : managerRows;

    const managerOptions = availableManagers.map((manager) => ({
      id: manager.id,
      label: `${manager.name || manager.username || manager.id}${manager.isActive === false ? ' (Nofaol)' : ''}`,
      roles: manager.roles,
    }));
    const managersForResponse = managerOptions.length > 0
      ? managerOptions
      : [
          {
            id: ctx.user.userId,
            label: ctx.user.userId,
            roles: Array.isArray(ctx.user.roles) ? ctx.user.roles : [],
          },
        ];

    return {
      managers: managersForResponse,
      customers: (customers as Array<{
        id: string;
        customerNumber: string;
        name: string;
        telegramUsername: string | null;
      }>).map((customer) => {
        const responsibleManager = responsibleManagerMap.get(customer.id);

        return {
          ...customer,
          responsibleManagerUserId: responsibleManager?.managerUserId ?? null,
          responsibleManagerLabel: responsibleManager?.managerLabel ?? null,
        };
      }),
      courses: toCourseOptions(courses, { activeSubTariffsOnly: false }),
      outstandingDebts: (outstandingDebts as Array<{
        id: string;
        entryDate: Date;
        coursePriceAmount: number | null;
        remainingDebtAmount: number;
        debtAmount: number | null;
        paymentAmount: number;
        customer: { customerNumber: string; name: string };
        course: { name: string } | null;
        tariff: { name: string } | null;
      }>)
        .filter((debt) => (outstandingDebtMetricsBySaleId.get(debt.id)?.currentDebtAmount ?? debt.remainingDebtAmount) > 0)
        .map((debt) => ({
        id: debt.id,
        remainingDebtAmount: outstandingDebtMetricsBySaleId.get(debt.id)?.currentDebtAmount ?? debt.remainingDebtAmount,
        debtAmount: outstandingDebtMetricsBySaleId.get(debt.id)?.agreementAmount
          ?? getSaleAgreementAmount(debt),
        customerNumber: debt.customer.customerNumber,
        customerName: debt.customer.name,
        courseName: debt.course?.name || null,
        tariffName: debt.tariff?.name || null,
      })),
    };
  }),
  searchCustomers: protectedProcedure
    .input(customerSearchSchema)
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;
      const query = input.query?.trim();
      const customers = await ctx.db.customer.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(scopedManagerUserId
              ? {
                  incomes: {
                    some: {
                      managerUserId: scopedManagerUserId,
                      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                    },
                  },
                }
            : {}),
          ...(query
            ? {
                OR: [
                  { customerNumber: { contains: query, mode: 'insensitive' } },
                  { name: { contains: query, mode: 'insensitive' } },
                  { telegramUsername: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
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

      const responsibleManagerMap = await fetchLatestResponsibleManagerByCustomer({
        tenantId: ctx.tenantId,
        customerIds: customers.map((customer) => customer.id),
        scopedManagerUserId,
        db: ctx.db,
      });

      return customers.map((customer) => {
        const responsibleManager = responsibleManagerMap.get(customer.id);

        return {
          ...customer,
          responsibleManagerUserId: responsibleManager?.managerUserId ?? null,
          responsibleManagerLabel: responsibleManager?.managerLabel ?? null,
        };
      });
    }),
  customerOutstandingDebts: protectedProcedure
    .input(
      z.object({
        customerNumber: z.string().min(1).max(64),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;
      const normalizedCustomerNumber = input.customerNumber.replace(/\D/g, '').trim();

      if (!normalizedCustomerNumber) {
        return [];
      }

      const debts = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          customer: {
            customerNumber: normalizedCustomerNumber,
          },
          ...(scopedManagerUserId
            ? {
                managerUserId: scopedManagerUserId,
              }
            : {}),
          // Technical sales (agreement == 1) are not real debts; never offer them for a repayment.
          ...NON_TECHNICAL_SALE_WHERE,
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        take: 200,
        select: {
          id: true,
          entryDate: true,
          coursePriceAmount: true,
          paymentAmount: true,
          remainingDebtAmount: true,
          debtAmount: true,
          customer: {
            select: {
              customerNumber: true,
              name: true,
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
      const debtMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: debts as SaleChainSaleRow[],
        db: ctx.db,
      });

      return debts
        .filter((debt) => (debtMetricsBySaleId.get(debt.id)?.currentDebtAmount ?? debt.remainingDebtAmount) > 0)
        .map((debt) => ({
        id: debt.id,
        remainingDebtAmount: debtMetricsBySaleId.get(debt.id)?.currentDebtAmount ?? debt.remainingDebtAmount,
        debtAmount: debtMetricsBySaleId.get(debt.id)?.agreementAmount ?? getSaleAgreementAmount(debt),
        customerNumber: debt.customer.customerNumber,
        customerName: debt.customer.name,
        courseName: debt.course?.name || null,
        tariffName: debt.tariff?.name || null,
      }));
    }),
};
