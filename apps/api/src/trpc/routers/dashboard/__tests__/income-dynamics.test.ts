import { buildIncomeBuckets, percentChange, pickGranularity, previousPeriod, resolveIncomeInstant } from '../income-dynamics';

// Tashkent is UTC+5: local midnight of 1 November 2026 is 2026-10-31T19:00:00Z.
const NOV_1 = new Date('2026-10-31T19:00:00.000Z');

describe('dashboard income dynamics', () => {
  it('draws a day by hour, a month by day and a longer span by month', () => {
    expect(pickGranularity(NOV_1, new Date('2026-11-01T10:00:00.000Z'))).toBe('hour');
    expect(pickGranularity(NOV_1, new Date('2026-11-17T10:00:00.000Z'))).toBe('day');
    expect(pickGranularity(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-11-17T10:00:00.000Z'))).toBe('month');
  });

  it('buckets rows by Tashkent day and keeps empty days', () => {
    const buckets = buildIncomeBuckets({
      rangeStart: NOV_1,
      rangeEnd: new Date('2026-11-03T12:00:00.000Z'),
      granularity: 'day',
      rows: [
        { entryDate: new Date('2026-10-31T20:00:00.000Z'), amount: 1_000_000 },
        { entryDate: new Date('2026-11-01T18:59:59.000Z'), amount: 500_000 },
        { entryDate: new Date('2026-11-02T19:30:00.000Z'), amount: 2_000_000 },
        { entryDate: new Date('2026-10-30T10:00:00.000Z'), amount: 9_000_000 },
      ],
    });

    expect(buckets.map((bucket) => [bucket.label, bucket.amount])).toEqual([
      ['1-noy', 1_500_000],
      ['2-noy', 0],
      ['3-noy', 2_000_000],
    ]);
  });

  it('places date-only incomes at the hour they were recorded that day', () => {
    const buckets = buildIncomeBuckets({
      rangeStart: NOV_1,
      rangeEnd: new Date('2026-11-01T10:30:00.000Z'),
      granularity: 'hour',
      rows: [
        // Date-only entry recorded at 14:09 Tashkent (09:09Z).
        { entryDate: NOV_1, createdAt: new Date('2026-11-01T09:09:00.000Z'), amount: 100_000 },
        // Date-only entry for 1 Nov recorded on a later day stays at 00:00.
        { entryDate: NOV_1, createdAt: new Date('2026-11-03T09:00:00.000Z'), amount: 200_000 },
        // An entry with its own time keeps it (10:30 Tashkent).
        { entryDate: new Date('2026-11-01T05:30:00.000Z'), createdAt: new Date('2026-11-01T09:00:00.000Z'), amount: 300_000 },
      ],
    });
    const amountAt = (label: string) => buckets.find((bucket) => bucket.label === label)?.amount;

    expect(amountAt('00:00')).toBe(200_000);
    expect(amountAt('10:00')).toBe(300_000);
    expect(amountAt('14:00')).toBe(100_000);
  });

  it('keeps entryDate when there is no createdAt', () => {
    expect(resolveIncomeInstant({ entryDate: NOV_1 })).toBe(NOV_1);
  });

  it('labels hourly buckets in Tashkent time', () => {
    const buckets = buildIncomeBuckets({
      rangeStart: NOV_1,
      rangeEnd: new Date('2026-10-31T21:10:00.000Z'),
      granularity: 'hour',
      rows: [{ entryDate: new Date('2026-10-31T20:15:00.000Z'), amount: 300_000 }],
    });

    expect(buckets.map((bucket) => [bucket.label, bucket.amount])).toEqual([
      ['00:00', 0],
      ['01:00', 300_000],
      ['02:00', 0],
    ]);
  });

  it('compares today with yesterday up to the same time, and a month with the previous month', () => {
    const today = previousPeriod('today', new Date('2026-11-16T19:00:00.000Z'), new Date('2026-11-17T05:00:00.000Z'));

    expect(today.start.toISOString()).toBe('2026-11-15T19:00:00.000Z');
    expect(today.end.toISOString()).toBe('2026-11-16T05:00:00.000Z');

    const month = previousPeriod('month', NOV_1, new Date('2026-11-17T05:00:00.000Z'));

    expect(month.start.toISOString()).toBe('2026-09-30T19:00:00.000Z');
    expect(month.end.toISOString()).toBe('2026-10-17T05:00:00.000Z');
  });

  it('reports change against the previous period only when it had income', () => {
    expect(percentChange(112, 100)).toBe(12);
    expect(percentChange(50, 0)).toBeNull();
  });
});
