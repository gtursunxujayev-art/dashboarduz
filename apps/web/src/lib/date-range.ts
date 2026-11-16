// Shared Tashkent (GMT+5) date-range helpers for dashboard filters.
import { DAY_MS, tashkentCalendarDay, type ReportRangePreset } from '@dashboarduz/shared';

export type ExtendedDashboardRange = 'today' | 'week' | 'month' | 'last_week' | 'last_month' | 'custom';
export type ApiDashboardRange = ReportRangePreset;


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

const RANGE_LABELS: Record<'short' | 'long', Record<ApiDashboardRange, string>> = {
  short: { today: 'Bugun', week: 'Hafta', month: 'Oy', custom: 'Ixtiyoriy' },
  long: { today: 'Bugun', week: 'Bu hafta', month: 'Bu oy', custom: 'Ixtiyoriy sana' },
};

/** Uzbek button label for a range: short on the dashboard and analytics pages, long on the calls page. */
export function getRangeLabel(range: ApiDashboardRange, style: 'short' | 'long' = 'short'): string {
  return RANGE_LABELS[style][range];
}

/** First day of the current Tashkent month .. today. */
export function getCurrentMonthToDateRange(now: Date = new Date()): { dateFrom: string; dateTo: string } {
  const today = tashkentCalendarDay(now);
  return {
    dateFrom: toIsoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
    dateTo: toIsoDay(today),
  };
}
