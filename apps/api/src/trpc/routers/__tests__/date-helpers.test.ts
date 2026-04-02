import {
  getRangeStart,
  shiftToReportTimezone,
  getReportLocalDayKey,
  getReportLocalDayOfYear,
  getReportLocalDaysInYear,
  getDaysInReportLocalMonth,
  resolveDateRange,
  parseCustomDate,
  buildTrend,
  getCurrentMonthRange,
  REPORT_TZ_OFFSET_MS,
} from '../dashboard/helpers';

describe('getRangeStart', () => {
  // All tests use a fixed "now" in UTC. The report timezone is GMT+5.
  // 2024-03-15 10:00:00 UTC = 2024-03-15 15:00:00 Tashkent
  const now = new Date('2024-03-15T10:00:00.000Z');

  it('returns start of today in GMT+5', () => {
    const result = getRangeStart('today', now);
    // Start of 2024-03-15 in GMT+5 = 2024-03-14T19:00:00.000Z
    expect(result.toISOString()).toBe('2024-03-14T19:00:00.000Z');
  });

  it('returns start of week (Monday) in GMT+5', () => {
    // 2024-03-15 is a Friday. Monday was 2024-03-11.
    const result = getRangeStart('week', now);
    // Start of 2024-03-11 in GMT+5 = 2024-03-10T19:00:00.000Z
    expect(result.toISOString()).toBe('2024-03-10T19:00:00.000Z');
  });

  it('returns start of month in GMT+5', () => {
    const result = getRangeStart('month', now);
    // Start of 2024-03-01 in GMT+5 = 2024-02-29T19:00:00.000Z
    expect(result.toISOString()).toBe('2024-02-29T19:00:00.000Z');
  });

  it('handles near midnight transitions', () => {
    // 2024-03-15T20:00:00Z = 2024-03-16T01:00:00 Tashkent (next day!)
    const lateNow = new Date('2024-03-15T20:00:00.000Z');
    const result = getRangeStart('today', lateNow);
    // Should be start of March 16 in GMT+5 = 2024-03-15T19:00:00.000Z
    expect(result.toISOString()).toBe('2024-03-15T19:00:00.000Z');
  });
});

describe('shiftToReportTimezone', () => {
  it('adds GMT+5 offset', () => {
    const utc = new Date('2024-01-01T00:00:00.000Z');
    const shifted = shiftToReportTimezone(utc);
    expect(shifted.getTime()).toBe(utc.getTime() + REPORT_TZ_OFFSET_MS);
    expect(shifted.getUTCHours()).toBe(5);
  });
});

describe('getReportLocalDayKey', () => {
  it('formats as YYYY-MM-DD in GMT+5', () => {
    // 2024-03-15T20:00:00Z = 2024-03-16 01:00:00 Tashkent
    const date = new Date('2024-03-15T20:00:00.000Z');
    expect(getReportLocalDayKey(date)).toBe('2024-03-16');
  });

  it('handles month boundaries', () => {
    // 2024-01-31T19:30:00Z = 2024-02-01 00:30:00 Tashkent
    const date = new Date('2024-01-31T19:30:00.000Z');
    expect(getReportLocalDayKey(date)).toBe('2024-02-01');
  });
});

describe('getReportLocalDayOfYear', () => {
  it('returns 1 for Jan 1', () => {
    // Jan 1 00:00 Tashkent = Dec 31 19:00 UTC
    const date = new Date('2023-12-31T19:00:00.000Z');
    expect(getReportLocalDayOfYear(date)).toBe(1);
  });

  it('returns 366 for Dec 31 of leap year', () => {
    // Dec 31 2024 (leap year) 12:00 Tashkent = Dec 31 07:00 UTC
    const date = new Date('2024-12-31T07:00:00.000Z');
    expect(getReportLocalDayOfYear(date)).toBe(366);
  });
});

