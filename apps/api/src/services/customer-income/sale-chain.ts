import type { DbClient, TenantPrismaClient } from '@dashboarduz/db';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { thrownText } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { reconcileFinalizedBonusMonths } from '../bonus-engine';
import { extractSaleSubTariffId, getSaleAgreementAmount, INCOME_LIFECYCLE_ACTIVE, loadSaleChainConsistency, SALE_SUB_TARIFF_META_KEY, saleChainOrder } from '../income-chain';

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

/**
 * Puts a sale chain in date order. Only a repayment dated strictly before the sale becomes the new sale; on equal
 * dates the sale stays the sale. Rewrites the debts of the reordered chain; callers then run
 * `assertSaleChainDebtInvariant` on the canonical sale.
 */
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
  ].sort(saleChainOrder(sourceSale.id));

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

  // The old sale is a repayment now: order the rest as the new sale's chain.
  const repaymentsInOrder = chain.slice(1).sort(saleChainOrder(canonicalSaleId));

  for (const repayment of repaymentsInOrder) {
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

  // The sale stores the debt left after the whole chain, not just after its own payment.
  await tx.income.update({
    where: { id: canonicalSaleId },
    data: { remainingDebtAmount: rollingDebt, deadline: rollingDebt > 0 ? sourceSale.deadline : null },
  });

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

/**
 * Locks a sale and every row of its chain (`SELECT ... FOR UPDATE`) until the surrounding transaction ends.
 *
 * Every write that reads a chain's debt or status and then changes it calls this first, inside the same
 * transaction, before reading. Two concurrent writers on one chain then run one after the other, and the second
 * one reads what the first committed (READ COMMITTED takes a fresh snapshot per statement). Rows are locked in id
 * order so concurrent lockers of the same chain cannot deadlock. Returns the locked ids (empty: no such sale).
 */
export async function lockSaleChain(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; saleId: string },
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM incomes
    WHERE "tenantId" = ${params.tenantId}
      AND (id = ${params.saleId} OR "relatedDebtIncomeId" = ${params.saleId})
    ORDER BY id
    FOR UPDATE`;

  return rows.map((row) => row.id);
}

type SaleChainStateRow = {
  id: string;
  paymentAmount: number;
  coursePriceAmount: number | null;
  debtAmount: number | null;
  remainingDebtAmount: number;
  lifecycleStatus: string;
};

/**
 * The money fields of every row of a chain, in id order. A write that computes new amounts before its
 * transaction reads this first and passes it to `lockSaleChainUnchanged` inside the transaction.
 */
export async function readSaleChainState(
  db: DbClient,
  params: { tenantId: string; saleId: string },
): Promise<SaleChainStateRow[]> {
  return db.income.findMany({
    where: { tenantId: params.tenantId, OR: [{ id: params.saleId }, { relatedDebtIncomeId: params.saleId }] },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      paymentAmount: true,
      coursePriceAmount: true,
      debtAmount: true,
      remainingDebtAmount: true,
      lifecycleStatus: true,
    },
  });
}

/**
 * Locks the chain and fails with CONFLICT if any of its money fields changed since `expected` was read, so a
 * write computed from that state is never applied on top of a concurrent change. The caller asks the user to retry.
 */
export async function lockSaleChainUnchanged(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; saleId: string; expected: SaleChainStateRow[] },
): Promise<void> {
  await lockSaleChain(tx, params);
  const current = await readSaleChainState(tx, params);

  if (JSON.stringify(current) !== JSON.stringify(params.expected)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: "Bu yozuv hozirgina boshqa foydalanuvchi tomonidan o'zgartirildi. Sahifani yangilab, qayta urinib ko'ring.",
    });
  }
}

/** True when `row` still has the money fields recorded for it in `state` (used to check a row read separately). */
export function rowMatchesSaleChainState(
  state: SaleChainStateRow[],
  row: Omit<SaleChainStateRow, 'id'> & { id: string },
): boolean {
  const recorded = state.find((entry) => entry.id === row.id);

  return recorded !== undefined
    && recorded.paymentAmount === row.paymentAmount
    && recorded.coursePriceAmount === row.coursePriceAmount
    && recorded.debtAmount === row.debtAmount
    && recorded.remainingDebtAmount === row.remainingDebtAmount
    && recorded.lifecycleStatus === row.lifecycleStatus;
}

/**
 * Inside a money transaction: records that this tenant's finalized bonus months must be reconciled. The marker commits
 * (or rolls back) with the money change, so the reconcile it asks for cannot be lost to a crash or a failed reconcile
 * after the commit: `reconcileBonusAfterIncomeChange` clears it on success, the bonus reconcile sweeper retries it.
 */
export async function requestBonusReconcile(tx: Prisma.TransactionClient, tenantId: string, reason: string): Promise<void> {
  await tx.bonusReconcileRequest.create({ data: { tenantId, reason } });
}

/**
 * Runs the reconciliation the tenant's open markers ask for and clears exactly those markers. On failure the markers
 * stay, with the attempt and error recorded, for the sweeper to retry; the money change itself is already committed.
 * Returns false when the reconcile failed.
 */
export async function runRequestedBonusReconcile(params: {
  tenantId: string;
  actorUserId: string | null;
  context: Record<string, unknown>;
  db: TenantPrismaClient;
}): Promise<boolean> {
  const { tenantId, db } = params;
  const requests = await db.bonusReconcileRequest.findMany({ where: { tenantId }, select: { id: true } });

  if (!requests.length) return true;
  const ids = requests.map((request) => request.id);

  try {
    await reconcileFinalizedBonusMonths({ tenantId, actorUserId: params.actorUserId, db });
    await db.bonusReconcileRequest.deleteMany({ where: { tenantId, id: { in: ids } } });

    return true;
  } catch (error) {
    const message = thrownText(error);

    logger.error({ tenantId, ...params.context, error: message }, '[Bonus] Finalized month reconciliation failed; queued for retry');
    await db.bonusReconcileRequest.updateMany({
      where: { tenantId, id: { in: ids } },
      data: { attempts: { increment: 1 }, lastError: message.slice(0, 2000), lastAttemptAt: new Date() },
    }).catch((recordError: unknown) => {
      logger.error({ tenantId, error: thrownText(recordError) }, '[Bonus] Could not record the failed reconcile attempt');
    });

    return false;
  }
}

/** After a committed money change that called `requestBonusReconcile`: reconcile now; a failure is retried later. */
export async function reconcileBonusAfterIncomeChange(
  tenantId: string,
  actorUserId: string,
  context: Record<string, unknown>,
  db: TenantPrismaClient,
): Promise<void> {
  await runRequestedBonusReconcile({ tenantId, actorUserId, context, db });
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
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
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

    const { consistency } = await loadSaleChainConsistency(tx, params.tenantId, sale);

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
