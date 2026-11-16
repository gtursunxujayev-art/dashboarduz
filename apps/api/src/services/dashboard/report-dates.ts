import { type ReportRangePreset, shiftToTashkent } from '@dashboarduz/shared';

import { getRangeStart } from '../../lib/dates';

export type DashboardRange = ReportRangePreset;

export const REPORT_MONTH_LABELS_UZ = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'] as const;

export function getDaysInReportLocalMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function getReportLocalDayOfYear(date: Date): number {
  const shifted = shiftToTashkent(date);
  const year = shifted.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const currentDay = Date.UTC(year, shifted.getUTCMonth(), shifted.getUTCDate());

  return Math.floor((currentDay - yearStart) / 86_400_000) + 1;
}

export function getReportLocalDaysInYear(year: number): number {
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

  return isLeapYear ? 366 : 365;
}

export function getReportLocalDayOfYearForMonthEnd(year: number, month: number): number {
  const yearStart = Date.UTC(year, 0, 1);
  const monthEnd = Date.UTC(year, month + 1, 0);

  return Math.floor((monthEnd - yearStart) / 86_400_000) + 1;
}

export function buildTrend(currentValue: number, previousValue: number) {
  const diffAmount = currentValue - previousValue;
  let diffPercent = 0;

  if (previousValue > 0) {
    diffPercent = (diffAmount / previousValue) * 100;
  } else if (currentValue > 0) {
    diffPercent = 100;
  }

  const direction = diffAmount > 0 ? 'up' : diffAmount < 0 ? 'down' : 'flat';

  return {
    currentValue,
    previousValue,
    diffAmount,
    diffPercent: Number(diffPercent.toFixed(2)),
    direction,
  };
}

export function getCurrentMonthRange(now: Date) {
  return {
    monthStart: getRangeStart('month', now),
    monthEnd: now,
  };
}
