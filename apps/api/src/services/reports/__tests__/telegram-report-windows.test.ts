import {
  buildCurrentMonthWindow,
  buildCurrentWeekWindow,
  buildTodayWindow,
  resolveReportWindows,
} from '../telegram-report/windows';

/** ISO strings of a window's dates, so expectations read as plain data. */
function plain(window: { kind: string; title: string; periodStart: Date; periodEnd: Date; periodKey: string }) {
  return {
    kind: window.kind,
    title: window.title,
    periodStart: window.periodStart.toISOString(),
    periodEnd: window.periodEnd.toISOString(),
    periodKey: window.periodKey,
  };
}

describe('scheduled Telegram report windows', () => {
  // 2026-06-01 is a Monday and the first of the month, so every schedule can fire (Tashkent is UTC+5).
  it('gives nothing before 07:50 Tashkent', () => {
    expect(resolveReportWindows(new Date('2026-06-01T02:49:59.000Z'))).toEqual([]);
  });

  it('opens the monthly window at 07:50 and the weekly one at 07:55', () => {
    expect(resolveReportWindows(new Date('2026-06-01T02:52:00.000Z')).map((window) => window.kind)).toEqual(['monthly']);
    expect(resolveReportWindows(new Date('2026-06-01T02:55:00.000Z')).map((window) => window.kind)).toEqual(['weekly', 'monthly']);
  });

  it('covers yesterday, the previous Monday-Sunday week and the previous month from 10:00', () => {
    expect(resolveReportWindows(new Date('2026-06-01T05:00:00.000Z')).map(plain)).toEqual([
      {
        kind: 'daily',
        title: 'Kunlik hisobot (Kecha)',
        periodStart: '2026-05-30T19:00:00.000Z',
        periodEnd: '2026-05-31T18:59:59.999Z',
        periodKey: '2026-05-31',
      },
      {
        kind: 'weekly',
        title: 'Haftalik hisobot (O`tgan hafta)',
        periodStart: '2026-05-24T19:00:00.000Z',
        periodEnd: '2026-05-31T18:59:59.999Z',
        periodKey: '2026-05-25_2026-05-31',
      },
      {
        kind: 'monthly',
        title: 'Oylik hisobot (O`tgan oy)',
        periodStart: '2026-04-30T19:00:00.000Z',
        periodEnd: '2026-05-31T18:59:59.999Z',
        periodKey: '2026-05-01_2026-05-31',
      },
    ]);
  });

  it('only has the daily window on an ordinary weekday', () => {
    // Wednesday 2026-11-18, 17:00 Tashkent.
    expect(resolveReportWindows(new Date('2026-11-18T12:00:00.000Z')).map((window) => window.periodKey)).toEqual(['2026-11-17']);
  });
});

describe('manual Telegram report windows', () => {
  const now = new Date('2026-11-18T12:00:00.000Z'); // Wednesday, 17:00 Tashkent

  it('runs today from Tashkent midnight to now', () => {
    expect(plain(buildTodayWindow(now))).toEqual({
      kind: 'daily',
      title: 'Tezkor hisobot (Bugun)',
      periodStart: '2026-11-17T19:00:00.000Z',
      periodEnd: '2026-11-18T12:00:00.000Z',
      periodKey: '2026-11-18',
    });
  });

  it('runs the current week from Monday', () => {
    expect(plain(buildCurrentWeekWindow(now))).toEqual({
      kind: 'weekly',
      title: 'Haftalik hisobot (Joriy hafta)',
      periodStart: '2026-11-15T19:00:00.000Z',
      periodEnd: '2026-11-18T12:00:00.000Z',
      periodKey: '2026-11-16_2026-11-18',
    });
  });

  it('runs the current month from the first', () => {
    expect(plain(buildCurrentMonthWindow(now))).toEqual({
      kind: 'monthly',
      title: 'Oylik hisobot (Joriy oy)',
      periodStart: '2026-10-31T19:00:00.000Z',
      periodEnd: '2026-11-18T12:00:00.000Z',
      periodKey: '2026-11-01_2026-11-18',
    });
  });

  it('treats a UTC evening that is already the next Tashkent day as that day', () => {
    // 2026-11-30T20:00Z is 01:00 on 1 December in Tashkent.
    expect(buildTodayWindow(new Date('2026-11-30T20:00:00.000Z')).periodKey).toBe('2026-12-01');
    expect(buildCurrentMonthWindow(new Date('2026-11-30T20:00:00.000Z')).periodKey).toBe('2026-12-01_2026-12-01');
  });
});
