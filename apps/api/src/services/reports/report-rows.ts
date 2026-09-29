export type ReportPersonLike = { id?: string | null; name?: string | null; username?: string | null } | null | undefined;

export function resolvePersonLabel(person: ReportPersonLike, fallback = '-'): string {
  const candidate = person?.name || person?.username || person?.id || null;
  return candidate ? String(candidate) : fallback;
}

// Refund requests may point at a repayment row; money and the first payment belong to its root sale.
export function resolveRootSaleId(income: { id: string; type?: string | null; relatedDebtIncomeId?: string | null }): string {
  if (income.type === 'repayment' && income.relatedDebtIncomeId) {
    return income.relatedDebtIncomeId;
  }
  return income.id;
}

export function computeResponseMinutes(createdAt: Date, reviewedAt: Date | null | undefined): number | null {
  if (!reviewedAt) {
    return null;
  }
  return Math.max(Math.round((reviewedAt.getTime() - createdAt.getTime()) / 60_000), 0);
}

export function selectDebtorSales<T extends { id: string; remainingDebtAmount?: number | null }>(params: {
  sales: T[];
  chainMetricsBySaleId: Map<string, { agreementAmount: number; paidAmount: number; currentDebtAmount: number; lastActivityAt: Date }>;
  technicalSaleIds: Set<string>;
}): Array<{ sale: T; agreementAmount: number; paidAmount: number; debtAmount: number; lastActivityAt: Date | null }> {
  const rows: Array<{ sale: T; agreementAmount: number; paidAmount: number; debtAmount: number; lastActivityAt: Date | null }> = [];
  for (const sale of params.sales) {
    if (params.technicalSaleIds.has(sale.id)) {
      continue;
    }
    const metric = params.chainMetricsBySaleId.get(sale.id);
    const debtAmount = metric?.currentDebtAmount ?? Math.max(Number(sale.remainingDebtAmount ?? 0), 0);
    if (debtAmount <= 0) {
      continue;
    }
    rows.push({
      sale,
      agreementAmount: metric?.agreementAmount ?? 0,
      paidAmount: metric?.paidAmount ?? 0,
      debtAmount,
      lastActivityAt: metric?.lastActivityAt ?? null,
    });
  }
  rows.sort((left, right) => right.debtAmount - left.debtAmount);
  return rows;
}
