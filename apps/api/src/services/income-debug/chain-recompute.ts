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

export async function recomputeSaleChainState(tx: Prisma.TransactionClient, params: {
  tenantId: string;
  saleId: string;
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

  const canonicalRow = chain[0]!;
  const canonicalSaleId = canonicalRow.id;
  const agreementAmount = Number(sourceSale.coursePriceAmount ?? sourceSale.debtAmount ?? 0);
  let rollingDebt = Math.max(agreementAmount - canonicalRow.paymentAmount, 0);

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

  const latestActiveSale = await tx.income.findFirst({
    where: {
      tenantId: params.tenantId,
      customerId: sourceSale.customerId,
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
    where: { id: sourceSale.customerId },
    data: {
      profileCourseId: latestActiveSale?.courseId ?? null,
      profileTariffId: latestActiveSale?.tariffId ?? null,
    },
  });

  return {
    canonicalSaleId,
    reorderedIncomeIds: chain.map((row) => row.id),
    didReorder: canonicalSaleId !== sourceSale.id,
  };
}

export async function recomputeSaleChainStateFully(tx: Prisma.TransactionClient, params: {
  tenantId: string;
  saleId: string;
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
  const shouldReorder = (
    earliestRow.id !== sourceSale.id
    && earliestRow.type === 'repayment'
    && earliestRow.entryDate.getTime() < sourceSale.entryDate.getTime()
  );
  const canonicalSaleId = shouldReorder ? earliestRow.id : sourceSale.id;
  const agreementAmount = Number(sourceSale.coursePriceAmount ?? sourceSale.debtAmount ?? 0);
  let rollingDebt = Math.max(agreementAmount - Math.max(Number(earliestRow.paymentAmount || 0), 0), 0);

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

  const latestActiveSale = await tx.income.findFirst({
    where: {
      tenantId: params.tenantId,
      customerId: sourceSale.customerId,
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
    where: { id: sourceSale.customerId },
    data: {
      profileCourseId: latestActiveSale?.courseId ?? null,
      profileTariffId: latestActiveSale?.tariffId ?? null,
    },
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
