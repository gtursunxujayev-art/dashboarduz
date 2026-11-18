import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { assertSaleChainDebtInvariant, normalizeSaleChainChronology, refreshCustomerProfileFromLatestActiveSale } from '../customer-income/sale-chain';

export function parseSnapshotDate(value: string | null): Date | null {
  if (!value) return null;
  const raw = String(value).trim();

  if (!raw) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : raw.slice(0, 10);
  const parsed = new Date(`${iso}T12:00:00+05:00`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Re-derives a sale chain inside `tx` with the same rules as every money write (services/customer-income/sale-chain):
 * a repayment dated strictly before the sale becomes the sale (`normalizeSaleChainChronology`), rows with equal
 * dates keep the sale first and then sort by creation time and id, and every stored debt is re-derived so the sale
 * holds the debt left after the whole chain (`assertSaleChainDebtInvariant`, which throws if the chain still does not
 * add up). Finally refreshes the customer's profile course/tariff from the latest active sale.
 */
export async function recomputeSaleChainState(tx: Prisma.TransactionClient, params: {
  tenantId: string;
  saleId: string;
}): Promise<{ canonicalSaleId: string; reorderedIncomeIds: string[]; didReorder: boolean }> {
  const sale = await tx.income.findFirst({
    where: { id: params.saleId, tenantId: params.tenantId, type: 'new_sale', lifecycleStatus: 'active' },
    select: { id: true, customerId: true },
  });

  if (!sale) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Aktiv yangi sotuv topilmadi.',
    });
  }

  const normalized = await normalizeSaleChainChronology(tx, params);

  await assertSaleChainDebtInvariant(tx, { tenantId: params.tenantId, saleId: normalized.canonicalSaleId });
  await refreshCustomerProfileFromLatestActiveSale(tx, { tenantId: params.tenantId, customerId: sale.customerId });

  return normalized;
}

export async function refreshCustomerProfileFromLatestActiveSaleForDebug(tx: Prisma.TransactionClient, params: {
  tenantId: string;
  customerId: string;
}) {
  const latestActiveSale = await tx.income.findFirst({
    where: {
      tenantId: params.tenantId,
      customerId: params.customerId,
      type: 'new_sale',
      lifecycleStatus: 'active',
    },
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      courseId: true,
      tariffId: true,
    },
  });

  await tx.customer.update({
    where: { id: params.customerId },
    data: {
      profileCourseId: latestActiveSale?.courseId ?? null,
      profileTariffId: latestActiveSale?.tariffId ?? null,
    },
  });
}
