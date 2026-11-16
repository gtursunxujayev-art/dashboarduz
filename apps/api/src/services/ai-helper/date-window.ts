import { TASHKENT_OFFSET_MS, toTashkentDateKey } from '@dashboarduz/shared';
import type { z } from 'zod';

import type { aiHelperInputSchema } from './input';

type DateWindow = {
  dateFrom: string;
  dateTo: string;
  reason: 'message_explicit' | 'page_context' | 'default_current_month';
};

function startOfTashkentDay(date: Date): Date {
  const shifted = new Date(date.getTime() + TASHKENT_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();

  return new Date(Date.UTC(y, m, d) - TASHKENT_OFFSET_MS);
}

function getCurrentMonthWindow(now: Date): { dateFrom: string; dateTo: string } {
  const shifted = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const monthStart = new Date(Date.UTC(y, m, 1) - TASHKENT_OFFSET_MS);

  return { dateFrom: toTashkentDateKey(monthStart), dateTo: toTashkentDateKey(now) };
}

function getLastMonthWindow(now: Date): { dateFrom: string; dateTo: string } {
  const shifted = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const start = new Date(Date.UTC(y, m - 1, 1) - TASHKENT_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999) - TASHKENT_OFFSET_MS);

  return { dateFrom: toTashkentDateKey(start), dateTo: toTashkentDateKey(end) };
}

function getCurrentWeekWindow(now: Date): { dateFrom: string; dateTo: string } {
  const localDay = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const day = localDay.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(localDay);

  monday.setUTCDate(localDay.getUTCDate() - daysSinceMonday);
  const mondayUtc = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()) - TASHKENT_OFFSET_MS);

  return { dateFrom: toTashkentDateKey(mondayUtc), dateTo: toTashkentDateKey(now) };
}

function getLastWeekWindow(now: Date): { dateFrom: string; dateTo: string } {
  const localDay = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const day = localDay.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const currentMonday = new Date(localDay);

  currentMonday.setUTCDate(localDay.getUTCDate() - daysSinceMonday);
  const lastMonday = new Date(currentMonday);

  lastMonday.setUTCDate(currentMonday.getUTCDate() - 7);
  const lastSunday = new Date(currentMonday);

  lastSunday.setUTCDate(currentMonday.getUTCDate() - 1);

  const fromUtc = new Date(Date.UTC(lastMonday.getUTCFullYear(), lastMonday.getUTCMonth(), lastMonday.getUTCDate()) - TASHKENT_OFFSET_MS);
  const toUtc = new Date(Date.UTC(lastSunday.getUTCFullYear(), lastSunday.getUTCMonth(), lastSunday.getUTCDate(), 23, 59, 59, 999) - TASHKENT_OFFSET_MS);

  return { dateFrom: toTashkentDateKey(fromUtc), dateTo: toTashkentDateKey(toUtc) };
}

function normalizeDatePair(a: string, b: string): { dateFrom: string; dateTo: string } {
  return a <= b ? { dateFrom: a, dateTo: b } : { dateFrom: b, dateTo: a };
}

function detectDateWindowFromMessage(message: string, now: Date): { dateFrom: string; dateTo: string } | null {
  const text = message.toLowerCase();

  const between = text.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|dan|gacha|-|–|—)\s*(\d{4}-\d{2}-\d{2})/i);
  const betweenStart = between?.[1];
  const betweenEnd = between?.[2];

  if (betweenStart && betweenEnd) {
    return normalizeDatePair(betweenStart, betweenEnd);
  }

  const singleDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const singleDateValue = singleDate?.[1];

  if (singleDateValue) {
    return { dateFrom: singleDateValue, dateTo: singleDateValue };
  }

  if (text.includes("o'tgan oy") || text.includes('otgan oy') || text.includes('last month')) {
    return getLastMonthWindow(now);
  }
  if (text.includes('joriy oy') || text.includes('bu oy') || text.includes('this month')) {
    return getCurrentMonthWindow(now);
  }
  if (text.includes("o'tgan hafta") || text.includes('otgan hafta') || text.includes('last week')) {
    return getLastWeekWindow(now);
  }
  if (text.includes('joriy hafta') || text.includes('bu hafta') || text.includes('this week')) {
    return getCurrentWeekWindow(now);
  }
  if (text.includes('bugun') || text.includes('today')) {
    const today = toTashkentDateKey(startOfTashkentDay(now));

    return { dateFrom: today, dateTo: today };
  }

  return null;
}

export function resolveDateWindow(
  message: string,
  pageContext: z.infer<typeof aiHelperInputSchema>['pageContext'] | undefined,
  now: Date,
): DateWindow {
  const fromMessage = detectDateWindowFromMessage(message, now);

  if (fromMessage) {
    return { ...fromMessage, reason: 'message_explicit' };
  }

  if (pageContext?.dateFrom && pageContext?.dateTo) {
    return {
      dateFrom: pageContext.dateFrom,
      dateTo: pageContext.dateTo,
      reason: 'page_context',
    };
  }

  const rangeMode = String(pageContext?.rangeMode || '').trim().toLowerCase();

  if (rangeMode === 'today') {
    const today = toTashkentDateKey(startOfTashkentDay(now));

    return { dateFrom: today, dateTo: today, reason: 'page_context' };
  }
  if (rangeMode === 'week') {
    return { ...getCurrentWeekWindow(now), reason: 'page_context' };
  }
  if (rangeMode === 'month') {
    return { ...getCurrentMonthWindow(now), reason: 'page_context' };
  }

  return {
    ...getCurrentMonthWindow(now),
    reason: 'default_current_month',
  };
}
