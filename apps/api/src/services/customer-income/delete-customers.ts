import type { TenantPrismaClient } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { getTashkentMonthKey, getTashkentMonthStart } from '../bonus/policy';

import { lockSaleChain, requestBonusReconcile } from './sale-chain';
import { incomeManagerWhere, writableCustomerWhere } from './scope';

export type DeletedCustomerSummary = { id: string; incomeCount: number; requestCount: number; paymentTotal: number };

export type DeleteCustomersResult = {
  deletedCount: number;
  deletedIds: string[];
  deletedIncomeCount: number;
  deletedRequestCount: number;
  /** True when a finalized bonus month lost incomes, so the caller must run the requested reconcile. */
  bonusReconcileRequested: boolean;
};

/**
 * Refuses (FORBIDDEN) when one of `customerIds` has an income whose manager is not in `scopedManagerUserIds`:
 * deleting the customer would delete that income too.
 */
async function assertNoIncomesOutsideScope(
  tx: Prisma.TransactionClient,
  tenantId: string,
  customerIds: string[],
  scopedManagerUserIds: readonly string[],
): Promise<void> {
  const outsideScope = await tx.income.count({
    where: { tenantId, customerId: { in: customerIds }, NOT: incomeManagerWhere(scopedManagerUserIds) },
  });

  if (outsideScope > 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "Tanlangan mijozlarning ba'zilari sizning guruhingizga tegishli emas." });
  }
}

/**
 * Deletes customers of the tenant together with their money rows, in one transaction:
 *   1. locks every sale chain of these customers (as money writes do), so no repayment or request lands meanwhile;
 *   2. refuses (CONFLICT) if a payment of ANOTHER customer is linked to one of these sales;
 *   3. deletes their adjustment requests, then their repayments, then their sales, then the customers;
 *   4. writes a bonus reconcile marker per finalized month that lost incomes;
 *   5. writes the audit row (ids, and per customer the incomes, requests and paid total deleted).
 * The foreign keys from incomes and requests to customers stay NO ACTION, so no other code path can cascade money
 * rows away. Frozen bonus history (snapshot items' sourceIncomeId/sourceSaleId) and audit rows are kept as history.
 * Ids of other tenants or unknown ids are ignored. With `scopedManagerUserIds` (a scoped caller such as OnlineAdmin)
 * only customers writable in that scope are selected (others are ignored like unknown ids), and the whole delete is
 * refused (FORBIDDEN, nothing deleted) when one of them also has an income of a manager outside the scope.
 */
export async function deleteCustomersWithMoneyRows(params: {
  tenantId: string;
  actorUserId: string;
  customerIds: string[];
  /** The caller's managers when scoped; null or omitted for an unscoped admin. */
  scopedManagerUserIds?: readonly string[] | null;
  db: TenantPrismaClient;
}): Promise<DeleteCustomersResult> {
  const { tenantId } = params;

  return params.db.$transaction(async (tx: Prisma.TransactionClient) => {
    const scopedManagerUserIds = params.scopedManagerUserIds ?? null;
    const customers = await tx.customer.findMany({
      where: { tenantId, id: { in: params.customerIds }, ...writableCustomerWhere(scopedManagerUserIds) },
      select: { id: true },
    });
    const customerIds = customers.map((customer) => customer.id);

    if (!customerIds.length) {
      return { deletedCount: 0, deletedIds: [], deletedIncomeCount: 0, deletedRequestCount: 0, bonusReconcileRequested: false };
    }

    const sales = await tx.income.findMany({ where: { tenantId, customerId: { in: customerIds }, type: 'new_sale' }, select: { id: true }, orderBy: { id: 'asc' } });
    const saleIds = sales.map((sale) => sale.id);

    for (const saleId of saleIds) {
      await lockSaleChain(tx, { tenantId, saleId });
    }

    if (scopedManagerUserIds) {
      await assertNoIncomesOutsideScope(tx, tenantId, customerIds, scopedManagerUserIds);
    }

    const foreignRepayments = saleIds.length
      ? await tx.income.count({ where: { tenantId, relatedDebtIncomeId: { in: saleIds }, customerId: { notIn: customerIds } } })
      : 0;

    if (foreignRepayments > 0) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `${foreignRepayments} ta boshqa mijozning to'lovi shu sotuvlarga bog'langan. Avval ularni to'g'rilang.`,
      });
    }

    const incomes = await tx.income.findMany({
      where: { tenantId, customerId: { in: customerIds } },
      select: { id: true, customerId: true, paymentAmount: true, entryDate: true },
    });
    const incomeIds = incomes.map((income) => income.id);
    const requests = await tx.incomeAdjustmentRequest.findMany({
      where: { tenantId, OR: [{ customerId: { in: customerIds } }, ...(incomeIds.length ? [{ incomeId: { in: incomeIds } }] : [])] },
      select: { id: true, customerId: true },
    });

    if (requests.length) {
      await tx.incomeAdjustmentRequest.deleteMany({ where: { tenantId, id: { in: requests.map((request) => request.id) } } });
    }
    if (incomeIds.length) {
      // Repayments first, then the sales they point at (relatedDebtIncomeId).
      await tx.income.deleteMany({ where: { tenantId, id: { in: incomeIds }, relatedDebtIncomeId: { not: null } } });
      await tx.income.deleteMany({ where: { tenantId, id: { in: incomeIds } } });
    }

    const monthStarts = [...new Map(incomes.map((income) => {
      const start = getTashkentMonthStart(income.entryDate);

      return [start.getTime(), start] as const;
    })).values()];
    const finalizedMonths = monthStarts.length
      ? await tx.bonusMonthSnapshot.findMany({ where: { tenantId, month: { in: monthStarts } }, select: { month: true }, orderBy: { month: 'asc' } })
      : [];

    for (const { month } of finalizedMonths) {
      await requestBonusReconcile(tx, tenantId, `deleteCustomers:${getTashkentMonthKey(month)}`);
    }

    const deleted = await tx.customer.deleteMany({ where: { tenantId, id: { in: customerIds } } });
    const perCustomer: DeletedCustomerSummary[] = customerIds.map((id) => {
      const own = incomes.filter((income) => income.customerId === id);

      return {
        id,
        incomeCount: own.length,
        requestCount: requests.filter((request) => request.customerId === id).length,
        paymentTotal: own.reduce((sum, income) => sum + Number(income.paymentAmount || 0), 0),
      };
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        userId: params.actorUserId,
        action: 'customer_bulk_delete',
        resource: 'customer',
        metadata: {
          requestedCount: params.customerIds.length,
          deletedCount: deleted.count,
          deletedIds: customerIds,
          deletedIncomeCount: incomeIds.length,
          deletedRequestCount: requests.length,
          paymentTotal: perCustomer.reduce((sum, customer) => sum + customer.paymentTotal, 0),
          finalizedMonthsAffected: finalizedMonths.map(({ month }) => getTashkentMonthKey(month)),
          customers: perCustomer,
        },
      },
    });

    return {
      deletedCount: deleted.count,
      deletedIds: customerIds,
      deletedIncomeCount: incomeIds.length,
      deletedRequestCount: requests.length,
      bonusReconcileRequested: finalizedMonths.length > 0,
    };
  }, {
    // Up to 500 customers with their chains; the 5s default is too short.
    maxWait: 15000,
    timeout: 60000,
  });
}
