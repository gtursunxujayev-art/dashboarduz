/**
 * Query building blocks shared by the course-sales procedures (by course and by course type).
 * Each procedure differs only in the filter it passes in; the queries and the arithmetic live here.
 */
import type { DbClient } from '@dashboarduz/db';
import { dateRangeInput, reportRangeSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveCallerDataScope } from '../../lib/access';
import { resolveDateRange } from '../../lib/dates';
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

/**
 * `managerUserId` filter for the caller's data scope (`resolveCallerDataScope().userIds`): nothing for
 * everyone (`null` / `undefined`), otherwise only those managers' sales.
 */
export function managerScopeWhere(scopedManagerUserIds?: readonly string[] | null): { managerUserId?: { in: string[] } } {
  return scopedManagerUserIds ? { managerUserId: { in: [...scopedManagerUserIds] } } : {};
}

/** `where` for active new sales, limited to the scope's managers when `scopedManagerUserIds` is set. */
export function activeSalesWhere(params: {
  tenantId: string;
  scopedManagerUserIds?: readonly string[] | null;
  filters?: SaleFilter[];
  extra?: SaleFilter;
}) {
  const filters = params.filters ?? [];

  return {
    tenantId: params.tenantId,
    type: 'new_sale',
    lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
    ...managerScopeWhere(params.scopedManagerUserIds),
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

/** Input of the by-course procedures (summary, course detail): one course, an optional tariff/sub-tariff and a range. */
export const courseScopeInput = z.object({
  courseId: z.string().uuid(),
  tariffId: z.string().uuid().optional(),
  subTariffId: z.string().uuid().optional(),
  range: reportRangeSchema,
  ...dateRangeInput.shape,
});

type CourseScopeContext = { db: DbClient; tenantId: string; user: { userId: string; roles: string[] } };

/** The managers whose sales the caller may see (`null` = everyone): self for agents, the group for team leaders. */
export async function resolveCourseSalesManagerScope(ctx: CourseScopeContext): Promise<string[] | null> {
  return (await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db)).userIds;
}

/**
 * What every by-course procedure starts with: the resolved range, the managers the data is limited to (agents
 * their own sales, team leaders and OnlineAdmin their group) and the sale filters for the course, tariff and sub-tariff.
 */
export async function resolveCourseScope(ctx: CourseScopeContext, input: z.infer<typeof courseScopeInput>, now: Date) {
  const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
  const scopedManagerUserIds = await resolveCourseSalesManagerScope(ctx);
  const scopedFilters = await buildCourseSaleFilters({
    db: ctx.db,
    tenantId: ctx.tenantId,
    courseId: input.courseId,
    tariffId: input.tariffId,
    subTariffId: input.subTariffId,
  });

  return { rangeStart, rangeEnd, scopedManagerUserIds, scopedFilters };
}
