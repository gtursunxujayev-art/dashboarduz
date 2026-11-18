import { buildCurrentMonthWindow, buildCurrentWeekWindow, buildTodayWindow, resolveReportWindows } from '../telegram-report/windows';

// Report periods in Tashkent time (UTC+5): which scheduled windows are due, and the manual "so far" windows.
function summary(iso: string) {
  return resolveReportWindows(new Date(iso)).map((window) => ({
    kind: window.kind,
    title: window.title,
    start: window.periodStart.toISOString(),
    end: window.periodEnd.toISOString(),
    key: window.periodKey,
  }));
}

describe('scheduled report windows', () => {
  it('sends last week on Monday from 07:55 and yesterday from 10:00', () => {
    // Monday 2026-11-16, 07:54 Tashkent: nothing yet.
    expect(summary('2026-11-16T02:54:00.000Z')).toEqual([]);
    // 07:55: last week only.
    expect(summary('2026-11-16T02:55:00.000Z')).toEqual([{
      kind: 'weekly',
      title: 'Haftalik hisobot (O`tgan hafta)',
      start: '2026-11-08T19:00:00.000Z',
      end: '2026-11-15T18:59:59.999Z',
      key: '2026-11-09_2026-11-15',
    }]);
    // 10:00: yesterday too.
    expect(summary('2026-11-16T05:00:00.000Z').map((window) => window.kind)).toEqual(['daily', 'weekly']);
  });

  it('sends last month on the first day from 07:50', () => {
    expect(summary('2026-12-01T02:49:00.000Z')).toEqual([]);
    expect(summary('2026-12-01T02:50:00.000Z')).toEqual([{
      kind: 'monthly',
      title: 'Oylik hisobot (O`tgan oy)',
      start: '2026-10-31T19:00:00.000Z',
      end: '2026-11-30T18:59:59.999Z',
      key: '2026-11-01_2026-11-30',
    }]);
  });

  it('rolls the monthly window back over a year boundary', () => {
    const [daily, monthly] = summary('2027-01-01T06:00:00.000Z');

    expect(daily).toMatchObject({ kind: 'daily', key: '2026-12-31' });
    expect(monthly).toMatchObject({ kind: 'monthly', key: '2026-12-01_2026-12-31', start: '2026-11-30T19:00:00.000Z' });
  });
});

describe('manual report windows', () => {
  // Wednesday 2026-11-18, 15:30 Tashkent.
  const now = new Date('2026-11-18T10:30:00.000Z');

  it('covers today, this week and this month up to now', () => {
    expect(buildTodayWindow(now)).toEqual({
      kind: 'daily',
      title: 'Tezkor hisobot (Bugun)',
      periodStart: new Date('2026-11-17T19:00:00.000Z'),
      periodEnd: now,
      periodKey: '2026-11-18',
    });
    expect(buildCurrentWeekWindow(now)).toEqual({
      kind: 'weekly',
      title: 'Haftalik hisobot (Joriy hafta)',
      periodStart: new Date('2026-11-15T19:00:00.000Z'),
      periodEnd: now,
      periodKey: '2026-11-16_2026-11-18',
    });
    expect(buildCurrentMonthWindow(now)).toEqual({
      kind: 'monthly',
      title: 'Oylik hisobot (Joriy oy)',
      periodStart: new Date('2026-10-31T19:00:00.000Z'),
      periodEnd: now,
      periodKey: '2026-11-01_2026-11-18',
    });
  });

  it('starts a Sunday week on the previous Monday', () => {
    expect(buildCurrentWeekWindow(new Date('2026-11-22T10:00:00.000Z')).periodKey).toBe('2026-11-16_2026-11-22');
  });
});
