import {
  ATTENDANCE_REPORT_MAX_CALENDAR_DAYS,
  ATTENDANCE_REPORT_MAX_DETAIL_ROWS,
  ATTENDANCE_REPORT_REQUIRED_SECONDS,
  buildAttendancePeriodReport,
  countAttendanceReportCalendarDays,
  enumerateAttendanceReportWorkdays,
  isAttendanceReportCalendarRangeOverLimit,
  isAttendanceReportDetailRowLimitExceeded,
  isAttendanceReportEligibleUser,
  parseAttendanceReportDateKey,
  resolveAttendanceReportScopedUserId,
} from '../report';

describe('period attendance report', () => {
  it('validates real dates and counts inclusive calendar days', () => {
    expect(parseAttendanceReportDateKey('2026-02-28')?.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(parseAttendanceReportDateKey('2026-02-29')).toBeNull();
    expect(parseAttendanceReportDateKey('2026/02/28')).toBeNull();
    expect(countAttendanceReportCalendarDays(
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-03T00:00:00.000Z'),
    )).toBe(3);
  });

  it('enumerates Monday-Saturday and excludes Sunday', () => {
    expect(enumerateAttendanceReportWorkdays(
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-08-03T00:00:00.000Z'),
    )).toEqual(['2026-08-01', '2026-08-03']);
  });

  it('enforces calendar and generated-row limits at their boundaries', () => {
    expect(isAttendanceReportCalendarRangeOverLimit(ATTENDANCE_REPORT_MAX_CALENDAR_DAYS)).toBe(false);
    expect(isAttendanceReportCalendarRangeOverLimit(ATTENDANCE_REPORT_MAX_CALENDAR_DAYS + 1)).toBe(true);
    expect(isAttendanceReportDetailRowLimitExceeded(500, ATTENDANCE_REPORT_MAX_DETAIL_ROWS / 500)).toBe(false);
    expect(isAttendanceReportDetailRowLimitExceeded(501, 100)).toBe(true);
  });

  it('uses the selected eligible roles and preserves privileged/self scopes', () => {
    expect(isAttendanceReportEligibleUser({ id: 'a', name: null, username: null, roles: ['Agent'] })).toBe(true);
    expect(isAttendanceReportEligibleUser({ id: 'b', name: null, username: null, roles: ['OnlineAgent', 'TeamLeader'] })).toBe(true);
    expect(isAttendanceReportEligibleUser({ id: 'c', name: null, username: null, roles: ['Manager'] })).toBe(false);
    expect(resolveAttendanceReportScopedUserId(['Agent'], 'agent-a')).toBe('agent-a');
    expect(resolveAttendanceReportScopedUserId(['Agent', 'Manager'], 'agent-a')).toBeUndefined();
    expect(resolveAttendanceReportScopedUserId(['TeamLeader'], 'leader-a')).toBeUndefined();
    expect(resolveAttendanceReportScopedUserId(['Finance'], 'finance-a')).toBeUndefined();
  });

  it('uses stored summaries, synthesizes absences, keeps justified days, and aggregates deterministically', () => {
    const firstIn = new Date('2026-08-01T04:00:00.000Z');
    const lastOut = new Date('2026-08-01T13:00:00.000Z');
    const result = buildAttendancePeriodReport({
      workdayDateKeys: ['2026-08-01', '2026-08-03'],
      users: [
        { id: 'b', name: 'Bobur', username: 'bobur', roles: ['OfflineAgent'] },
        { id: 'x', name: 'Excluded', username: 'excluded', roles: ['Manager'] },
        { id: 'a', name: 'Ali', username: 'ali', roles: ['Agent', 'OnlineAgent'] },
      ],
      summaries: [
        {
          userId: 'a',
          summaryDate: '2026-08-01',
          workedSeconds: 8 * 60 * 60,
          requiredSeconds: ATTENDANCE_REPORT_REQUIRED_SECONDS,
          missingSeconds: 60 * 60,
          lateMinutes: 12,
          lateCount: 1,
          absence: false,
          unmatchedInCount: 1,
          unmatchedOutCount: 0,
          anomalyCount: 1,
          firstInAt: firstIn,
          lastOutAt: lastOut,
        },
        {
          userId: 'b',
          summaryDate: '2026-08-01',
          workedSeconds: 0,
          requiredSeconds: 0,
          missingSeconds: 0,
          lateMinutes: 0,
          lateCount: 0,
          absence: false,
          unmatchedInCount: 0,
          unmatchedOutCount: 0,
          anomalyCount: 0,
          firstInAt: null,
          lastOutAt: null,
        },
      ],
    });

    expect(result.employeeSummaries.map((row) => row.employeeName)).toEqual(['Ali', 'Bobur']);
    expect(result.dailyRows.map((row) => `${row.summaryDate}:${row.employeeName}:${row.status}`)).toEqual([
      '2026-08-01:Ali:present',
      '2026-08-01:Bobur:justified',
      '2026-08-03:Ali:absent',
      '2026-08-03:Bobur:absent',
    ]);
    expect(result.dailyRows[0]).toMatchObject({
      workedSeconds: 8 * 60 * 60,
      firstInAt: firstIn,
      synthetic: false,
    });
    expect(result.dailyRows[2]).toMatchObject({
      requiredSeconds: ATTENDANCE_REPORT_REQUIRED_SECONDS,
      missingSeconds: ATTENDANCE_REPORT_REQUIRED_SECONDS,
      synthetic: true,
    });
    expect(result.employeeSummaries[0]).toMatchObject({
      presentDays: 1,
      absentDays: 1,
      justifiedDays: 0,
      workedSeconds: 8 * 60 * 60,
      requiredSeconds: 2 * ATTENDANCE_REPORT_REQUIRED_SECONDS,
      missingSeconds: 10 * 60 * 60,
      lateDays: 1,
      lateMinutes: 12,
      anomalyDays: 1,
      unmatchedInCount: 1,
    });
    expect(result.employeeSummaries[1]).toMatchObject({
      presentDays: 0,
      absentDays: 1,
      justifiedDays: 1,
      requiredSeconds: ATTENDANCE_REPORT_REQUIRED_SECONDS,
      missingSeconds: ATTENDANCE_REPORT_REQUIRED_SECONDS,
    });
  });
});
