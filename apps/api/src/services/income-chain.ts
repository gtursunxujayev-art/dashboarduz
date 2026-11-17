import type { DbClient } from '@dashboarduz/db';

export type SaleChainSaleRow = {
  id: string;
  entryDate: Date;
  coursePriceAmount?: number | null;
  debtAmount?: number | null;
  paymentAmount?: number | null;
};

export type SaleChainPaymentRow = {
  id: string;
  relatedDebtIncomeId?: string | null;
  paymentAmount?: number | null;
  entryDate: Date;
  createdAt?: Date;
  type?: string | null;
  debtAmount?: number | null;
  remainingDebtAmount?: number | null;
};

export type SaleChainMetrics = {
  agreementAmount: number;
  paidAmount: number;
  currentDebtAmount: number;
  lastActivityAt: Date;
};

export type SaleChainConsistencyResult = {
  ok: boolean;
  expectedCurrentDebtAmount: number;
  actualSaleRemainingDebtAmount: number;
  chainLength: number;
  issues: string[];
};

function toAmount(value: number | null | undefined): number {
  return Math.max(Number(value || 0), 0);
}

export function getSaleAgreementAmount(sale: {
  coursePriceAmount?: number | null;
  debtAmount?: number | null;
  paymentAmount?: number | null;
}): number {
  return toAmount(sale.coursePriceAmount ?? sale.debtAmount ?? sale.paymentAmount ?? 0);
}

export function buildSaleChainMetricsBySaleId(params: {
  sales: SaleChainSaleRow[];
  chainRows: SaleChainPaymentRow[];
}): Map<string, SaleChainMetrics> {
  const metricsBySaleId = new Map<string, SaleChainMetrics>();

  for (const sale of params.sales) {
    metricsBySaleId.set(sale.id, {
      agreementAmount: getSaleAgreementAmount(sale),
      paidAmount: 0,
      currentDebtAmount: 0,
      lastActivityAt: sale.entryDate,
    });
  }

  for (const income of params.chainRows) {
    const saleId = income.relatedDebtIncomeId || income.id;
    const current = metricsBySaleId.get(saleId);

    if (!current) {
      continue;
    }
    current.paidAmount += toAmount(income.paymentAmount);
    if (income.entryDate > current.lastActivityAt) {
      current.lastActivityAt = income.entryDate;
    }
  }

  for (const metric of metricsBySaleId.values()) {
    metric.currentDebtAmount = Math.max(metric.agreementAmount - metric.paidAmount, 0);
  }

  return metricsBySaleId;
}

