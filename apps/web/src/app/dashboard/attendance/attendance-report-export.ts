export const ATTENDANCE_SUMMARY_SHEET_NAME = 'Xodimlar kesimi';
export const ATTENDANCE_DAILY_SHEET_NAME = 'Kunlik tafsilot';

export const ATTENDANCE_SUMMARY_HEADERS = [
  'Xodim',
  'Username',
  'Ish kunlari',
  'Kelgan kunlar',
  'Kelmagan kunlar',
  'Sababli kunlar',
  'Jami ishlangan',
  'Talab vaqt',
  'Yetishmaydi',
  'Kechikkan kunlar',
  'Jami kechikish (daq)',
  'Anomaliya kunlari',
  "Bog'lanmagan IN",
  "Bog'lanmagan OUT",
] as const;

export const ATTENDANCE_DAILY_HEADERS = [
  'Sana',
  'Xodim',
  'Username',
  'Davomat',
  'Ishlangan',
  'Talab',
  'Yetishmaydi',
  'Kechikish (daq)',
  'Kechikish soni',
  'Birinchi IN',
  'Oxirgi OUT',
  'Anomaliya',
  "Bog'lanmagan IN",
  "Bog'lanmagan OUT",
] as const;

export const ATTENDANCE_SUMMARY_COLUMN_WIDTHS = [
  28, 22, 12, 14, 16, 14, 17, 17, 17, 18, 22, 18, 18, 19,
] as const;

export const ATTENDANCE_DAILY_COLUMN_WIDTHS = [
  12, 28, 22, 20, 15, 15, 15, 18, 17, 20, 20, 14, 18, 19,
] as const;

export const ATTENDANCE_SUMMARY_DURATION_COLUMNS = [6, 7, 8] as const;
export const ATTENDANCE_DAILY_DURATION_COLUMNS = [4, 5, 6] as const;

type SpreadsheetValue = string | number | null;

export type AttendanceExportEmployeeSummary = {
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

export type AttendanceExportDailyRow = {
  userId: string;
  employeeName: string;
  username: string | null;
  summaryDate: string;
  status: 'present' | 'absent' | 'justified';
  workedSeconds: number;
  requiredSeconds: number;
  missingSeconds: number;
  lateMinutes: number;
  lateCount: number;
  firstInAt: Date | string | null;
  lastOutAt: Date | string | null;
  anomalyCount: number;
  unmatchedInCount: number;
  unmatchedOutCount: number;
};

export type AttendanceExportReport = {
  dateFrom: string;
  dateTo: string;
  employeeSummaries: AttendanceExportEmployeeSummary[];
  dailyRows: AttendanceExportDailyRow[];
};

export function sanitizeAttendanceSpreadsheetText(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function secondsToExcelDuration(seconds: number): number {
  return Math.max(0, Number(seconds) || 0) / 86_400;
}

export function formatTashkentDateTime(value: Date | string | null): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function attendanceStatusLabel(status: AttendanceExportDailyRow['status']): string {
  if (status === 'present') return 'Kelgan';
  if (status === 'justified') return 'Sababli kelmagan';
  return 'Kelmagan';
}

export function buildAttendanceSummaryExportRows(
  rows: AttendanceExportEmployeeSummary[],
): SpreadsheetValue[][] {
  return rows.map((row) => [
    sanitizeAttendanceSpreadsheetText(row.employeeName),
    sanitizeAttendanceSpreadsheetText(row.username),
    Number(row.workdayCount),
    Number(row.presentDays),
    Number(row.absentDays),
    Number(row.justifiedDays),
    secondsToExcelDuration(row.workedSeconds),
    secondsToExcelDuration(row.requiredSeconds),
    secondsToExcelDuration(row.missingSeconds),
    Number(row.lateDays),
    Number(row.lateMinutes),
    Number(row.anomalyDays),
    Number(row.unmatchedInCount),
    Number(row.unmatchedOutCount),
  ]);
}

export function buildAttendanceDailyExportRows(rows: AttendanceExportDailyRow[]): SpreadsheetValue[][] {
  return rows.map((row) => [
    row.summaryDate,
    sanitizeAttendanceSpreadsheetText(row.employeeName),
    sanitizeAttendanceSpreadsheetText(row.username),
    attendanceStatusLabel(row.status),
    secondsToExcelDuration(row.workedSeconds),
    secondsToExcelDuration(row.requiredSeconds),
    secondsToExcelDuration(row.missingSeconds),
    Number(row.lateMinutes),
    Number(row.lateCount),
    formatTashkentDateTime(row.firstInAt),
    formatTashkentDateTime(row.lastOutAt),
    Number(row.anomalyCount),
    Number(row.unmatchedInCount),
    Number(row.unmatchedOutCount),
  ]);
}

export function getAttendanceReportFilename(dateFrom: string, dateTo: string): string {
  return `davomat-hisobot-${dateFrom}-${dateTo}.xlsx`;
}
