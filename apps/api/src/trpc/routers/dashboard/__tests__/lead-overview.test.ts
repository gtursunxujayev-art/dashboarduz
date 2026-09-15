import { calculateLeadPeriods } from '../lead-overview';

describe('dashboard lead overview', () => {
  it('buckets all leads into Tashkent day, Monday-start week, and month', () => {
    const result = calculateLeadPeriods({
      now: new Date('2026-09-15T10:00:00.000Z'),
      dayStart: new Date('2026-09-14T19:00:00.000Z'),
      weekStart: new Date('2026-09-13T19:00:00.000Z'),
      monthStart: new Date('2026-08-31T19:00:00.000Z'),
      reasonFieldKey: 'metadata:quality',
      qualifiedValues: ['Sifatli'],
      nonQualifiedValues: ['Sifatsiz'],
      qualifiedStageIds: ['qualified-stage'],
      leads: [
        { created_at: '2026-09-15T05:00:00.000Z', status_id: 'qualified-stage' },
        { created_at: '2026-09-14T08:00:00.000Z', status_id: 'other', quality: 'Sifatsiz' },
        { created_at: '2026-09-05T08:00:00.000Z', status_id: 'other' },
        { created_at: '2026-08-30T08:00:00.000Z', status_id: 'qualified-stage' },
      ],
    });

    expect(result.daily).toEqual({ total: 1, qualified: 1, nonQualified: 0 });
    expect(result.weekly).toEqual({ total: 2, qualified: 1, nonQualified: 1 });
    expect(result.monthly).toEqual({ total: 3, qualified: 1, nonQualified: 1 });
  });

  it('falls back to configured qualified values when no stages are configured', () => {
    const result = calculateLeadPeriods({
      now: new Date('2026-09-15T10:00:00.000Z'),
      dayStart: new Date('2026-09-14T19:00:00.000Z'),
      weekStart: new Date('2026-09-13T19:00:00.000Z'),
      monthStart: new Date('2026-08-31T19:00:00.000Z'),
      reasonFieldKey: 'metadata:quality',
      qualifiedValues: ['Sifatli'],
      nonQualifiedValues: ['Sifatsiz'],
      qualifiedStageIds: [],
      leads: [{ created_at: '2026-09-15T05:00:00.000Z', quality: 'Sifatli' }],
    });

    expect(result.monthly.qualified).toBe(1);
  });
});
