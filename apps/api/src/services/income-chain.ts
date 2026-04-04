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
};

export type SaleChainMetrics = {
  agreementAmount: number;
  paidAmount: number;
  currentDebtAmount: number;
  lastActivityAt: Date;
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

