export const BONUS_DETAIL_EXPORT_HEADERS = [
  'Sana',
  'Turi',
  'Mijoz',
  'Agent',
  'Kurs/Tarif/Subtarif',
  'Kelishuv summasi',
  'Tushum',
  'Qolgan qarz',
  'Hisoblangan bonus',
  'Debug: Kategoriya',
  'Debug: Fakt',
  'Debug: Foiz',
  'Debug: Fallback',
] as const;

export const BONUS_DETAIL_EXPORT_COLUMN_WIDTHS = [
  12, 22, 34, 24, 42, 18, 16, 16, 20, 20, 14, 14, 16,
] as const;

export type BonusDetailExportRow = {
  entryDate: Date | string;
  type: string;
  customerNumber?: string | null;
  customerName?: string | null;
  managerLabel?: string | null;
  courseName?: string | null;
  tariffName?: string | null;
  subTariffName?: string | null;
  agreementAmount?: number | null;
  paymentAmount?: number | null;
  remainingDebtAmount?: number | null;
  calculatedBonus?: number | null;
  isLastPayment?: boolean | null;
  bonusDebug?: {
    category?: string | null;
    closedCount?: number | null;
    appliedPercent?: number | null;
    usedFallback?: boolean | null;
  } | null;
};

export function sanitizeSpreadsheetText(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function formatBonusExportDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
}

export function buildBonusDetailExportRows(rows: BonusDetailExportRow[]): Array<Array<string | number | null>> {
  return rows.map((row) => [
    formatBonusExportDate(row.entryDate),
    row.type === 'repayment' ? "Qarzdorlik to'lovi" : 'Yangi sotuv',
    sanitizeSpreadsheetText([row.customerNumber, row.customerName].filter(Boolean).join(' - ')),
    sanitizeSpreadsheetText(row.managerLabel || ''),
    sanitizeSpreadsheetText([row.courseName, row.tariffName, row.subTariffName].filter(Boolean).join(' / ') || '-'),
    Number(row.agreementAmount || 0),
    Number(row.paymentAmount || 0),
    Number(row.remainingDebtAmount || 0),
    row.isLastPayment ? Number(row.calculatedBonus || 0) : null,
    sanitizeSpreadsheetText(row.bonusDebug?.category || '-'),
    row.bonusDebug?.closedCount == null ? null : Number(row.bonusDebug.closedCount),
    row.bonusDebug?.appliedPercent == null ? null : Number(row.bonusDebug.appliedPercent),
    row.bonusDebug?.usedFallback ? 'ha' : "yo'q",
  ]);
}
