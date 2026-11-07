// Shared Tashkent (GMT+5) date-range helpers for dashboard filters.

export type ExtendedDashboardRange = 'today' | 'week' | 'month' | 'last_week' | 'last_month' | 'custom';
export type ApiDashboardRange = 'today' | 'week' | 'month' | 'custom';

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A UTC Date whose Y/M/D fields equal the current Tashkent calendar day. */
function tashkentCalendarDay(now: Date): Date {
  const shifted = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getTashkentToday(now: Date = new Date()): string {
  return toIsoDay(tashkentCalendarDay(now));
}

export function getTashkentDateShift(days: number, now: Date = new Date()): string {
  return toIsoDay(new Date(tashkentCalendarDay(now).getTime() + days * DAY_MS));
}

/** Monday..Sunday of the previous Tashkent week. */
export function getPreviousWeekRange(now: Date = new Date()): { dateFrom: string; dateTo: string } {
  const today = tashkentCalendarDay(now);
  const daysSinceMonday = (today.getUTCDay() + 6) % 7;
  const currentMonday = today.getTime() - daysSinceMonday * DAY_MS;
  return {
    dateFrom: toIsoDay(new Date(currentMonday - 7 * DAY_MS)),
    dateTo: toIsoDay(new Date(currentMonday - DAY_MS)),
  };
}

/** First..last day of the previous Tashkent month. */
export function getPreviousMonthRange(now: Date = new Date()): { dateFrom: string; dateTo: string } {
  const today = tashkentCalendarDay(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  return {
    dateFrom: toIsoDay(new Date(Date.UTC(year, month - 1, 1))),
    dateTo: toIsoDay(new Date(Date.UTC(year, month, 0))),
  };
}

/** Maps the six-option UI range to the API's four-option range (+ explicit bounds when needed). */
export function toApiDateRange(
  range: ExtendedDashboardRange,
  custom: { dateFrom: string; dateTo: string },
  now: Date = new Date(),
): { range: ApiDashboardRange; dateFrom?: string; dateTo?: string } {
  if (range === 'last_week') return { range: 'custom', ...getPreviousWeekRange(now) };
  if (range === 'last_month') return { range: 'custom', ...getPreviousMonthRange(now) };
  if (range === 'custom') return { range: 'custom', dateFrom: custom.dateFrom, dateTo: custom.dateTo };
  return { range };
}
