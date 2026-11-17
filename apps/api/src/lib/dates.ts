/**
 * Report date ranges in Tashkent time (GMT+5) for tRPC procedures.
 * The calendar maths itself lives in `@dashboarduz/shared` (tashkent-date).
 */
import { DATE_KEY_FORMAT_MESSAGE, DATE_KEY_PATTERN, TASHKENT_OFFSET_MS } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

/** Preset ranges the routers accept. `custom` (and anything unknown) falls back to the month start. */
export type ReportRange = 'today' | 'week' | 'month' | 'last30days' | 'custom';

/** Start of the current Tashkent day, Monday-based week, last 30 days (today included) or month. */
export function getRangeStart(range: ReportRange, now: Date): Date {
  const shiftedNow = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const year = shiftedNow.getUTCFullYear();
  const month = shiftedNow.getUTCMonth();
  const date = shiftedNow.getUTCDate();

  if (range === 'today') {
    return new Date(Date.UTC(year, month, date) - TASHKENT_OFFSET_MS);
  }

  if (range === 'week') {
    const day = shiftedNow.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;

    return new Date(Date.UTC(year, month, date - daysSinceMonday) - TASHKENT_OFFSET_MS);
  }

  if (range === 'last30days') {
    return new Date(Date.UTC(year, month, date - 29) - TASHKENT_OFFSET_MS);
  }

  return new Date(Date.UTC(year, month, 1) - TASHKENT_OFFSET_MS);
}

/** User-facing errors of {@link parseCustomDate} and {@link resolveDateRange}; every router reports them in Uzbek. */
export const DATE_RANGE_MESSAGES = {
  invalidFormat: DATE_KEY_FORMAT_MESSAGE,
  invalidDate: (input: string) => `Noto'g'ri sana: ${input}`,
  missingBounds: "Ixtiyoriy davr uchun 'dan' va 'gacha' sanalari majburiy.",
  endBeforeStart: "'gacha' sanasi 'dan' sanasidan oldin bo'lishi mumkin emas.",
} as const;

/** A typed `YYYY-MM-DD` Tashkent day (surrounding spaces ignored) as its first (or, with `endOfDay`, last) millisecond. Throws BAD_REQUEST. */
export function parseCustomDate(input: string, endOfDay: boolean): Date {
  const value = String(input || '').trim();

  if (!DATE_KEY_PATTERN.test(value)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: DATE_RANGE_MESSAGES.invalidFormat });
  }

  const parsed = new Date(`${value}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+05:00`);

  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: DATE_RANGE_MESSAGES.invalidDate(value) });
  }

  return parsed;
}

/** A preset range ends now; a custom range needs both bounds, in order. */
export function resolveDateRange(
  range: ReportRange,
  now: Date,
  dateFrom?: string,
  dateTo?: string,
): { rangeStart: Date; rangeEnd: Date } {
  if (range !== 'custom') {
    return {
      rangeStart: getRangeStart(range, now),
      rangeEnd: now,
    };
  }

  if (!dateFrom?.trim() || !dateTo?.trim()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: DATE_RANGE_MESSAGES.missingBounds });
  }

  const rangeStart = parseCustomDate(dateFrom, false);
  const rangeEnd = parseCustomDate(dateTo, true);

  if (rangeEnd < rangeStart) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: DATE_RANGE_MESSAGES.endBeforeStart });
  }

  return { rangeStart, rangeEnd };
}
