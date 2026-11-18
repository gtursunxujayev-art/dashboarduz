import { buildRequiredWorkdaysByMonth, calculateProratedFixedSalary, extractBonusDetailSubTariffId, getDayOfWeekFromLocalDateKey, scoreKpi } from '../salary-helpers';

// Midnight of a Tashkent calendar day.
const tashkent = (day: string, time = '00:00:00') => new Date(`${day}T${time}+05:00`);

describe('salary helpers', () => {
  it('prorates a monthly fixed salary by Tashkent calendar days, month by month', () => {
    expect(calculateProratedFixedSalary(3_000_000, tashkent('2026-11-01'), tashkent('2026-11-30', '23:59:59'))).toBe(3_000_000);
    expect(calculateProratedFixedSalary(3_000_000, tashkent('2026-11-01'), tashkent('2026-11-15', '23:59:59'))).toBe(1_500_000);
    // 16 of October's 31 days plus 15 of November's 30: 1 548 387.1 + 1 500 000.
    expect(calculateProratedFixedSalary(3_000_000, tashkent('2026-10-16'), tashkent('2026-11-15', '23:59:59'))).toBe(3_048_387);
    // A range across the new year walks December and January.
    expect(calculateProratedFixedSalary(3_100_000, tashkent('2026-12-01'), tashkent('2027-01-31', '23:59:59'))).toBe(6_200_000);
  });

  it('pays nothing for no salary or a reversed range', () => {
    expect(calculateProratedFixedSalary(0, tashkent('2026-11-01'), tashkent('2026-11-30'))).toBe(0);
    expect(calculateProratedFixedSalary(3_000_000, tashkent('2026-11-10'), tashkent('2026-11-01'))).toBe(0);
  });

  it('counts every day but Sunday as a workday, per month', () => {
    // 2026-11-01 is a Sunday.
    expect(getDayOfWeekFromLocalDateKey('2026-11-01')).toBe(0);
    expect(getDayOfWeekFromLocalDateKey('not-a-date')).toBe(0);
    expect(Object.fromEntries(buildRequiredWorkdaysByMonth(tashkent('2026-10-30'), tashkent('2026-11-07', '18:00:00')))).toEqual({
      '2026-10': 2,
      '2026-11': 6,
    });
  });

  it('scores a KPI as full, half or nothing against its thresholds', () => {
    const threshold = { full: 20, half: 10 };

    expect([25, 20, 15, 10, 9].map((value) => scoreKpi(value, threshold, true))).toEqual([1, 1, 0.5, 0.5, 0]);
    expect([5, 10, 15, 25].map((value) => scoreKpi(value, { full: 10, half: 20 }, false))).toEqual([1, 1, 0.5, 0]);
    expect(scoreKpi(100, { full: 0, half: 0 }, true)).toBe(0);
  });

  it('reads the sale sub-tariff id from income meta', () => {
    expect(extractBonusDetailSubTariffId({ saleSubTariffId: '  abc  ' })).toBe('abc');
    expect(extractBonusDetailSubTariffId({ saleSubTariffId: '   ' })).toBeNull();
    expect(extractBonusDetailSubTariffId({ saleSubTariffId: 5 })).toBeNull();
    expect(extractBonusDetailSubTariffId(['abc'])).toBeNull();
    expect(extractBonusDetailSubTariffId(null)).toBeNull();
  });
});
