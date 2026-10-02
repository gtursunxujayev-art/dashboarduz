/**
 * Single source of truth for the money "facts" every report, dashboard, leaderboard and bonus screen uses.
 * Do not re-implement these formulas inline; import them from here.
 */
import { prisma } from '@dashboarduz/db';
import { classifyCourseCategoryFromField } from '../trpc/routers/dashboard/helpers';
import { getSaleAgreementAmount } from './income-chain';
import { buildTechnicalSaleIdSet, isRowLinkedToTechnicalSale } from './technical-income';

export { buildTechnicalSaleIdSet, isRowLinkedToTechnicalSale };

export type IncomeCategory = 'online' | 'offline' | 'intensive' | 'additional_service' | 'other';

/** Agreement ("Kelishuv") of a sale: coursePriceAmount, else debtAmount, else the first payment. Never negative. */
export function resolveSaleAgreementAmount(sale: {
  coursePriceAmount?: number | null;
  debtAmount?: number | null;
  paymentAmount?: number | null;
}): number {
  return getSaleAgreementAmount(sale);
}

/** Course category of an income row: the course's category field, falling back to its name. */
export function classifyIncomeCategory(course: { category?: string | null; name?: string | null } | null | undefined): IncomeCategory {
  return classifyCourseCategoryFromField(course?.category || course?.name);
}

type IncomeRowRef = { id: string; type: string; relatedDebtIncomeId?: string | null };

/** The sale a row belongs to: the row itself for a sale, its parent sale for a repayment. */
export function resolveRowSaleId(row: IncomeRowRef): string | null {
  return row.type === 'new_sale' ? row.id : (row.relatedDebtIncomeId ?? null);
}

/**
 * Technical sales (agreement == 1) are bookkeeping entries, not real sales. Loads the technical sale ids
 * among the sales the given rows belong to, so both the sale and its repayments can be excluded.
 */
export async function loadTechnicalSaleIdsForRows(tenantId: string, rows: IncomeRowRef[]): Promise<Set<string>> {
  const saleIds = Array.from(new Set(rows.map(resolveRowSaleId).filter((id): id is string => Boolean(id))));
  if (!saleIds.length) {
    return new Set();
  }
  const sales = await prisma.income.findMany({
    where: { tenantId, id: { in: saleIds }, type: 'new_sale' },
    select: { id: true, type: true, coursePriceAmount: true, debtAmount: true, paymentAmount: true },
  });
  return buildTechnicalSaleIdSet(sales);
}

/** Drops technical sales and repayments linked to them. */
export function excludeTechnicalRows<T extends IncomeRowRef>(rows: T[], technicalSaleIds: Set<string>): T[] {
  if (!technicalSaleIds.size) {
    return rows;
  }
  return rows.filter((row) => !isRowLinkedToTechnicalSale({
    rowType: row.type,
    rowId: row.id,
    relatedDebtIncomeId: row.relatedDebtIncomeId,
    technicalSaleIds,
  }));
}

/**
 * Prisma filter matching sales that are NOT technical (effective agreement != 1), for paginated queries
 * that cannot filter in memory. Mirrors `resolveSaleAgreementAmount(...) === 1`.
 */
export const NON_TECHNICAL_SALE_WHERE = {
  NOT: {
    OR: [
      { coursePriceAmount: 1 },
      { coursePriceAmount: null, debtAmount: 1 },
      { coursePriceAmount: null, debtAmount: null, paymentAmount: 1 },
    ],
  },
};

const SALE_SUB_TARIFF_META_KEY = 'saleSubTariffId';

function extractSaleSubTariffId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const candidate = (meta as Record<string, unknown>)[SALE_SUB_TARIFF_META_KEY];
  if (typeof candidate !== 'string') return null;
  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
}

export type SubTariffResolvableSale = {
  courseId: string | null;
  tariffId: string | null;
  legacyImportMeta: unknown;
  customer: { profileCourseId: string | null; profileTariffId: string | null; profileSubTariffId: string | null } | null;
};

/**
 * A sale's sub-tariff: the one stored on the sale itself, else the customer's profile sub-tariff when the profile
 * still points at this sale's course and tariff. (The profile alone is not enough: it follows the customer's latest course.)
 */
export function resolveSaleSubTariffId(sale: SubTariffResolvableSale): string | null {
  const saleSubTariffId = extractSaleSubTariffId(sale.legacyImportMeta);
  if (saleSubTariffId) return saleSubTariffId;
  const customer = sale.customer;
  if (customer && customer.profileCourseId === sale.courseId && customer.profileTariffId && customer.profileTariffId === sale.tariffId) {
    return customer.profileSubTariffId || null;
  }
  return null;
}
