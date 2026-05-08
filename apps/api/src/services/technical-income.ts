export const TECHNICAL_NEW_SALE_AGREEMENT_AMOUNT = 1;

type TechnicalSaleLike = {
  id: string;
  type?: string | null;
  coursePriceAmount?: number | null;
};

export function isTechnicalNewSale(sale: TechnicalSaleLike): boolean {
  return sale.type === 'new_sale'
    && Number(sale.coursePriceAmount ?? 0) === TECHNICAL_NEW_SALE_AGREEMENT_AMOUNT;
}

export function buildTechnicalSaleIdSet<T extends TechnicalSaleLike>(sales: T[]): Set<string> {
  const saleIds = new Set<string>();
  for (const sale of sales) {
    if (isTechnicalNewSale(sale)) {
      saleIds.add(sale.id);
    }
  }
  return saleIds;
}

export function isRowLinkedToTechnicalSale(params: {
  rowType: string;
  rowId: string;
  relatedDebtIncomeId?: string | null;
  technicalSaleIds: Set<string>;
}): boolean {
  const saleId = params.rowType === 'new_sale' ? params.rowId : params.relatedDebtIncomeId;
  return Boolean(saleId && params.technicalSaleIds.has(saleId));
}
