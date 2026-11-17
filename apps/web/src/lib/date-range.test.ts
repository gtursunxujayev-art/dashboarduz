import { describe, expect, it } from '@jest/globals';
import {
  formatRangeBounds,
  getPreviousMonthRange,
  getRangeBounds,
  getPreviousWeekRange,
  getTashkentDateShift,
  getTashkentToday,
  getCurrentMonthToDateRange,
  getRangeLabel,
  toApiDateRange,
} from './date-range';

// Saturday 2026-11-07, 11:00 in Tashkent.
const now = new Date('2026-11-07T06:00:00Z');

describe('date-range helpers', () => {
  it('uses the Tashkent calendar day', () => {
    expect(getTashkentToday(now)).toBe('2026-11-07');
    // 21:00 UTC is already the next day in Tashkent.
    expect(getTashkentToday(new Date('2026-11-07T21:00:00Z'))).toBe('2026-11-08');
    expect(getTashkentDateShift(-6, now)).toBe('2026-11-01');
  });

  it('computes the previous Monday..Sunday week', () => {
    expect(getPreviousWeekRange(now)).toEqual({ dateFrom: '2026-10-26', dateTo: '2026-11-01' });
  });

  it('computes the previous month, including across a year boundary', () => {
    expect(getPreviousMonthRange(now)).toEqual({ dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(getPreviousMonthRange(new Date('2027-01-10T06:00:00Z'))).toEqual({ dateFrom: '2026-12-01', dateTo: '2026-12-31' });
  });

  it('maps UI ranges to API ranges', () => {
    const custom = { dateFrom: '2026-09-01', dateTo: '2026-09-15' };
    expect(toApiDateRange('month', custom, now)).toEqual({ range: 'month' });
    expect(toApiDateRange('last_week', custom, now)).toEqual({ range: 'custom', dateFrom: '2026-10-26', dateTo: '2026-11-01' });
    expect(toApiDateRange('custom', custom, now)).toEqual({ range: 'custom', ...custom });
  });
});

describe('getRangeLabel', () => {
  it('has short labels (dashboard, analytics) and long labels (calls)', () => {
    expect(getRangeLabel('week')).toBe('Hafta');
    expect(getRangeLabel('custom')).toBe('Ixtiyoriy');
    expect(getRangeLabel('week', 'long')).toBe('Bu hafta');
    expect(getRangeLabel('month', 'long')).toBe('Bu oy');
    expect(getRangeLabel('custom', 'long')).toBe('Ixtiyoriy sana');
    expect(getRangeLabel('today', 'long')).toBe('Bugun');
  });
});

describe('getCurrentMonthToDateRange', () => {
  it('runs from the first of the Tashkent month to today', () => {
    expect(getCurrentMonthToDateRange(now)).toEqual({ dateFrom: '2026-11-01', dateTo: '2026-11-07' });
    // 2026-11-30T19:30Z is already 1 December in Tashkent.
    expect(getCurrentMonthToDateRange(new Date('2026-11-30T19:30:00Z'))).toEqual({ dateFrom: '2026-12-01', dateTo: '2026-12-01' });
  });
});

describe('range bounds label', () => {
  const now = new Date('2026-11-17T05:00:00.000Z');

  it('covers Monday to today for the week and the 1st to today for the month', () => {
    expect(getRangeBounds('week', { dateFrom: '', dateTo: '' }, now)).toEqual({ dateFrom: '2026-11-16', dateTo: '2026-11-17' });
    expect(getRangeBounds('month', { dateFrom: '', dateTo: '' }, now)).toEqual({ dateFrom: '2026-11-01', dateTo: '2026-11-17' });
  });

  it('formats single days, same-year spans and cross-year spans', () => {
    expect(formatRangeBounds({ dateFrom: '2026-11-17', dateTo: '2026-11-17' })).toBe('17-noy, 2026');
    expect(formatRangeBounds({ dateFrom: '2026-11-01', dateTo: '2026-11-17' })).toBe('1-noy - 17-noy, 2026');
    expect(formatRangeBounds({ dateFrom: '2025-12-20', dateTo: '2026-01-05' })).toBe('20-dek, 2025 - 5-yan, 2026');
  });
});
