import { fromTashkentLocalParts, shiftToTashkent, toTashkentDateKey } from '@dashboarduz/shared';

import type { ReportWindow } from './types';

export function resolveReportWindows(nowUtc: Date): ReportWindow[] {
  const nowLocal = shiftToTashkent(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const day = nowLocal.getUTCDate();
  const weekday = nowLocal.getUTCDay(); // 0 Sunday, 1 Monday

  const windows: ReportWindow[] = [];

  // Daily report for yesterday at 10:00 local.
  const dailyDispatchAt = fromTashkentLocalParts(year, month, day, 10, 0, 0, 0);

  if (nowUtc >= dailyDispatchAt) {
    const todayStart = fromTashkentLocalParts(year, month, day, 0, 0, 0, 0);
    const periodStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const periodEnd = new Date(todayStart.getTime() - 1);

    windows.push({
      kind: 'daily',
      title: 'Kunlik hisobot (Kecha)',
      periodStart,
      periodEnd,
      periodKey: toTashkentDateKey(periodStart),
    });
  }

  // Weekly report at Monday 07:55 local for previous week.
  if (weekday === 1) {
    const mondayStart = fromTashkentLocalParts(year, month, day, 0, 0, 0, 0);
    const weeklyDispatchAt = fromTashkentLocalParts(year, month, day, 7, 55, 0, 0);

    if (nowUtc >= weeklyDispatchAt) {
      const periodStart = new Date(mondayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      const periodEnd = new Date(mondayStart.getTime() - 1);

      windows.push({
        kind: 'weekly',
        title: 'Haftalik hisobot (O`tgan hafta)',
        periodStart,
        periodEnd,
        periodKey: `${toTashkentDateKey(periodStart)}_${toTashkentDateKey(periodEnd)}`,
      });
    }
  }

  // Monthly report at first day 07:50 local for previous month.
  if (day === 1) {
    const currentMonthStart = fromTashkentLocalParts(year, month, 1, 0, 0, 0, 0);
    const monthlyDispatchAt = fromTashkentLocalParts(year, month, 1, 7, 50, 0, 0);

    if (nowUtc >= monthlyDispatchAt) {
      const periodEnd = new Date(currentMonthStart.getTime() - 1);
      const previousMonthLocal = shiftToTashkent(new Date(currentMonthStart.getTime() - 24 * 60 * 60 * 1000));
      const periodStart = fromTashkentLocalParts(
        previousMonthLocal.getUTCFullYear(),
        previousMonthLocal.getUTCMonth(),
        1,
        0,
        0,
        0,
        0,
      );

      windows.push({
        kind: 'monthly',
        title: 'Oylik hisobot (O`tgan oy)',
        periodStart,
        periodEnd,
        periodKey: `${toTashkentDateKey(periodStart)}_${toTashkentDateKey(periodEnd)}`,
      });
    }
  }

  return windows;
}

export function buildTodayWindow(nowUtc: Date): ReportWindow {
  const nowLocal = shiftToTashkent(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const day = nowLocal.getUTCDate();
  const periodStart = fromTashkentLocalParts(year, month, day, 0, 0, 0, 0);

  return {
    kind: 'daily',
    title: 'Tezkor hisobot (Bugun)',
    periodStart,
    periodEnd: nowUtc,
    periodKey: toTashkentDateKey(periodStart),
  };
}

function buildPreviousWeekWindow(nowUtc: Date): ReportWindow {
  const nowLocal = shiftToTashkent(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const day = nowLocal.getUTCDate();
  const daysSinceMonday = (nowLocal.getUTCDay() + 6) % 7;
  const currentWeekStart = fromTashkentLocalParts(year, month, day - daysSinceMonday, 0, 0, 0, 0);
  const periodStart = new Date(currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const periodEnd = new Date(currentWeekStart.getTime() - 1);

  return {
    kind: 'weekly',
    title: 'Haftalik hisobot (O`tgan hafta)',
    periodStart,
    periodEnd,
    periodKey: `${toTashkentDateKey(periodStart)}_${toTashkentDateKey(periodEnd)}`,
  };
}

export function buildCurrentWeekWindow(nowUtc: Date): ReportWindow {
  const nowLocal = shiftToTashkent(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const day = nowLocal.getUTCDate();
  const daysSinceMonday = (nowLocal.getUTCDay() + 6) % 7;
  const periodStart = fromTashkentLocalParts(year, month, day - daysSinceMonday, 0, 0, 0, 0);

  return {
    kind: 'weekly',
    title: 'Haftalik hisobot (Joriy hafta)',
    periodStart,
    periodEnd: nowUtc,
    periodKey: `${toTashkentDateKey(periodStart)}_${toTashkentDateKey(nowUtc)}`,
  };
}

function buildPreviousMonthWindow(nowUtc: Date): ReportWindow {
  const nowLocal = shiftToTashkent(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const currentMonthStart = fromTashkentLocalParts(year, month, 1, 0, 0, 0, 0);
  const periodEnd = new Date(currentMonthStart.getTime() - 1);
  const previousMonthLocal = shiftToTashkent(new Date(currentMonthStart.getTime() - 24 * 60 * 60 * 1000));
  const periodStart = fromTashkentLocalParts(
    previousMonthLocal.getUTCFullYear(),
    previousMonthLocal.getUTCMonth(),
    1,
    0,
    0,
    0,
    0,
  );

  return {
    kind: 'monthly',
    title: 'Oylik hisobot (O`tgan oy)',
    periodStart,
    periodEnd,
    periodKey: `${toTashkentDateKey(periodStart)}_${toTashkentDateKey(periodEnd)}`,
  };
}

export function buildCurrentMonthWindow(nowUtc: Date): ReportWindow {
  const nowLocal = shiftToTashkent(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const periodStart = fromTashkentLocalParts(year, month, 1, 0, 0, 0, 0);

  return {
    kind: 'monthly',
    title: 'Oylik hisobot (Joriy oy)',
    periodStart,
    periodEnd: nowUtc,
    periodKey: `${toTashkentDateKey(periodStart)}_${toTashkentDateKey(nowUtc)}`,
  };
}
