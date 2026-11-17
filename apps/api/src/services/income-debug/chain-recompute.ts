import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

export function parseSnapshotDate(value: string | null): Date | null {
  if (!value) return null;
  const raw = String(value).trim();

  if (!raw) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : raw.slice(0, 10);
  const parsed = new Date(`${iso}T12:00:00+05:00`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Which chain row becomes the sale after a recompute:
 * - `earliest`: the earliest row by entry date, then creation time (repair "recompute").
 * - `earlier-repayment-only`: a repayment only when its entry date is strictly before the sale's;
 *   otherwise the sale stays (repair "full recompute" and relink). This variant also ignores a negative
 *   first payment when it computes the opening debt.
 */
export type SaleChainCanonicalRule = 'earliest' | 'earlier-repayment-only';

/**
 * Re-derives a sale chain inside `tx`: picks the canonical sale row, recomputes the rolling debt of
 * every repayment, and refreshes the customer's profile course/tariff from the latest active sale.
 */
export async function recomputeSaleChainState(tx: Prisma.TransactionClient, params: {
  tenantId: string;
  saleId: string;
  canonicalRule?: SaleChainCanonicalRule;
}): Promise<{ canonicalSaleId: string; reorderedIncomeIds: string[]; didReorder: boolean }> {
  const sourceSale = await tx.income.findFirst({
    where: {
      id: params.saleId,
      tenantId: params.tenantId,
      type: 'new_sale',
      lifecycleStatus: 'active',
    },
    select: {
      id: true,
      customerId: true,
      managerUserId: true,
      courseId: true,
      tariffId: true,
      entryDate: true,
      createdAt: true,
      deadline: true,
      coursePriceAmount: true,
      debtAmount: true,
      paymentAmount: true,
      legacyImportMeta: true,
    },
  });

  if (!sourceSale) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Aktiv yangi sotuv topilmadi.',
    });
  }

  const repayments = await tx.income.findMany({
    where: {
      tenantId: params.tenantId,
      type: 'repayment',
      lifecycleStatus: 'active',
      relatedDebtIncomeId: sourceSale.id,
    },
    select: {
      id: true,
      entryDate: true,
      createdAt: true,
      deadline: true,
      paymentAmount: true,
    },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
  });

  const chain = [
    {
      id: sourceSale.id,
      type: 'new_sale' as const,
      entryDate: sourceSale.entryDate,
      createdAt: sourceSale.createdAt,
      deadline: sourceSale.deadline,
      paymentAmount: Number(sourceSale.paymentAmount || 0),
    },
    ...repayments.map((repayment) => ({
      id: repayment.id,
      type: 'repayment' as const,
      entryDate: repayment.entryDate,
      createdAt: repayment.createdAt,
      deadline: repayment.deadline,
      paymentAmount: Number(repayment.paymentAmount || 0),
    })),
  ].sort((left, right) => {
    const byDate = left.entryDate.getTime() - right.entryDate.getTime();

    if (byDate !== 0) {
      return byDate;
    }

    return left.createdAt.getTime() - right.createdAt.getTime();
  });

  const earliestRow = chain[0]!;
  const keepSourceSale = params.canonicalRule === 'earlier-repayment-only' && !(
    earliestRow.id !== sourceSale.id
    && earliestRow.type === 'repayment'
    && earliestRow.entryDate.getTime() < sourceSale.entryDate.getTime()
  );
  const canonicalSaleId = keepSourceSale ? sourceSale.id : earliestRow.id;
  const firstPayment = params.canonicalRule === 'earlier-repayment-only'
    ? Math.max(Number(earliestRow.paymentAmount || 0), 0)
    : earliestRow.paymentAmount;
  const agreementAmount = Number(sourceSale.coursePriceAmount ?? sourceSale.debtAmount ?? 0);
  let rollingDebt = Math.max(agreementAmount - firstPayment, 0);

  await tx.income.update({
    where: { id: canonicalSaleId },
    data: {
      type: 'new_sale',
      relatedDebtIncomeId: null,
      managerUserId: sourceSale.managerUserId,
      courseId: sourceSale.courseId,
      tariffId: sourceSale.tariffId,
      coursePriceAmount: agreementAmount,
      debtAmount: agreementAmount,
      remainingDebtAmount: rollingDebt,
      deadline: rollingDebt > 0 ? sourceSale.deadline : null,
      legacyImportMeta: sourceSale.legacyImportMeta ?? Prisma.JsonNull,
    },
  });

  for (const repayment of chain.slice(1)) {
    const debtAmount = rollingDebt;

    rollingDebt = Math.max(debtAmount - repayment.paymentAmount, 0);

    await tx.income.update({
      where: { id: repayment.id },
      data: {
        type: 'repayment',
        relatedDebtIncomeId: canonicalSaleId,
        courseId: sourceSale.courseId,
        tariffId: sourceSale.tariffId,
        coursePriceAmount: null,
        debtAmount,
        remainingDebtAmount: rollingDebt,
        legacyImportMeta: Prisma.JsonNull,
      },
    });
  }

  await refreshCustomerProfileFromLatestActiveSaleForDebug(tx, {
    tenantId: params.tenantId,
    customerId: sourceSale.customerId,
  });

  return {
    canonicalSaleId,
    reorderedIncomeIds: chain.map((row) => row.id),
    didReorder: canonicalSaleId !== sourceSale.id,
  };
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
