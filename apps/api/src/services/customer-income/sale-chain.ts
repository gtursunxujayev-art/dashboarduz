import type { DbClient } from '@dashboarduz/db';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { logger } from '../../lib/logger';
import { reconcileFinalizedBonusMonths } from '../bonus-engine';
import { evaluateSaleChainConsistency, extractSaleSubTariffId, getSaleAgreementAmount, INCOME_LIFECYCLE_ACTIVE, SALE_SUB_TARIFF_META_KEY } from '../income-chain';

export function withSaleSubTariffMeta(
  existingMeta: Prisma.JsonValue | null | undefined,
  subTariffId: string | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  const nextMeta: Record<string, unknown> = (
    existingMeta
    && typeof existingMeta === 'object'
    && !Array.isArray(existingMeta)
  )
    ? { ...(existingMeta as Record<string, unknown>) }
    : {};

  if (subTariffId) {
    nextMeta[SALE_SUB_TARIFF_META_KEY] = subTariffId;
  } else {
    delete nextMeta[SALE_SUB_TARIFF_META_KEY];
  }

  return Object.keys(nextMeta).length > 0 ? (nextMeta as Prisma.InputJsonValue) : Prisma.JsonNull;
}

export async function refreshCustomerProfileFromLatestActiveSale(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    customerId: string;
  },
): Promise<void> {
  const latestActiveSale = await tx.income.findFirst({
    where: {
      tenantId: params.tenantId,
      customerId: params.customerId,
      type: 'new_sale',
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
    },
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      courseId: true,
      tariffId: true,
    },
  });

  if (!latestActiveSale) {
    await tx.customer.update({
      where: { id: params.customerId },
      data: {
        profileCourseId: null,
        profileTariffId: null,
        profileSubTariffId: null,
      },
    });

    return;
  }

  let nextSubTariffId: string | null = null;

  if (latestActiveSale.tariffId) {
    const customer = await tx.customer.findUnique({
      where: { id: params.customerId },
      select: { profileSubTariffId: true },
    });

    if (customer?.profileSubTariffId) {
      const subTariff = await tx.subTariff.findFirst({
        where: {
          tenantId: params.tenantId,
          id: customer.profileSubTariffId,
          tariffId: latestActiveSale.tariffId,
          isActive: true,
        },
        select: { id: true },
      });

      nextSubTariffId = subTariff?.id || null;
    }
  }

  await tx.customer.update({
    where: { id: params.customerId },
    data: {
      profileCourseId: latestActiveSale.courseId ?? null,
      profileTariffId: latestActiveSale.tariffId ?? null,
      profileSubTariffId: nextSubTariffId,
    },
  });
}

export async function normalizeSaleChainChronology(tx: Prisma.TransactionClient, params: {
  tenantId: string;
  saleId: string;
}): Promise<{ didReorder: boolean; canonicalSaleId: string; reorderedIncomeIds: string[] }> {
  const sourceSale = await tx.income.findFirst({
    where: {
      id: params.saleId,
      tenantId: params.tenantId,
      type: 'new_sale',
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
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
      legacyImportMeta: true,
      paymentAmount: true,
    },
  });

  if (!sourceSale) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Source sale not found for chronology normalization.',
    });
  }

  const activeRepayments = await tx.income.findMany({
    where: {
      tenantId: params.tenantId,
      type: 'repayment',
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      relatedDebtIncomeId: sourceSale.id,
    },
    select: {
      id: true,
      managerUserId: true,
      entryDate: true,
      createdAt: true,
      deadline: true,
      paymentAmount: true,
    },
  });

  if (activeRepayments.length === 0) {
    return {
      didReorder: false,
      canonicalSaleId: sourceSale.id,
      reorderedIncomeIds: [],
    };
  }

  const chain = [
    {
      ...sourceSale,
      type: 'new_sale' as const,
    },
    ...activeRepayments.map((repayment) => ({
      ...repayment,
      type: 'repayment' as const,
    })),
  ].sort((a, b) => {
    const byDate = a.entryDate.getTime() - b.entryDate.getTime();

    if (byDate !== 0) {
      return byDate;
    }

    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const earliestRow = chain[0]!;
  const shouldReorder = (
    earliestRow.id !== sourceSale.id
    && earliestRow.type === 'repayment'
    && earliestRow.entryDate.getTime() < sourceSale.entryDate.getTime()
  );

  if (!shouldReorder) {
    return {
      didReorder: false,
      canonicalSaleId: sourceSale.id,
      reorderedIncomeIds: [],
    };
  }

  const sourceSaleSubTariffId = extractSaleSubTariffId(sourceSale.legacyImportMeta);
  const preservedSaleMeta = withSaleSubTariffMeta(sourceSale.legacyImportMeta, sourceSaleSubTariffId);
  const sourceAgreementAmount = Number(sourceSale.coursePriceAmount ?? sourceSale.debtAmount ?? 0);
  const totalPaid = chain.reduce((sum, row) => sum + Math.max(Number(row.paymentAmount || 0), 0), 0);
  const agreementAmount = sourceAgreementAmount > 0 ? sourceAgreementAmount : totalPaid;
  const canonicalSaleId = earliestRow.id;

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
      legacyImportMeta: preservedSaleMeta,
    },
  });

  for (const repayment of chain.slice(1)) {
    const debtAmount = rollingDebt;

    rollingDebt = Math.max(debtAmount - Math.max(Number(repayment.paymentAmount || 0), 0), 0);

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

  await refreshCustomerProfileFromLatestActiveSale(tx, {
    tenantId: params.tenantId,
    customerId: sourceSale.customerId,
  });

  return {
    didReorder: true,
    canonicalSaleId,
    reorderedIncomeIds: chain.map((row) => row.id),
  };
}

