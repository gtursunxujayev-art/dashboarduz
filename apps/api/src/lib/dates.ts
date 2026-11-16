/**
 * Report date ranges in Tashkent time (GMT+5) for tRPC procedures.
 * The calendar maths itself lives in `@dashboarduz/shared` (tashkent-date).
 */
import { TASHKENT_OFFSET_MS } from '@dashboarduz/shared';
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

/** User-facing errors of {@link parseCustomDate} and {@link resolveDateRange}; routers differ in language. */
export type DateRangeMessages = {
  invalidFormat: (input: string) => string;
  invalidDate: (input: string) => string;
  missingBounds: string;
  endBeforeStart: string;
};

export const DATE_RANGE_MESSAGES_EN: DateRangeMessages = {
  invalidFormat: () => 'Custom date must be in YYYY-MM-DD format.',
  invalidDate: (input) => `Invalid custom date: ${input}`,
  missingBounds: 'Both dateFrom and dateTo are required when range is custom.',
  endBeforeStart: 'dateTo must be greater than or equal to dateFrom.',
};

export type ParseCustomDateOptions = {
  messages?: DateRangeMessages;
  /** Trim the input before validating it (customer-income). Others reject surrounding spaces. */
  trimInput?: boolean;
};

/** A `YYYY-MM-DD` Tashkent day as its first (or, with `endOfDay`, last) millisecond. Throws BAD_REQUEST. */
export function parseCustomDate(input: string, endOfDay: boolean, options: ParseCustomDateOptions = {}): Date {
  const messages = options.messages ?? DATE_RANGE_MESSAGES_EN;
  const value = options.trimInput ? String(input || '').trim() : input;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: messages.invalidFormat(input) });
  }

  const parsed = new Date(`${value}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+05:00`);

  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: messages.invalidDate(input) });
  }

  return parsed;
}

/** A preset range ends now; a custom range needs both bounds, in order. */
export function resolveDateRange(
  range: ReportRange,
  now: Date,
  dateFrom?: string,
  dateTo?: string,
  messages: DateRangeMessages = DATE_RANGE_MESSAGES_EN,
): { rangeStart: Date; rangeEnd: Date } {
  if (range !== 'custom') {
    return {
      rangeStart: getRangeStart(range, now),
      rangeEnd: now,
    };
  }

  if (!dateFrom || !dateTo) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: messages.missingBounds });
  }

  const rangeStart = parseCustomDate(dateFrom, false, { messages });
  const rangeEnd = parseCustomDate(dateTo, true, { messages });

  if (rangeEnd < rangeStart) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: messages.endBeforeStart });
  }

  return { rangeStart, rangeEnd };
}