export function evaluateSaleChainConsistency(params: {
  saleId: string;
  agreementAmount: number;
  chainRows: SaleChainPaymentRow[];
  tolerance?: number;
}): SaleChainConsistencyResult {
  const tolerance = params.tolerance ?? 0.0001;
  const issues: string[] = [];
  const chain = [...params.chainRows].sort((left, right) => {
    const byDate = left.entryDate.getTime() - right.entryDate.getTime();

    if (byDate !== 0) {
      return byDate;
    }
    const leftCreated = left.createdAt ? left.createdAt.getTime() : left.entryDate.getTime();
    const rightCreated = right.createdAt ? right.createdAt.getTime() : right.entryDate.getTime();

    return leftCreated - rightCreated;
  });

  if (chain.length === 0) {
    return {
      ok: false,
      expectedCurrentDebtAmount: Math.max(params.agreementAmount, 0),
      actualSaleRemainingDebtAmount: 0,
      chainLength: 0,
      issues: ['empty_chain'],
    };
  }

  const first = chain[0]!;

  if (first.id !== params.saleId) {
    issues.push('chronology_mismatch');
  }
  if (first.type && first.type !== 'new_sale') {
    issues.push('sale_type_mismatch');
  }
  if (first.relatedDebtIncomeId) {
    issues.push('sale_link_mismatch');
  }

  let rollingDebt = Math.max(params.agreementAmount - toAmount(first.paymentAmount), 0);

  if (first.debtAmount !== null && first.debtAmount !== undefined) {
    const firstDebtAmount = toAmount(first.debtAmount);

    if (Math.abs(firstDebtAmount - Math.max(params.agreementAmount, 0)) > tolerance) {
      issues.push('sale_debt_amount_mismatch');
    }
  }

  for (const repayment of chain.slice(1)) {
    if (repayment.type && repayment.type !== 'repayment') {
      issues.push('repayment_type_mismatch');
    }
    if (repayment.relatedDebtIncomeId !== params.saleId) {
      issues.push('repayment_link_mismatch');
    }

    const expectedDebtBeforePayment = rollingDebt;
    const storedDebtBeforePayment = toAmount(repayment.debtAmount);

    if (
      repayment.debtAmount !== null
      && repayment.debtAmount !== undefined
      && Math.abs(storedDebtBeforePayment - expectedDebtBeforePayment) > tolerance
    ) {
      issues.push('repayment_debt_amount_mismatch');
    }

    rollingDebt = Math.max(expectedDebtBeforePayment - toAmount(repayment.paymentAmount), 0);
    const storedRemaining = toAmount(repayment.remainingDebtAmount);

    if (Math.abs(storedRemaining - rollingDebt) > tolerance) {
      issues.push('repayment_remaining_mismatch');
    }
  }

  // In this project, new_sale.remainingDebtAmount is persisted as current chain debt
  // (after all active repayments), not only after first payment.
  const currentSaleRemaining = toAmount(first.remainingDebtAmount);

  if (Math.abs(currentSaleRemaining - rollingDebt) > tolerance) {
    issues.push('sale_remaining_mismatch');
  }

  return {
    ok: issues.length === 0,
    expectedCurrentDebtAmount: rollingDebt,
    actualSaleRemainingDebtAmount: currentSaleRemaining,
    chainLength: chain.length,
    issues: Array.from(new Set(issues)),
  };
}

export const INCOME_LIFECYCLE_ACTIVE = 'active';
export const INCOME_LIFECYCLE_PENDING_REFUND = 'pending_refund';
export const INCOME_LIFECYCLE_REFUNDED = 'refunded';

/** Key in `Income.legacyImportMeta` that records the sub-tariff chosen for a sale. */
export const SALE_SUB_TARIFF_META_KEY = 'saleSubTariffId';

/** The sub-tariff id stored in a sale's meta JSON, trimmed, or `null`. */
export function extractSaleSubTariffId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }
  const candidate = (meta as Record<string, unknown>)[SALE_SUB_TARIFF_META_KEY];

  if (typeof candidate !== 'string') {
    return null;
  }
  const normalized = candidate.trim();

  return normalized.length > 0 ? normalized : null;
}

/** Chain metrics (agreement, paid, debt, last activity) per sale, from the sale and its active debt payments. */
export async function buildActiveSaleChainMetrics(params: {
  tenantId: string;
  sales: SaleChainSaleRow[];
  db: DbClient;
}) {
  const { db } = params;

  if (params.sales.length === 0) {
    return new Map<string, SaleChainMetrics>();
  }

  const saleIds = params.sales.map((sale) => sale.id);
  const chainRows = await db.income.findMany({
    where: {
      tenantId: params.tenantId,
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      OR: [
        { id: { in: saleIds } },
        { relatedDebtIncomeId: { in: saleIds } },
      ],
    },
    select: {
      id: true,
      relatedDebtIncomeId: true,
      paymentAmount: true,
      entryDate: true,
    },
  });

  return buildSaleChainMetricsBySaleId({
    sales: params.sales,
    chainRows,
  });
}

/** A sale's active chain rows (the sale and its repayments) and whether their debts add up. */
export async function loadSaleChainConsistency(db: DbClient, tenantId: string, sale: {
  id: string;
  coursePriceAmount?: number | null;
  debtAmount?: number | null;
  paymentAmount?: number | null;
}) {
  const chainRows = await db.income.findMany({
    where: {
      tenantId,
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

  return { agreementAmount, chainRows, consistency };
}
