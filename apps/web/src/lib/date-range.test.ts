import { describe, expect, it } from '@jest/globals';
import {
  getPreviousMonthRange,
  getPreviousWeekRange,
  getTashkentDateShift,
  getTashkentToday,
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
