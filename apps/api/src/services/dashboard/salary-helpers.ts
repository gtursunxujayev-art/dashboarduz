import { shiftToTashkent, toTashkentDateKey } from '@dashboarduz/shared';

import { getDaysInReportLocalMonth, type KpiThreshold } from '../../trpc/routers/dashboard/helpers';

export function calculateProratedFixedSalary(
  monthlyFixedSalary: number,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  if (!monthlyFixedSalary || rangeEnd < rangeStart) {
    return 0;
  }

  const localStart = shiftToTashkent(rangeStart);
  const localEnd = shiftToTashkent(rangeEnd);

  let year = localStart.getUTCFullYear();
  let month = localStart.getUTCMonth();
  const endYear = localEnd.getUTCFullYear();
  const endMonth = localEnd.getUTCMonth();
  let total = 0;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const daysInMonth = getDaysInReportLocalMonth(year, month);
    const startDay = year === localStart.getUTCFullYear() && month === localStart.getUTCMonth()
      ? localStart.getUTCDate()
      : 1;
    const endDay = year === localEnd.getUTCFullYear() && month === localEnd.getUTCMonth()
      ? localEnd.getUTCDate()
      : daysInMonth;

    total += (monthlyFixedSalary * Math.max(0, endDay - startDay + 1)) / daysInMonth;

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return Math.round(total);
}

export function extractBonusDetailSubTariffId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }
  const candidate = (meta as Record<string, unknown>).saleSubTariffId;

  if (typeof candidate !== 'string') {
    return null;
  }
  const normalized = candidate.trim();

  return normalized || null;
}

export function scoreKpi(value: number, threshold: KpiThreshold, higherIsBetter: boolean): number {
  if (threshold.full <= 0 && threshold.half <= 0) return 0;
  if (higherIsBetter) {
    if (value >= threshold.full) return 1;
    if (value >= threshold.half) return 0.5;

    return 0;
  }
  // lower is better (not used currently, but safe)
  if (value <= threshold.full) return 1;
  if (value <= threshold.half) return 0.5;

  return 0;
}

export type KpiBreakdownEntry = {
  value: number;
  score: number;
  amount: number;
};

function parseLocalDateKey(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  return {
    year: Number.parseInt(match[1] || '0', 10),
    month: Number.parseInt(match[2] || '0', 10),
    day: Number.parseInt(match[3] || '0', 10),
  };
}

function formatLocalDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getDayOfWeekFromLocalDateKey(value: string): number {
  const parsed = parseLocalDateKey(value);

  if (!parsed) {
    return 0;
  }

  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

function addOneDayToLocalDateKey(value: string): string {
  const parsed = parseLocalDateKey(value);

  if (!parsed) {
    return value;
  }
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1));

  return formatLocalDateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

export function buildRequiredWorkdaysByMonth(rangeStart: Date, rangeEnd: Date): Map<string, number> {
  const result = new Map<string, number>();
  let cursor = toTashkentDateKey(rangeStart);
  const end = toTashkentDateKey(rangeEnd);

  while (cursor <= end) {
    const dayOfWeek = getDayOfWeekFromLocalDateKey(cursor);

    if (dayOfWeek !== 0) {
      const monthKey = cursor.slice(0, 7);

      result.set(monthKey, (result.get(monthKey) || 0) + 1);
    }
    cursor = addOneDayToLocalDateKey(cursor);
  }

  return result;
}
