import { sanitizeSpreadsheetText } from '@/lib/spreadsheet';
import { formatCourseBundle, formatTashkentDate, formatTashkentTimestamp } from '@/lib/format';
export type ReportTab = 'debtors' | 'tariff_change' | 'refund';

export type DebtorReportRow = {
  customerNumber: string;
  customerName: string;
  managerLabel: string;
  courseName: string | null;
  tariffName: string | null;
  firstPaymentDate: Date | string;
  lastPaymentDate: Date | string | null;
  agreementAmount: number;
  paidAmount: number;
  debtAmount: number;
};

export type AdjustmentReportRow = {
  status: string;
  requestDate: Date | string;
  reviewedAt: Date | string | null;
  responseMinutes: number | null;
  reviewedByLabel: string | null;
  customerNumber: string;
  customerName: string;
  managerLabel: string;
  firstPaymentDate: Date | string;
  fromCourseName: string | null;
  fromTariffName: string | null;
  toCourseName: string | null;
  toTariffName: string | null;
  agreementAmount: number;
  newAgreementAmount: number | null;
  paidAmount: number;
  debtAmount: number;
  requestedAmount: number | null;
  reason: string | null;
  reviewNote: string | null;
};

export const DEBTOR_EXPORT_HEADERS = [
  'Mijoz raqami', 'Mijoz', 'Sotuvchi', 'Kurs / Tarif', "Birinchi to'lov", 'Kelishuv', "To'langan", 'Qarz', "Oxirgi to'lov",
] as const;
export const DEBTOR_EXPORT_COLUMN_WIDTHS = [16, 28, 22, 34, 14, 16, 16, 16, 14] as const;

export const TARIFF_CHANGE_EXPORT_HEADERS = [
  "So'rov sanasi", 'Mijoz raqami', 'Mijoz', 'Sotuvchi', "Birinchi to'lov", 'Qaysi kursdan', 'Qaysi kursga',
  'Kelishuv', 'Yangi kelishuv', "To'langan", 'Qarz', 'Holat', 'Javob vaqti', 'Javob vaqti (daqiqa)',
  "Ko'rib chiqdi", 'Izoh', 'Javob izohi',
] as const;
export const TARIFF_CHANGE_EXPORT_COLUMN_WIDTHS = [20, 16, 28, 22, 14, 32, 32, 16, 16, 16, 16, 14, 20, 12, 22, 40, 40] as const;

export const REFUND_EXPORT_HEADERS = [
  "So'rov sanasi", 'Mijoz raqami', 'Mijoz', 'Sotuvchi', "Birinchi to'lov", 'Kurs / Tarif', 'Kelishuv',
  "To'langan", 'Qarz', 'Qaytariladigan summa', 'Holat', 'Javob vaqti', 'Javob vaqti (daqiqa)',
  "Ko'rib chiqdi", 'Izoh', 'Javob izohi',
] as const;
export const REFUND_EXPORT_COLUMN_WIDTHS = [20, 16, 28, 22, 14, 32, 16, 16, 16, 18, 14, 20, 12, 22, 40, 40] as const;

export function formatResponseDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '';
  const total = Math.max(Math.round(minutes), 0);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days > 0) return hours > 0 ? `${days} kun ${hours} soat` : `${days} kun`;
  if (hours > 0) return mins > 0 ? `${hours} soat ${mins} daqiqa` : `${hours} soat`;
  return `${mins} daqiqa`;
}

export function getAdjustmentStatusLabel(status: string): string {
  if (status === 'approved') return 'Tasdiqlangan';
  if (status === 'rejected') return 'Rad etilgan';
  return 'Kutilmoqda';
}

function responseText(row: AdjustmentReportRow): string {
  return row.responseMinutes == null ? 'Kutilmoqda' : formatResponseDuration(row.responseMinutes);
}

export function buildDebtorExportRows(rows: DebtorReportRow[]): Array<Array<string | number | null>> {
  return rows.map((row) => [
    sanitizeSpreadsheetText(row.customerNumber),
    sanitizeSpreadsheetText(row.customerName),
    sanitizeSpreadsheetText(row.managerLabel),
    sanitizeSpreadsheetText(formatCourseBundle(row.courseName, row.tariffName)),
    formatTashkentDate(row.firstPaymentDate, ''),
    Number(row.agreementAmount || 0),
    Number(row.paidAmount || 0),
    Number(row.debtAmount || 0),
    formatTashkentDate(row.lastPaymentDate, ''),
  ]);
}

export function buildTariffChangeExportRows(rows: AdjustmentReportRow[]): Array<Array<string | number | null>> {
  return rows.map((row) => [
    formatTashkentTimestamp(row.requestDate, { withSeconds: false }),
    sanitizeSpreadsheetText(row.customerNumber),
    sanitizeSpreadsheetText(row.customerName),
    sanitizeSpreadsheetText(row.managerLabel),
    formatTashkentDate(row.firstPaymentDate, ''),
    sanitizeSpreadsheetText(formatCourseBundle(row.fromCourseName, row.fromTariffName)),
    sanitizeSpreadsheetText(formatCourseBundle(row.toCourseName, row.toTariffName)),
    Number(row.agreementAmount || 0),
    row.newAgreementAmount == null ? null : Number(row.newAgreementAmount),
    Number(row.paidAmount || 0),
    Number(row.debtAmount || 0),
    getAdjustmentStatusLabel(row.status),
    responseText(row),
    row.responseMinutes,
    sanitizeSpreadsheetText(row.reviewedByLabel || ''),
    sanitizeSpreadsheetText(row.reason || ''),
    sanitizeSpreadsheetText(row.reviewNote || ''),
  ]);
}

export function buildRefundExportRows(rows: AdjustmentReportRow[]): Array<Array<string | number | null>> {
  return rows.map((row) => [
    formatTashkentTimestamp(row.requestDate, { withSeconds: false }),
    sanitizeSpreadsheetText(row.customerNumber),
    sanitizeSpreadsheetText(row.customerName),
    sanitizeSpreadsheetText(row.managerLabel),
    formatTashkentDate(row.firstPaymentDate, ''),
    sanitizeSpreadsheetText(formatCourseBundle(row.fromCourseName, row.fromTariffName)),
    Number(row.agreementAmount || 0),
    Number(row.paidAmount || 0),
    Number(row.debtAmount || 0),
    row.requestedAmount == null ? null : Number(row.requestedAmount),
    getAdjustmentStatusLabel(row.status),
    responseText(row),
    row.responseMinutes,
    sanitizeSpreadsheetText(row.reviewedByLabel || ''),
    sanitizeSpreadsheetText(row.reason || ''),
    sanitizeSpreadsheetText(row.reviewNote || ''),
  ]);
}

const REPORT_FILE_PREFIX: Record<ReportTab, string> = {
  debtors: 'qarzdorlar',
  tariff_change: 'kurs-ozgartirganlar',
  refund: 'pul-qaytarish-sorovlari',
};

export function getReportFilename(tab: ReportTab, dateFrom?: string, dateTo?: string): string {
  const range = [dateFrom, dateTo].filter(Boolean).join('_');
  return `${REPORT_FILE_PREFIX[tab]}${range ? `_${range}` : ''}.xlsx`;
}
