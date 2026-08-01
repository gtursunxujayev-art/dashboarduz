export const ATTENDANCE_REPORT_REQUIRED_SECONDS = 9 * 60 * 60;
export const ATTENDANCE_REPORT_MAX_CALENDAR_DAYS = 366;
export const ATTENDANCE_REPORT_MAX_DETAIL_ROWS = 50_000;

const ELIGIBLE_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent', 'TeamLeader']);
const PRIVILEGED_READ_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);

export type AttendanceReportUser = {
  id: string;
  name: string | null;
  username: string | null;
  roles: string[];
};

export type AttendanceReportStoredSummary = {
  userId: string;
  summaryDate: string;
  workedSeconds: number;
  requiredSeconds: number;
  missingSeconds: number;
  lateMinutes: number;
  lateCount: number;
  absence: boolean;
  unmatchedInCount: number;
  unmatchedOutCount: number;
  anomalyCount: number;
  firstInAt: Date | null;
  lastOutAt: Date | null;
};

export type AttendanceReportStatus = 'present' | 'absent' | 'justified';

export type AttendanceReportDailyRow = {
  userId: string;
  employeeName: string;
  username: string | null;
  summaryDate: string;
  status: AttendanceReportStatus;
  workedSeconds: number;
  requiredSeconds: number;
  missingSeconds: number;
  lateMinutes: number;
  lateCount: number;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  anomalyCount: number;
  unmatchedInCount: number;
  unmatchedOutCount: number;
  synthetic: boolean;
};

export type AttendanceReportEmployeeSummary = {
  userId: string;
  employeeName: string;
  username: string | null;
  workdayCount: number;
  presentDays: number;
  absentDays: number;
  justifiedDays: number;
  workedSeconds: number;
  requiredSeconds: number;
  missingSeconds: number;
  lateDays: number;
  lateMinutes: number;
  anomalyDays: number;
  unmatchedInCount: number;
  unmatchedOutCount: number;
};

export function parseAttendanceReportDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function countAttendanceReportCalendarDays(dateFrom: Date, dateTo: Date): number {
  return Math.floor((dateTo.getTime() - dateFrom.getTime()) / 86_400_000) + 1;
}

export function isAttendanceReportCalendarRangeOverLimit(calendarDayCount: number): boolean {
  return calendarDayCount > ATTENDANCE_REPORT_MAX_CALENDAR_DAYS;
}

export function isAttendanceReportDetailRowLimitExceeded(employeeCount: number, workdayCount: number): boolean {
  return employeeCount * workdayCount > ATTENDANCE_REPORT_MAX_DETAIL_ROWS;
}

export function enumerateAttendanceReportWorkdays(dateFrom: Date, dateTo: Date): string[] {
  const result: string[] = [];
  for (
    let cursor = new Date(dateFrom.getTime());
    cursor.getTime() <= dateTo.getTime();
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    if (cursor.getUTCDay() === 0) continue;
    result.push(cursor.toISOString().slice(0, 10));
  }
  return result;
}

export function isAttendanceReportEligibleUser(user: AttendanceReportUser): boolean {
  return user.roles.some((role) => ELIGIBLE_ROLES.has(role));
}

export function resolveAttendanceReportScopedUserId(roles: string[], currentUserId: string): string | undefined {
  return roles.some((role) => PRIVILEGED_READ_ROLES.has(role)) ? undefined : currentUserId;
}

function compareEmployees(
  a: { employeeName: string; username: string | null; userId?: string; id?: string },
  b: { employeeName: string; username: string | null; userId?: string; id?: string },
): number {
  return a.employeeName.localeCompare(b.employeeName, 'uz')
    || String(a.username || '').localeCompare(String(b.username || ''), 'uz')
    || String(a.userId || a.id || '').localeCompare(String(b.userId || b.id || ''));
}

export function buildAttendancePeriodReport(params: {
  users: AttendanceReportUser[];
  summaries: AttendanceReportStoredSummary[];
  workdayDateKeys: string[];
}): {
  employeeSummaries: AttendanceReportEmployeeSummary[];
  dailyRows: AttendanceReportDailyRow[];
} {
  const usersById = new Map<string, AttendanceReportUser>();
  for (const user of params.users) {
    if (isAttendanceReportEligibleUser(user)) usersById.set(user.id, user);
  }
  const users = Array.from(usersById.values())
    .map((user) => ({
      ...user,
      employeeName: user.name || user.username || user.id,
    }))
    .sort(compareEmployees);

  const summaryByUserDate = new Map(
    params.summaries.map((summary) => [`${summary.userId}|${summary.summaryDate}`, summary]),
  );

  const dailyRows: AttendanceReportDailyRow[] = [];
  const employeeSummaries = new Map<string, AttendanceReportEmployeeSummary>();
  for (const user of users) {
    employeeSummaries.set(user.id, {
      userId: user.id,
      employeeName: user.employeeName,
      username: user.username,
      workdayCount: params.workdayDateKeys.length,
      presentDays: 0,
      absentDays: 0,
      justifiedDays: 0,
      workedSeconds: 0,
      requiredSeconds: 0,
      missingSeconds: 0,
      lateDays: 0,
      lateMinutes: 0,
      anomalyDays: 0,
      unmatchedInCount: 0,
      unmatchedOutCount: 0,
    });
  }

  for (const summaryDate of params.workdayDateKeys) {
    for (const user of users) {
      const stored = summaryByUserDate.get(`${user.id}|${summaryDate}`);
      const present = Boolean(stored?.firstInAt);
      const justified = Boolean(stored && !present && stored.requiredSeconds === 0 && !stored.absence);
      const status: AttendanceReportStatus = present ? 'present' : justified ? 'justified' : 'absent';
      const row: AttendanceReportDailyRow = {
        userId: user.id,
        employeeName: user.employeeName,
        username: user.username,
        summaryDate,
        status,
        workedSeconds: stored?.workedSeconds || 0,
        requiredSeconds: stored ? stored.requiredSeconds : ATTENDANCE_REPORT_REQUIRED_SECONDS,
        missingSeconds: stored ? stored.missingSeconds : ATTENDANCE_REPORT_REQUIRED_SECONDS,
        lateMinutes: stored?.lateMinutes || 0,
        lateCount: stored?.lateCount || 0,
        firstInAt: stored?.firstInAt || null,
        lastOutAt: stored?.lastOutAt || null,
        anomalyCount: stored?.anomalyCount || 0,
        unmatchedInCount: stored?.unmatchedInCount || 0,
        unmatchedOutCount: stored?.unmatchedOutCount || 0,
        synthetic: !stored,
      };
      dailyRows.push(row);

      const total = employeeSummaries.get(user.id)!;
      if (status === 'present') total.presentDays += 1;
      if (status === 'absent') total.absentDays += 1;
      if (status === 'justified') total.justifiedDays += 1;
      total.workedSeconds += row.workedSeconds;
      total.requiredSeconds += row.requiredSeconds;
      total.missingSeconds += row.missingSeconds;
      total.lateDays += row.lateCount > 0 || row.lateMinutes > 0 ? 1 : 0;
      total.lateMinutes += row.lateMinutes;
      total.anomalyDays += row.anomalyCount > 0 ? 1 : 0;
      total.unmatchedInCount += row.unmatchedInCount;
      total.unmatchedOutCount += row.unmatchedOutCount;
    }
  }

  return {
    employeeSummaries: Array.from(employeeSummaries.values()).sort(compareEmployees),
    dailyRows,
  };
}
