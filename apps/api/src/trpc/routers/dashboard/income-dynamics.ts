import { dateRangeInput, DAY_MS, fromTashkentLocalParts, reportRangeSchema, shiftToTashkent } from '@dashboarduz/shared';

import { getAgentResponsibleScope } from '../../../lib/access';
import { resolveDateRange } from '../../../lib/dates';

import { protectedProcedure, z } from './helpers';
import { loadCountedIncomeRows, loadTechnicalSaleIds } from './income-overview';

export type DynamicsGranularity = 'hour' | 'day' | 'month';

export type DynamicsBucket = { key: string; label: string; amount: number };

const MONTH_SHORT_UZ = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];

/** A one-day range is drawn by hour, up to three months by day, anything longer by month. */
export function pickGranularity(rangeStart: Date, rangeEnd: Date): DynamicsGranularity {
  const spanDays = (rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS;

  if (spanDays <= 1) return 'hour';
  if (spanDays <= 92) return 'day';

  return 'month';
}

function bucketStart(instant: Date, granularity: DynamicsGranularity): Date {
  const local = shiftToTashkent(instant);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();

  if (granularity === 'month') return fromTashkentLocalParts(year, month, 1);
  if (granularity === 'day') return fromTashkentLocalParts(year, month, local.getUTCDate());

  return fromTashkentLocalParts(year, month, local.getUTCDate(), local.getUTCHours());
}

function nextBucketStart(start: Date, granularity: DynamicsGranularity): Date {
  const local = shiftToTashkent(start);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();

  if (granularity === 'month') return fromTashkentLocalParts(year, month + 1, 1);
  if (granularity === 'day') return fromTashkentLocalParts(year, month, local.getUTCDate() + 1);

  return fromTashkentLocalParts(year, month, local.getUTCDate(), local.getUTCHours() + 1);
}

function bucketLabel(start: Date, granularity: DynamicsGranularity): string {
  const local = shiftToTashkent(start);
  const monthLabel = MONTH_SHORT_UZ[local.getUTCMonth()];

  if (granularity === 'month') return `${monthLabel} ${local.getUTCFullYear()}`;
  if (granularity === 'day') return `${local.getUTCDate()}-${monthLabel}`;

  return `${String(local.getUTCHours()).padStart(2, '0')}:00`;
}

/** Sums income rows into consecutive Tashkent hour, day or month buckets covering the whole range. */
export function buildIncomeBuckets(params: {
  rangeStart: Date;
  rangeEnd: Date;
  granularity: DynamicsGranularity;
  rows: Array<{ entryDate: Date; amount: number }>;
}): DynamicsBucket[] {
  const { rangeStart, rangeEnd, granularity } = params;
  const buckets: DynamicsBucket[] = [];
  const indexByKey = new Map<string, number>();

  for (let cursor = bucketStart(rangeStart, granularity); cursor <= rangeEnd; cursor = nextBucketStart(cursor, granularity)) {
    const key = cursor.toISOString();

    indexByKey.set(key, buckets.length);
    buckets.push({ key, label: bucketLabel(cursor, granularity), amount: 0 });
  }

  for (const row of params.rows) {
    if (row.entryDate < rangeStart || row.entryDate > rangeEnd) continue;
    const index = indexByKey.get(bucketStart(row.entryDate, granularity).toISOString());
    const bucket = index === undefined ? undefined : buckets[index];

    if (bucket) bucket.amount += row.amount;
  }

  return buckets.map((bucket) => ({ ...bucket, amount: Math.round(bucket.amount) }));
}

/**
 * The period to compare with: the same stretch one day, week or month earlier for the presets
 * (today 00:00-now against yesterday 00:00-same time), and the equally long span just before a custom range.
 */
export function previousPeriod(range: string, rangeStart: Date, rangeEnd: Date): { start: Date; end: Date } {
  const span = rangeEnd.getTime() - rangeStart.getTime();
  let start: Date;

  if (range === 'today') {
    start = new Date(rangeStart.getTime() - DAY_MS);
  } else if (range === 'week') {
    start = new Date(rangeStart.getTime() - 7 * DAY_MS);
  } else if (range === 'month') {
    const local = shiftToTashkent(rangeStart);

    start = fromTashkentLocalParts(local.getUTCFullYear(), local.getUTCMonth() - 1, 1);
  } else {
    start = new Date(rangeStart.getTime() - span - 1);
  }
  const end = new Date(Math.min(start.getTime() + span, rangeStart.getTime() - 1));

  return { start, end };
}

/** Percent change against the previous period, or null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;

  return Number((((current - previous) / previous) * 100).toFixed(1));
}

export const incomeDynamicsProcedures = {
  /**
   * Income over the dashboard's selected range, bucketed for a chart, plus the total of the
   * comparable previous period (see `previousPeriod`). Counts the same rows as `incomeOverview`.
   */
  incomeDynamics: protectedProcedure
    .input(z.object({
      range: reportRangeSchema,
      ...dateRangeInput.shape,
    }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const { start: previousStart, end: previousEnd } = previousPeriod(input.range, rangeStart, rangeEnd);

      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
      const managerUserId = scope.isScoped ? ctx.user.userId : null;
      const technicalSaleIds = await loadTechnicalSaleIds(ctx.tenantId, managerUserId, ctx.db);

      const [currentRows, previousRows] = await Promise.all([
        loadCountedIncomeRows({ tenantId: ctx.tenantId, rangeStart, rangeEnd, managerUserId, technicalSaleIds, db: ctx.db }),
        loadCountedIncomeRows({ tenantId: ctx.tenantId, rangeStart: previousStart, rangeEnd: previousEnd, managerUserId, technicalSaleIds, db: ctx.db }),
      ]);

      const granularity = pickGranularity(rangeStart, rangeEnd);
      const buckets = buildIncomeBuckets({ rangeStart, rangeEnd, granularity, rows: currentRows });
      const total = Math.round(currentRows.reduce((sum, row) => sum + row.amount, 0));
      const previousTotal = Math.round(previousRows.reduce((sum, row) => sum + row.amount, 0));

      return {
        granularity,
        buckets,
        total,
        previousTotal,
        changePercent: percentChange(total, previousTotal),
      };
    }),
};