describe('getReportLocalDaysInYear', () => {
  it('returns 366 for leap year', () => {
    expect(getReportLocalDaysInYear(2024)).toBe(366);
  });

  it('returns 365 for non-leap year', () => {
    expect(getReportLocalDaysInYear(2023)).toBe(365);
  });
});

describe('getDaysInReportLocalMonth', () => {
  it('returns 29 for Feb in leap year', () => {
    expect(getDaysInReportLocalMonth(2024, 1)).toBe(29); // month is 0-indexed
  });

  it('returns 28 for Feb in non-leap year', () => {
    expect(getDaysInReportLocalMonth(2023, 1)).toBe(28);
  });

  it('returns 31 for January', () => {
    expect(getDaysInReportLocalMonth(2024, 0)).toBe(31);
  });
});

describe('parseCustomDate', () => {
  it('parses start of day in GMT+5', () => {
    const result = parseCustomDate('2024-03-15', false);
    // 2024-03-15T00:00:00.000+05:00 = 2024-03-14T19:00:00.000Z
    expect(result.toISOString()).toBe('2024-03-14T19:00:00.000Z');
  });

  it('parses end of day in GMT+5', () => {
    const result = parseCustomDate('2024-03-15', true);
    // 2024-03-15T23:59:59.999+05:00 = 2024-03-15T18:59:59.999Z
    expect(result.toISOString()).toBe('2024-03-15T18:59:59.999Z');
  });

  it('throws for invalid format', () => {
    expect(() => parseCustomDate('15-03-2024', false)).toThrow();
    expect(() => parseCustomDate('2024/03/15', false)).toThrow();
  });
});

describe('resolveDateRange', () => {
  const now = new Date('2024-03-15T10:00:00.000Z');

  it('uses getRangeStart for non-custom ranges', () => {
    const { rangeStart, rangeEnd } = resolveDateRange('today', now);
    expect(rangeStart.toISOString()).toBe('2024-03-14T19:00:00.000Z');
    expect(rangeEnd).toBe(now);
  });

  it('parses custom dates', () => {
    const { rangeStart, rangeEnd } = resolveDateRange('custom', now, '2024-03-01', '2024-03-15');
    expect(rangeStart.toISOString()).toBe('2024-02-29T19:00:00.000Z');
    expect(rangeEnd.toISOString()).toBe('2024-03-15T18:59:59.999Z');
  });

  it('throws when custom dates are missing', () => {
    expect(() => resolveDateRange('custom', now)).toThrow();
    expect(() => resolveDateRange('custom', now, '2024-03-01')).toThrow();
  });

  it('throws when dateTo < dateFrom', () => {
    expect(() => resolveDateRange('custom', now, '2024-03-15', '2024-03-01')).toThrow();
  });
});

describe('buildTrend', () => {
  it('calculates upward trend', () => {
    const trend = buildTrend(150, 100);
    expect(trend.direction).toBe('up');
    expect(trend.diffAmount).toBe(50);
    expect(trend.diffPercent).toBe(50);
  });

  it('calculates downward trend', () => {
    const trend = buildTrend(50, 100);
    expect(trend.direction).toBe('down');
    expect(trend.diffAmount).toBe(-50);
    expect(trend.diffPercent).toBe(-50);
  });

  it('returns flat for equal values', () => {
    const trend = buildTrend(100, 100);
    expect(trend.direction).toBe('flat');
    expect(trend.diffAmount).toBe(0);
  });

  it('returns 100% when previous is 0 and current > 0', () => {
    const trend = buildTrend(50, 0);
    expect(trend.diffPercent).toBe(100);
    expect(trend.direction).toBe('up');
  });
});

describe('getCurrentMonthRange', () => {
  it('returns start of month and now', () => {
    const now = new Date('2024-06-15T10:00:00.000Z');
    const { monthStart, monthEnd } = getCurrentMonthRange(now);
    expect(monthEnd).toBe(now);
    // June 1 in GMT+5 = May 31 19:00 UTC
    expect(monthStart.toISOString()).toBe('2024-05-31T19:00:00.000Z');
  });
});