export async function reconcileBonusAfterIncomeChange(
  tenantId: string,
  actorUserId: string,
  context: Record<string, unknown>,
  db: DbClient,
): Promise<void> {
  try {
    await reconcileFinalizedBonusMonths({ tenantId, actorUserId, db });
  } catch (error) {
    logger.error({
      tenantId,
      ...context,
      error: String((error as any)?.message || error),
    }, '[Bonus] Finalized month reconciliation failed after income change');
  }
}

export async function assertSaleChainDebtInvariant(tx: Prisma.TransactionClient, params: {
  tenantId: string;
  saleId: string;
}): Promise<void> {
  const recomputeSaleChainDebtFields = async (saleId: string) => {
    const sourceSale = await tx.income.findFirst({
      where: {
        id: saleId,
        tenantId: params.tenantId,
        type: 'new_sale',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      },
      select: {
        id: true,
        paymentAmount: true,
        coursePriceAmount: true,
        debtAmount: true,
        deadline: true,
      },
    });

    if (!sourceSale) {
      return false;
    }

    const repayments = await tx.income.findMany({
      where: {
        tenantId: params.tenantId,
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        type: 'repayment',
        relatedDebtIncomeId: sourceSale.id,
      },
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        paymentAmount: true,
      },
    });

    const agreementAmount = getSaleAgreementAmount(sourceSale);
    let rollingDebt = Math.max(agreementAmount - Math.max(Number(sourceSale.paymentAmount || 0), 0), 0);

    for (const repayment of repayments) {
      const debtAmount = rollingDebt;

      rollingDebt = Math.max(debtAmount - Math.max(Number(repayment.paymentAmount || 0), 0), 0);
      await tx.income.update({
        where: { id: repayment.id },
        data: {
          debtAmount,
          remainingDebtAmount: rollingDebt,
          relatedDebtIncomeId: sourceSale.id,
        },
      });
    }

    await tx.income.update({
      where: { id: sourceSale.id },
      data: {
        debtAmount: agreementAmount,
        remainingDebtAmount: rollingDebt,
        deadline: rollingDebt > 0 ? sourceSale.deadline : null,
      },
    });

    return true;
  };

  const loadConsistency = async (saleId: string) => {
    const sale = await tx.income.findFirst({
      where: {
        id: saleId,
        tenantId: params.tenantId,
        type: 'new_sale',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      },
      select: {
        id: true,
        coursePriceAmount: true,
        debtAmount: true,
        paymentAmount: true,
      },
    });

    if (!sale) {
      return null;
    }

    const chainRows = await tx.income.findMany({
      where: {
        tenantId: params.tenantId,
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        OR: [
          { id: sale.id },
          { relatedDebtIncomeId: sale.id },
        ],
      },
      select: {
        id: true,
        type: true,
        relatedDebtIncomeId: true,
        paymentAmount: true,
        entryDate: true,
        createdAt: true,
        debtAmount: true,
        remainingDebtAmount: true,
      },
    });
    const agreementAmount = getSaleAgreementAmount(sale);
    const consistency = evaluateSaleChainConsistency({
      saleId: sale.id,
      agreementAmount,
      chainRows,
    });

    return { sale, consistency };
  };

  let loaded = await loadConsistency(params.saleId);

  if (!loaded) {
    return;
  }
  let { sale, consistency } = loaded;

  if (!consistency.ok) {
    const shouldAutoRepair = consistency.issues.some((issue) => (
      issue === 'sale_debt_amount_mismatch'
      || issue === 'sale_remaining_mismatch'
      || issue === 'repayment_debt_amount_mismatch'
      || issue === 'repayment_remaining_mismatch'
    ));

    let repaired = false;

    if (shouldAutoRepair) {
      repaired = await recomputeSaleChainDebtFields(sale.id);
      if (repaired) {
        loaded = await loadConsistency(sale.id);
        if (loaded) {
          sale = loaded.sale;
          consistency = loaded.consistency;
        }
      }
    }

    if (consistency.ok) {
      return;
    }

    const invariantDebug = {
      saleId: sale.id,
      expectedDebt: consistency.expectedCurrentDebtAmount,
      storedSaleDebt: consistency.actualSaleRemainingDebtAmount,
      chainRows: consistency.chainLength,
      repaired,
    };

    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `Debt invariant mismatch after mutation: ${consistency.issues.join(', ')} | debug=${JSON.stringify(invariantDebug)}`,
    });
  }
}
