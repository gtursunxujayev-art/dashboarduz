/**
 * Query building blocks shared by the course-sales procedures (by course and by course type).
 * Each procedure differs only in the filter it passes in; the queries and the arithmetic live here.
 */
import type { DbClient } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';

import { buildActiveSaleChainMetrics, INCOME_LIFECYCLE_ACTIVE, type SaleChainSaleRow } from '../income-chain';

import { buildTechnicalSaleIdSetByAgreement, findSaleIdsBySubTariff } from './helpers';

export type SaleFilter = Record<string, unknown>;

/**
 * The `AND` filters for the course-sales queries: one course (or, with `categoryCourseIds`, every
 * course of a category), an optional tariff, and an optional sub-tariff resolved to sale ids.
 * A `courseId` outside `categoryCourseIds` is rejected.
 */
export async function buildCourseSaleFilters(params: {
  db: DbClient;
  tenantId: string;
  courseId?: string;
  categoryCourseIds?: string[];
  tariffId?: string;
  subTariffId?: string;
}): Promise<SaleFilter[]> {
  const filters: SaleFilter[] = [];

  if (params.courseId) {
    if (params.categoryCourseIds && !params.categoryCourseIds.includes(params.courseId)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Kurs tanlangan turga tegishli emas.' });
    }
    filters.push({ courseId: params.courseId });
  } else if (params.categoryCourseIds) {
    filters.push({ courseId: { in: params.categoryCourseIds } });
  }
  if (params.tariffId) {
    filters.push({ tariffId: params.tariffId });
  }
  if (params.subTariffId) {
    filters.push({
      id: { in: await findSaleIdsBySubTariff(params.tenantId, params.subTariffId, [...filters], params.db) },
    });
  }

  return filters;
}

/** Ids of the tenant's active courses in `category`. */
export async function findCategoryCourseIds(db: DbClient, tenantId: string, category: string): Promise<string[]> {
  const courses = await db.course.findMany({
    where: { tenantId, isActive: true, category },
    select: { id: true },
  });

  return courses.map((course) => course.id);
}

/** `where` for active new sales, scoped to one agent when `scopedManagerUserId` is set. */
export function activeSalesWhere(params: {
  tenantId: string;
  scopedManagerUserId?: string;
  filters?: SaleFilter[];
  extra?: SaleFilter;
}) {
  const filters = params.filters ?? [];

  return {
    tenantId: params.tenantId,
    type: 'new_sale',
    lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
    ...(params.scopedManagerUserId ? { managerUserId: params.scopedManagerUserId } : {}),
    ...(filters.length ? { AND: filters } : {}),
    ...(params.extra ?? {}),
  };
}

type TechnicalSplitSale = SaleChainSaleRow & { type?: string | null };

/**
 * Chain metrics for `sales`, and the sales split into technical (1 so'm agreement, counted as service
 * exchange) and real ones. `chainMetricsBySaleId` holds the real sales only.
 */
export async function splitTechnicalSales<T extends TechnicalSplitSale>(params: {
  db: DbClient;
  tenantId: string;
  sales: T[];
}) {
  const allChainMetricsBySaleId = await buildActiveSaleChainMetrics({
    tenantId: params.tenantId,
    sales: params.sales,
    db: params.db,
  });
  const technicalSaleIds = buildTechnicalSaleIdSetByAgreement({
    sales: params.sales,
    chainMetricsBySaleId: allChainMetricsBySaleId,
  });
  const nonTechnicalSales = params.sales.filter((sale) => !technicalSaleIds.has(sale.id));
  const nonTechnicalSaleIdSet = new Set(nonTechnicalSales.map((sale) => sale.id));
  const chainMetricsBySaleId = new Map(
    Array.from(allChainMetricsBySaleId.entries()).filter(([saleId]) => nonTechnicalSaleIdSet.has(saleId)),
  );

  return { technicalSaleIds, nonTechnicalSales, nonTechnicalSaleIdSet, chainMetricsBySaleId };
}

type ChainPaymentRow = { id: string; relatedDebtIncomeId: string | null; paymentAmount: number | null };

/** Payments summed per sale: a row counts for its `relatedDebtIncomeId`, or itself; other sales are skipped. */
export function sumPaymentsBySale(incomes: ChainPaymentRow[], saleIds: ReadonlySet<string>): Map<string, number> {
  const totals = new Map<string, number>();

  for (const income of incomes) {
    const saleId = income.relatedDebtIncomeId || income.id;

    if (!saleIds.has(saleId)) {
      continue;
    }
    totals.set(saleId, (totals.get(saleId) ?? 0) + (income.paymentAmount ?? 0));
  }

  return totals;
}

/** Payments on `saleIds` (the sales and their debt repayments): inside the range, and all time. */
export async function loadSalePaymentTotals(params: {
  db: DbClient;
  tenantId: string;
  saleIds: string[];
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<{ rangeIncomeBySaleId: Map<string, number>; currentIncomeBySaleId: Map<string, number> }> {
  if (params.saleIds.length === 0) {
    return { rangeIncomeBySaleId: new Map(), currentIncomeBySaleId: new Map() };
  }

  const where = {
    tenantId: params.tenantId,
    lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
    OR: [
      { id: { in: params.saleIds } },
      { relatedDebtIncomeId: { in: params.saleIds } },
    ],
  };
  const select = { id: true, relatedDebtIncomeId: true, paymentAmount: true };
  const [rangeIncomes, allIncomes] = await Promise.all([
    params.db.income.findMany({
      where: { ...where, tenantId: params.tenantId, entryDate: { gte: params.rangeStart, lte: params.rangeEnd } },
      select,
    }),
    params.db.income.findMany({ where: { ...where, tenantId: params.tenantId }, select }),
  ]);
  const saleIdSet = new Set(params.saleIds);

  return {
    rangeIncomeBySaleId: sumPaymentsBySale(rangeIncomes, saleIdSet),
    currentIncomeBySaleId: sumPaymentsBySale(allIncomes, saleIdSet),
  };
}

/** `range`/`dateFrom`/`dateTo` echoed back: the dates only for a custom range. */
export function echoReportRange<R extends string>(input: { range: R; dateFrom?: string; dateTo?: string }) {
  return {
    range: input.range,
    dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
    dateTo: input.range === 'custom' ? input.dateTo || null : null,
  };
}
