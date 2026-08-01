import { describe, expect, it } from '@jest/globals';
import {
  ATTENDANCE_DAILY_DURATION_COLUMNS,
  ATTENDANCE_DAILY_HEADERS,
  ATTENDANCE_DAILY_SHEET_NAME,
  ATTENDANCE_SUMMARY_DURATION_COLUMNS,
  ATTENDANCE_SUMMARY_HEADERS,
  ATTENDANCE_SUMMARY_SHEET_NAME,
  buildAttendanceDailyExportRows,
  buildAttendanceSummaryExportRows,
  formatTashkentDateTime,
  getAttendanceReportFilename,
  sanitizeAttendanceSpreadsheetText,
  secondsToExcelDuration,
} from './attendance-report-export';

describe('attendance period XLSX export', () => {
  it('defines the two worksheets and stable column order', () => {
    expect(ATTENDANCE_SUMMARY_SHEET_NAME).toBe('Xodimlar kesimi');
    expect(ATTENDANCE_DAILY_SHEET_NAME).toBe('Kunlik tafsilot');
    expect(ATTENDANCE_SUMMARY_HEADERS).toEqual([
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
    ]);
    expect(ATTENDANCE_DAILY_HEADERS).toHaveLength(14);
    expect(ATTENDANCE_SUMMARY_DURATION_COLUMNS).toEqual([6, 7, 8]);
    expect(ATTENDANCE_DAILY_DURATION_COLUMNS).toEqual([4, 5, 6]);
  });

  it('stores durations and counts as numeric spreadsheet values', () => {
    const [row] = buildAttendanceSummaryExportRows([{
      userId: 'user-1',
      employeeName: 'Ali Valiyev',
      username: 'ali',
      workdayCount: 2,
      presentDays: 1,
      absentDays: 1,
      justifiedDays: 0,
      workedSeconds: 9 * 60 * 60,
      requiredSeconds: 18 * 60 * 60,
      missingSeconds: 9 * 60 * 60,
      lateDays: 1,
      lateMinutes: 15,
      anomalyDays: 1,
      unmatchedInCount: 2,
      unmatchedOutCount: 3,
    }]);

    expect(row?.[6]).toBe(0.375);
    expect(row?.[7]).toBe(0.75);
    expect(row?.[8]).toBe(0.375);
    expect(row?.slice(9)).toEqual([1, 15, 1, 2, 3]);
    expect(secondsToExcelDuration(-1)).toBe(0);
  });

  it('labels attendance, formats Tashkent timestamps, and sanitizes text', () => {
    const rows = buildAttendanceDailyExportRows([
      {
        userId: 'user-1',
        employeeName: '=BAD()',
        username: '+formula',
        summaryDate: '2026-08-01',
        status: 'present',
        workedSeconds: 32_400,
        requiredSeconds: 32_400,
        missingSeconds: 0,
        lateMinutes: 5,
        lateCount: 1,
        firstInAt: '2026-08-01T03:00:00.000Z',
        lastOutAt: '2026-08-01T12:00:00.000Z',
        anomalyCount: 0,
        unmatchedInCount: 0,
        unmatchedOutCount: 0,
      },
      {
        userId: 'user-1',
        employeeName: 'Ali',
        username: null,
        summaryDate: '2026-08-02',
        status: 'justified',
        workedSeconds: 0,
        requiredSeconds: 0,
        missingSeconds: 0,
        lateMinutes: 0,
        lateCount: 0,
        firstInAt: null,
        lastOutAt: null,
        anomalyCount: 0,
        unmatchedInCount: 0,
        unmatchedOutCount: 0,
      },
    ]);

    expect(rows[0]?.[1]).toBe("'=BAD()");
    expect(rows[0]?.[2]).toBe("'+formula");
    expect(rows[0]?.[3]).toBe('Kelgan');
    expect(rows[0]?.[9]).toBe('2026-08-01 08:00:00');
    expect(rows[0]?.[10]).toBe('2026-08-01 17:00:00');
    expect(rows[1]?.[3]).toBe('Sababli kelmagan');
    expect(sanitizeAttendanceSpreadsheetText('Normal')).toBe('Normal');
    expect(formatTashkentDateTime(null)).toBe('');
  });

  it('uses the selected normalized period in the filename', () => {
    expect(getAttendanceReportFilename('2026-07-01', '2026-07-31'))
      .toBe('davomat-hisobot-2026-07-01-2026-07-31.xlsx');
  });
});
