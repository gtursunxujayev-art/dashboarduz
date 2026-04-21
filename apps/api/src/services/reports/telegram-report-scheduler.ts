import { prisma } from '@dashboarduz/db';
import { log, LogLevel } from '../observability';
import { telegramService } from '../integrations/telegram';
import { parseTelegramRecipients } from '../integrations/telegram-recipients';
import { decryptIntegrationTokens } from '../security/encryption';
import { getRedisClient } from '../queue/redis-client';
import { amocrmService } from '../integrations/amocrm';
import { extractLeadValue, getTenantAmoCRMContext, humanizeKey } from '../integrations/amocrm-live';
import { getCorporateCallDurationByManager, getCorporateCallDurationTotal } from '../corporate-call-durations';

const REPORT_TIMEZONE_OFFSET_MS = 5 * 60 * 60 * 1000; // GMT+5
const REPORT_TIMEZONE_LABEL = 'GMT+5';
const POLL_INTERVAL_MS = 30_000;
const LOCK_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days
const MIN_DAILY_REPORT_PREP_MS = 10_000;
const MIN_WEEKLY_REPORT_PREP_MS = 20_000;
const MIN_MONTHLY_REPORT_PREP_MS = 30_000;

type ReportKind = 'daily' | 'weekly' | 'monthly';

type ReportWindow = {
  kind: ReportKind;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  periodKey: string;
};

type ManualReportKind = 'today' | 'weekly' | 'monthly';

type ReportMetrics = {
  newLeads: number;
  qualifiedLeads: number;
  nonQualifiedLeads: number;
  qualifiedShare: number;
  nonQualifiedShare: number;
  newSalesCount: number;
  conversionPercent: number;
  agreementTotal: number;
  incomeTotal: number;
  newSalesIncomeTotal: number;
  debtRepaymentIncomeTotal: number;
  onlineSalesCount: number;
  onlineAgreementTotal: number;
  offlineSalesCount: number;
  offlineAgreementTotal: number;
  intensiveSalesCount: number;
  intensiveAgreementTotal: number;
  totalCalls: number;
  talkDurationSeconds: number;
  reasonBreakdown: Array<{ label: string; value: number }>;
  sourceBreakdown: Array<{ label: string; value: number }>;
  managerRows: Array<{
    name: string;
    leads: number;
    qualified: number;
    sales: number;
    conversion: number;
    amount: number;
    callDurationSeconds: number;
  }>;
};

type TelegramIntegrationWithTenant = {
  id: string;
  tenantId: string;
  tokensEncrypted: string | null;
  config: unknown;
  tenant: {
    name: string | null;
    settings: unknown;
  };
};

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerInProgress = false;

function toLocalDate(date: Date): Date {
  return new Date(date.getTime() + REPORT_TIMEZONE_OFFSET_MS);
}

function fromLocalParts(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  return new Date(Date.UTC(year, month, day, hour, minute, second, millisecond) - REPORT_TIMEZONE_OFFSET_MS);
}

function formatLocalDate(date: Date): string {
  const local = toLocalDate(date);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalDateTime(date: Date): string {
  const local = toLocalDate(date);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  const hour = String(local.getUTCHours()).padStart(2, '0');
  const minute = String(local.getUTCMinutes()).padStart(2, '0');
  const second = String(local.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${REPORT_TIMEZONE_LABEL}`;
}

function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} UZS`;
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function normalizePercentage(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Number(value.toFixed(2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDigits(value: unknown): string {
  return String(value || '').replace(/[^\d]/g, '');
}

function isAllowedUtelManagerExtension(value: unknown): boolean {
  const digits = normalizeDigits(value);
  if (!digits) {
    return false;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 150;
}

function getReportTenantName(value: string | null | undefined): string {
  const normalized = String(value || '').trim();
  return normalized || 'Workspace';
}

function escapePdfText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

type PdfColor = [number, number, number];
type PdfFont = 'F1' | 'F2';

class PdfCanvas {
  private readonly pageWidth = 595;
  private readonly pageHeight = 842;
  private readonly commands: string[] = [];

  private toPdfY(top: number, height = 0): number {
    return this.pageHeight - top - height;
  }

  private fmt(value: number): string {
    return Number(value.toFixed(3)).toString();
  }

  setFill(color: PdfColor) {
    this.commands.push(`${this.fmt(color[0])} ${this.fmt(color[1])} ${this.fmt(color[2])} rg`);
  }

  setStroke(color: PdfColor) {
    this.commands.push(`${this.fmt(color[0])} ${this.fmt(color[1])} ${this.fmt(color[2])} RG`);
  }

  setLineWidth(width: number) {
    this.commands.push(`${this.fmt(width)} w`);
  }

  rect(top: number, left: number, width: number, height: number, options: {
    fill?: PdfColor;
    stroke?: PdfColor;
    lineWidth?: number;
  } = {}) {
    if (options.fill) this.setFill(options.fill);
    if (options.stroke) this.setStroke(options.stroke);
    if (options.lineWidth !== undefined) this.setLineWidth(options.lineWidth);
    this.commands.push(
      `${this.fmt(left)} ${this.fmt(this.toPdfY(top, height))} ${this.fmt(width)} ${this.fmt(height)} re`,
    );
    if (options.fill && options.stroke) {
      this.commands.push('B');
    } else if (options.fill) {
      this.commands.push('f');
    } else {
      this.commands.push('S');
    }
  }

  text(top: number, left: number, text: string, options: {
    size?: number;
    color?: PdfColor;
    font?: PdfFont;
  } = {}) {
    const font = options.font || 'F1';
    const size = options.size || 10;
    const color = options.color || ([0.11, 0.16, 0.24] as PdfColor);
    const escaped = escapePdfText(text);
    const baselineY = this.toPdfY(top) - size;
    this.commands.push('BT');
    this.commands.push(`${font === 'F2' ? '/F2' : '/F1'} ${this.fmt(size)} Tf`);
    this.commands.push(`${this.fmt(color[0])} ${this.fmt(color[1])} ${this.fmt(color[2])} rg`);
    this.commands.push(`${this.fmt(left)} ${this.fmt(baselineY)} Td`);
    this.commands.push(`(${escaped}) Tj`);
    this.commands.push('ET');
  }

  build(): Buffer {
    const contentStream = this.commands.join('\n');
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>\nendobj\n',
      `4 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      '6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    ];

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += object;
    }

    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    for (let index = 1; index < offsets.length; index += 1) {
      pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return Buffer.from(pdf, 'utf8');
  }
}

function topBreakdownRows(entries: Array<{ label: string; value: number }>, fallbackLabel: string): string[] {
  if (!entries.length) {
    return [`${fallbackLabel}: 0`];
  }
  return entries.slice(0, 5).map((entry) => {
    const normalizedLabel = entry.label.trim().length > 0
      ? humanizeKey(entry.label)
      : fallbackLabel;
    return `${normalizedLabel}: ${entry.value}`;
  });
}

function createStyledReportPdf(params: {
  tenantName: string;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  metrics: ReportMetrics;
}): Buffer {
  const c = new PdfCanvas();
  const dark: PdfColor = [0.03, 0.08, 0.2];
  const lightBorder: PdfColor = [0.72, 0.78, 0.86];
  const cardBg: PdfColor = [0.96, 0.97, 0.99];
  const textDark: PdfColor = [0.11, 0.16, 0.24];
  const accent: PdfColor = [0.12, 0.4, 0.95];
  const white: PdfColor = [1, 1, 1];
  const headerDateRange = `${formatLocalDate(params.periodStart)} - ${formatLocalDate(params.periodEnd)}`;
  const fontDelta = -2;
  const size = (base: number): number => Math.max(6, base + fontDelta);

  c.rect(16, 24, 547, 62, { fill: dark });
  c.text(28, 44, params.tenantName, { font: 'F2', size: size(20), color: white });
  c.text(52, 270, params.title, { font: 'F1', size: size(12), color: [0.76, 0.82, 0.92] });
  c.text(28, 360, `Sana: ${headerDateRange}`, { size: size(10), color: [0.76, 0.82, 0.92] });
  c.text(92, 44, `Davr: ${formatLocalDate(params.periodStart)} - ${formatLocalDate(params.periodEnd)}`, { size: size(10), color: textDark });
  c.text(106, 44, `Tayyorlangan: ${formatLocalDateTime(params.generatedAt)}`, { size: size(10), color: textDark });

  const cardTop = 130;
  const cardHeight = 60;
  const cardRowStep = 74;
  const cardLeft = (col: number) => 44 + col * 172;
  const cardRowTop = (row: number) => cardTop + row * cardRowStep;

  const drawStandardCard = (row: number, col: number, title: string, value: string) => {
    const top = cardRowTop(row);
    const left = cardLeft(col);
    c.rect(top, left, 160, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
    c.text(top + 12, left + 10, title, { size: size(9), color: [0.4, 0.46, 0.56] });
    c.text(top + 30, left + 10, value, { font: 'F2', size: size(14), color: accent });
  };

  drawStandardCard(0, 0, 'Kelishuv summasi', formatCurrency(params.metrics.agreementTotal));
  drawStandardCard(0, 2, 'Online kelishuv summasi', formatCurrency(params.metrics.onlineAgreementTotal));
  drawStandardCard(1, 0, 'Offline kelishuv summasi', formatCurrency(params.metrics.offlineAgreementTotal));
  drawStandardCard(1, 2, 'Sifatli lidlar', `${params.metrics.qualifiedLeads} (${params.metrics.qualifiedShare.toFixed(1)}%)`);

  // Tushum card with new-sale vs debt-repayment split.
  const incomeTop = cardRowTop(0);
  const incomeLeft = cardLeft(1);
  c.rect(incomeTop, incomeLeft, 160, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  c.text(incomeTop + 12, incomeLeft + 10, 'Tushum', { size: size(9), color: [0.4, 0.46, 0.56] });
  c.text(incomeTop + 26, incomeLeft + 10, formatCurrency(params.metrics.incomeTotal), { font: 'F2', size: size(14), color: accent });
  c.text(incomeTop + 41, incomeLeft + 10, `Yangi sotuv: ${formatCurrency(params.metrics.newSalesIncomeTotal)}`, {
    size: size(8),
    color: textDark,
  });
  c.text(incomeTop + 51, incomeLeft + 10, `Qarz to'lovi: ${formatCurrency(params.metrics.debtRepaymentIncomeTotal)}`, {
    size: size(8),
    color: textDark,
  });

  // Split half cards in the middle slot of row 2 (by width).
  const splitTop = cardRowTop(1);
  const splitLeft = cardLeft(1);
  const splitGap = 4;
  const splitWidth = Math.floor((160 - splitGap) / 2);

  c.rect(splitTop, splitLeft, splitWidth, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  c.text(splitTop + 10, splitLeft + 8, 'Yangi lidlar', { size: size(8), color: [0.4, 0.46, 0.56] });
  c.text(splitTop + 30, splitLeft + 8, String(params.metrics.newLeads), { font: 'F2', size: size(12), color: accent });

  const salesLeft = splitLeft + splitWidth + splitGap;
  c.rect(splitTop, salesLeft, splitWidth, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  c.text(splitTop + 10, salesLeft + 8, 'Sotuv', { size: size(8), color: [0.4, 0.46, 0.56] });
  c.text(splitTop + 24, salesLeft + 8, String(params.metrics.newSalesCount), { font: 'F2', size: size(10), color: accent });
  c.text(
    splitTop + 38,
    salesLeft + 8,
    `On: ${params.metrics.onlineSalesCount}`,
    { size: size(7.5), color: textDark },
  );
  c.text(
    splitTop + 49,
    salesLeft + 8,
    `Of: ${params.metrics.offlineSalesCount}`,
    { size: size(7.5), color: textDark },
  );

  c.rect(276, 44, 503, 116, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  c.text(288, 54, `Sifatsiz lidlar: ${params.metrics.nonQualifiedLeads}`, { font: 'F2', size: size(12), color: textDark });
  c.text(306, 54, `Yangi sotuvlar: ${params.metrics.newSalesCount}`, { font: 'F2', size: size(12), color: textDark });
  c.text(324, 54, `Coversion (sotuv -> lid): ${params.metrics.conversionPercent.toFixed(2)}%`, { font: 'F2', size: size(12), color: textDark });
  c.text(342, 54, `Qo'ng'iroqlar: ${params.metrics.totalCalls}`, { size: size(11), color: textDark });
  c.text(358, 54, `Suhbat davomiyligi: ${formatDuration(params.metrics.talkDurationSeconds)}`, { size: size(11), color: textDark });
  c.text(374, 54, `Online/Offline/Intensiv sotuvlar: ${params.metrics.onlineSalesCount}/${params.metrics.offlineSalesCount}/${params.metrics.intensiveSalesCount}`, { size: size(10), color: textDark });

  c.rect(410, 44, 503, 22, { fill: [0.12, 0.16, 0.24] });
  c.text(414, 54, 'Sifatsiz lid sabablari', { font: 'F2', size: size(12), color: white });
  let y = 438;
  const reasonLines = topBreakdownRows(params.metrics.reasonBreakdown, "Ma'lumot yo'q").slice(0, 2);
  for (const line of reasonLines) {
    c.text(y, 54, line, { size: size(10), color: textDark });
    y += 14;
  }

  c.rect(498, 44, 503, 22, { fill: [0.12, 0.16, 0.24] });
  c.text(502, 54, 'Lid manbalari', { font: 'F2', size: size(12), color: white });
  y = 526;
  const sourceLines = topBreakdownRows(params.metrics.sourceBreakdown, "Ma'lumot yo'q").slice(0, 2);
  for (const line of sourceLines) {
    c.text(y, 54, line, { size: size(10), color: textDark });
    y += 14;
  }

  c.rect(588, 44, 503, 22, { fill: [0.12, 0.16, 0.24] });
  c.text(592, 54, "Menejerlar bo'yicha sotuvlar", { font: 'F2', size: size(12), color: white });

  const tableTop = 614;
  const columns = [
    { key: 'name', title: 'Menejer', width: 110 },
    { key: 'leads', title: 'Lidlar', width: 55 },
    { key: 'qualified', title: 'Sifatli', width: 60 },
    { key: 'sales', title: 'Sotuv', width: 55 },
    { key: 'conversion', title: 'Coversion', width: 70 },
    { key: 'amount', title: 'Summasi', width: 85 },
    { key: 'duration', title: 'Suhbat', width: 68 },
  ] as const;
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

  c.rect(tableTop, 54, tableWidth, 20, { fill: [0.92, 0.94, 0.98], stroke: lightBorder, lineWidth: 0.8 });
  let x = 56;
  for (const column of columns) {
    c.text(tableTop + 5, x, column.title, { font: 'F2', size: size(9), color: textDark });
    x += column.width;
  }

  const rows = params.metrics.managerRows.length > 0
    ? params.metrics.managerRows
    : [{ name: "Menejer ma'lumoti yo'q", leads: 0, qualified: 0, sales: 0, conversion: 0, amount: 0, callDurationSeconds: 0 }];
  const shownRows = rows.slice(0, 9);
  for (const [index, row] of shownRows.entries()) {
    const rowTop = tableTop + 20 + index * 18;
    c.rect(rowTop, 54, tableWidth, 18, {
      fill: index % 2 === 0 ? ([1, 1, 1] as PdfColor) : ([0.98, 0.99, 1] as PdfColor),
      stroke: lightBorder,
      lineWidth: 0.4,
    });

    const values = [
      row.name,
      String(row.leads),
      String(row.qualified),
      String(row.sales),
      `${row.conversion.toFixed(1)}%`,
      formatCurrency(row.amount),
      formatDuration(row.callDurationSeconds),
    ];

    let currentX = 56;
    for (const [colIndex, column] of columns.entries()) {
      c.text(rowTop + 4, currentX, values[colIndex] || '-', { size: size(8.5), color: textDark });
      currentX += column.width;
    }
  }

  c.text(808, 44, 'Dashboarduz tomonidan yaratildi', { size: size(8), color: [0.5, 0.56, 0.66] });
  return c.build();
}

function classifyCourseCategory(value: string | null | undefined): 'online' | 'offline' | 'intensive' | 'other' {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'other';
  }
  if (normalized.includes('online') || normalized.includes('onlayn')) {
    return 'online';
  }
  if (normalized.includes('offline') || normalized.includes('oflayn')) {
    return 'offline';
  }
  if (normalized.includes('intensive') || normalized.includes('intensiv')) {
    return 'intensive';
  }
  return 'other';
}

function resolveReportWindows(nowUtc: Date): ReportWindow[] {
  const nowLocal = toLocalDate(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const day = nowLocal.getUTCDate();
  const weekday = nowLocal.getUTCDay(); // 0 Sunday, 1 Monday

  const windows: ReportWindow[] = [];

  // Daily report for yesterday at 08:00 local.
  const dailyDispatchAt = fromLocalParts(year, month, day, 8, 0, 0, 0);
  if (nowUtc >= dailyDispatchAt) {
    const todayStart = fromLocalParts(year, month, day, 0, 0, 0, 0);
    const periodStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const periodEnd = new Date(todayStart.getTime() - 1);
    windows.push({
      kind: 'daily',
      title: 'Kunlik hisobot (Kecha)',
      periodStart,
      periodEnd,
      periodKey: formatLocalDate(periodStart),
    });
  }

  // Weekly report at Monday 07:55 local for previous week.
  if (weekday === 1) {
    const mondayStart = fromLocalParts(year, month, day, 0, 0, 0, 0);
    const weeklyDispatchAt = fromLocalParts(year, month, day, 7, 55, 0, 0);
    if (nowUtc >= weeklyDispatchAt) {
      const periodStart = new Date(mondayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      const periodEnd = new Date(mondayStart.getTime() - 1);
      windows.push({
        kind: 'weekly',
        title: 'Haftalik hisobot (O`tgan hafta)',
        periodStart,
        periodEnd,
        periodKey: `${formatLocalDate(periodStart)}_${formatLocalDate(periodEnd)}`,
      });
    }
  }

  // Monthly report at first day 07:50 local for previous month.
  if (day === 1) {
    const currentMonthStart = fromLocalParts(year, month, 1, 0, 0, 0, 0);
    const monthlyDispatchAt = fromLocalParts(year, month, 1, 7, 50, 0, 0);
    if (nowUtc >= monthlyDispatchAt) {
      const periodEnd = new Date(currentMonthStart.getTime() - 1);
      const previousMonthLocal = toLocalDate(new Date(currentMonthStart.getTime() - 24 * 60 * 60 * 1000));
      const periodStart = fromLocalParts(
        previousMonthLocal.getUTCFullYear(),
        previousMonthLocal.getUTCMonth(),
        1,
        0,
        0,
        0,
        0,
      );
      windows.push({
        kind: 'monthly',
        title: 'Oylik hisobot (O`tgan oy)',
        periodStart,
        periodEnd,
        periodKey: `${formatLocalDate(periodStart)}_${formatLocalDate(periodEnd)}`,
      });
    }
  }

  return windows;
}

function buildTodayWindow(nowUtc: Date): ReportWindow {
  const nowLocal = toLocalDate(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const day = nowLocal.getUTCDate();
  const periodStart = fromLocalParts(year, month, day, 0, 0, 0, 0);

  return {
    kind: 'daily',
    title: 'Tezkor hisobot (Bugun)',
    periodStart,
    periodEnd: nowUtc,
    periodKey: formatLocalDate(periodStart),
  };
}

function buildPreviousWeekWindow(nowUtc: Date): ReportWindow {
  const nowLocal = toLocalDate(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const day = nowLocal.getUTCDate();
  const daysSinceMonday = (nowLocal.getUTCDay() + 6) % 7;
  const currentWeekStart = fromLocalParts(year, month, day - daysSinceMonday, 0, 0, 0, 0);
  const periodStart = new Date(currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const periodEnd = new Date(currentWeekStart.getTime() - 1);

  return {
    kind: 'weekly',
    title: 'Haftalik hisobot (O`tgan hafta)',
    periodStart,
    periodEnd,
    periodKey: `${formatLocalDate(periodStart)}_${formatLocalDate(periodEnd)}`,
  };
}

function buildCurrentWeekWindow(nowUtc: Date): ReportWindow {
  const nowLocal = toLocalDate(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const day = nowLocal.getUTCDate();
  const daysSinceMonday = (nowLocal.getUTCDay() + 6) % 7;
  const periodStart = fromLocalParts(year, month, day - daysSinceMonday, 0, 0, 0, 0);

  return {
    kind: 'weekly',
    title: 'Haftalik hisobot (Joriy hafta)',
    periodStart,
    periodEnd: nowUtc,
    periodKey: `${formatLocalDate(periodStart)}_${formatLocalDate(nowUtc)}`,
  };
}

function buildPreviousMonthWindow(nowUtc: Date): ReportWindow {
  const nowLocal = toLocalDate(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const currentMonthStart = fromLocalParts(year, month, 1, 0, 0, 0, 0);
  const periodEnd = new Date(currentMonthStart.getTime() - 1);
  const previousMonthLocal = toLocalDate(new Date(currentMonthStart.getTime() - 24 * 60 * 60 * 1000));
  const periodStart = fromLocalParts(
    previousMonthLocal.getUTCFullYear(),
    previousMonthLocal.getUTCMonth(),
    1,
    0,
    0,
    0,
    0,
  );

  return {
    kind: 'monthly',
    title: 'Oylik hisobot (O`tgan oy)',
    periodStart,
    periodEnd,
    periodKey: `${formatLocalDate(periodStart)}_${formatLocalDate(periodEnd)}`,
  };
}

function buildCurrentMonthWindow(nowUtc: Date): ReportWindow {
  const nowLocal = toLocalDate(nowUtc);
  const year = nowLocal.getUTCFullYear();
  const month = nowLocal.getUTCMonth();
  const periodStart = fromLocalParts(year, month, 1, 0, 0, 0, 0);

  return {
    kind: 'monthly',
    title: 'Oylik hisobot (Joriy oy)',
    periodStart,
    periodEnd: nowUtc,
    periodKey: `${formatLocalDate(periodStart)}_${formatLocalDate(nowUtc)}`,
  };
}

function buildLeadWhere(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
  pipelineIds: string[],
): Record<string, unknown> {
  const baseWhere: Record<string, unknown> = {
    tenantId,
    amocrmId: { not: null },
    OR: [
      { externalCreatedAt: { gte: periodStart, lte: periodEnd } },
      {
        externalCreatedAt: null,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    ],
  };

  if (pipelineIds.length > 0) {
    baseWhere.pipelineId = { in: pipelineIds };
  }

  return baseWhere;
}

async function collectMetrics(params: {
  tenantId: string;
  tenantSettings: unknown;
  periodStart: Date;
  periodEnd: Date;
  selectedPipelineIds: string[];
}): Promise<ReportMetrics> {
  const dashboardSettings = (
    params.tenantSettings
    && typeof params.tenantSettings === 'object'
    && !Array.isArray(params.tenantSettings)
    && (params.tenantSettings as Record<string, unknown>).dashboard
    && typeof (params.tenantSettings as Record<string, unknown>).dashboard === 'object'
      ? (params.tenantSettings as Record<string, unknown>).dashboard as Record<string, unknown>
      : {}
  );

  const qualifiedStageIds = Array.isArray(dashboardSettings.qualifiedStageIds)
    ? dashboardSettings.qualifiedStageIds.map((value) => String(value))
    : [];
  const reasonFieldKey = typeof dashboardSettings.reasonFieldKey === 'string'
    ? dashboardSettings.reasonFieldKey
    : null;
  const sourceFieldKey = typeof dashboardSettings.sourceFieldKey === 'string'
    ? dashboardSettings.sourceFieldKey
    : null;

  const leadWhere = buildLeadWhere(
    params.tenantId,
    params.periodStart,
    params.periodEnd,
    params.selectedPipelineIds,
  );

  const [callAggregate, incomes, users, corporateDurationTotal] = await Promise.all([
    prisma.call.aggregate({
      where: {
        tenantId: params.tenantId,
        startedAt: {
          gte: params.periodStart,
          lte: params.periodEnd,
        },
      },
      _count: { id: true },
      _sum: { duration: true },
    }),
    prisma.income.findMany({
      where: {
        tenantId: params.tenantId,
        lifecycleStatus: 'active',
        entryDate: {
          gte: params.periodStart,
          lte: params.periodEnd,
        },
      },
      select: {
        id: true,
        type: true,
        relatedDebtIncomeId: true,
        entryDate: true,
        managerUserId: true,
        paymentAmount: true,
        coursePriceAmount: true,
        course: {
          select: {
            category: true,
            name: true,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        tenantId: params.tenantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        username: true,
        amocrmResponsibleUserId: true,
        utelManagerExternalId: true,
      },
    }),
    getCorporateCallDurationTotal({
      tenantId: params.tenantId,
      rangeStart: params.periodStart,
      rangeEnd: params.periodEnd,
    }),
  ]);

  let newLeads = 0;
  let qualifiedLeads = 0;
  const reasonMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  const managerLeadsByAmoId = new Map<string, { leads: number; qualified: number }>();

  let usedLiveAmoLeads = false;
  const amoContext = await getTenantAmoCRMContext(params.tenantId);
  if (amoContext) {
    try {
      const liveLeads = await amocrmService.fetchAllLeads(
        amoContext.accessToken,
        {
          pipelineIds: params.selectedPipelineIds.length > 0 ? params.selectedPipelineIds : undefined,
          createdAtFrom: params.periodStart,
          createdAtTo: params.periodEnd,
          limit: 250,
        },
        amoContext.baseUrl,
      );

      usedLiveAmoLeads = true;
      newLeads = liveLeads.length;
      for (const lead of liveLeads) {
        const statusId = String((lead as Record<string, unknown>).status_id || '').trim();
        if (qualifiedStageIds.length > 0 && statusId && qualifiedStageIds.includes(statusId)) {
          qualifiedLeads += 1;
        }

        const reasonValue = extractLeadValue(lead, reasonFieldKey);
        if (reasonValue) {
          reasonMap.set(reasonValue, (reasonMap.get(reasonValue) || 0) + 1);
        }

        const sourceValue = extractLeadValue(lead, sourceFieldKey);
        if (sourceValue) {
          sourceMap.set(sourceValue, (sourceMap.get(sourceValue) || 0) + 1);
        }

        const responsibleUserId = String((lead as Record<string, unknown>).responsible_user_id || '').trim();
        if (!responsibleUserId) {
          continue;
        }

        const current = managerLeadsByAmoId.get(responsibleUserId) || { leads: 0, qualified: 0 };
        current.leads += 1;
        if (qualifiedStageIds.length > 0 && statusId && qualifiedStageIds.includes(statusId)) {
          current.qualified += 1;
        }
        managerLeadsByAmoId.set(responsibleUserId, current);
      }
    } catch (error: any) {
      usedLiveAmoLeads = false;
      log(LogLevel.WARN, 'Falling back to local lead metrics for report generation', {
        tenantId: params.tenantId,
        error: error?.message || 'Unknown error',
      });
    }
  }

  if (!usedLiveAmoLeads) {
    const [dbNewLeads, dbQualifiedLeads, leadsDetailed] = await Promise.all([
      prisma.lead.count({ where: leadWhere as any }),
      qualifiedStageIds.length > 0
        ? prisma.lead.count({
            where: {
              ...(leadWhere as any),
              status: { in: qualifiedStageIds },
            },
          })
        : Promise.resolve(0),
      prisma.lead.findMany({
        where: leadWhere as any,
        select: {
          status: true,
          responsibleUserId: true,
          metadata: true,
        },
        take: 10000,
      }),
    ]);

    newLeads = dbNewLeads;
    qualifiedLeads = dbQualifiedLeads;

    for (const lead of leadsDetailed) {
      const reasonValue = extractLeadValue(lead.metadata, reasonFieldKey);
      if (reasonValue) {
        reasonMap.set(reasonValue, (reasonMap.get(reasonValue) || 0) + 1);
      }

      const sourceValue = extractLeadValue(lead.metadata, sourceFieldKey);
      if (sourceValue) {
        sourceMap.set(sourceValue, (sourceMap.get(sourceValue) || 0) + 1);
      }

      const responsibleUserId = String(lead.responsibleUserId || '').trim();
      if (!responsibleUserId) {
        continue;
      }
      const current = managerLeadsByAmoId.get(responsibleUserId) || { leads: 0, qualified: 0 };
      current.leads += 1;
      if (qualifiedStageIds.length > 0 && lead.status && qualifiedStageIds.includes(String(lead.status))) {
        current.qualified += 1;
      }
      managerLeadsByAmoId.set(responsibleUserId, current);
    }
  }

  let incomeTotal = 0;
  let newSalesCount = 0;
  let agreementTotal = 0;
  let newSalesIncomeTotal = 0;
  let debtRepaymentIncomeTotal = 0;

  let onlineSalesCount = 0;
  let offlineSalesCount = 0;
  let intensiveSalesCount = 0;
  let onlineAgreementTotal = 0;
  let offlineAgreementTotal = 0;
  let intensiveAgreementTotal = 0;
  const managerSalesByUserId = new Map<string, { sales: number; amount: number }>();

  const repaymentRelatedIds = [...new Set(
    incomes
      .filter((income) => income.type === 'repayment' && income.relatedDebtIncomeId)
      .map((income) => String(income.relatedDebtIncomeId)),
  )];
  const linkedIncomeById = new Map<string, {
    id: string;
    type: string;
    entryDate: Date;
    relatedDebtIncomeId: string | null;
  }>();
  let lookupIds = repaymentRelatedIds;
  for (let depth = 0; depth < 6 && lookupIds.length > 0; depth += 1) {
    const rows = await prisma.income.findMany({
      where: {
        tenantId: params.tenantId,
        id: { in: lookupIds },
      },
      select: {
        id: true,
        type: true,
        entryDate: true,
        relatedDebtIncomeId: true,
      },
    });
    lookupIds = [];
    for (const row of rows) {
      linkedIncomeById.set(row.id, {
        id: row.id,
        type: String(row.type),
        entryDate: row.entryDate,
        relatedDebtIncomeId: row.relatedDebtIncomeId ? String(row.relatedDebtIncomeId) : null,
      });
    }
    for (const row of rows) {
      if (row.type !== 'new_sale' && row.relatedDebtIncomeId && !linkedIncomeById.has(String(row.relatedDebtIncomeId))) {
        lookupIds.push(String(row.relatedDebtIncomeId));
      }
    }
    lookupIds = [...new Set(lookupIds)];
  }

  const resolveRootSaleEntryDate = (incomeId: string | null | undefined): Date | null => {
    if (!incomeId) return null;
    let currentId = String(incomeId);
    for (let depth = 0; depth < 10; depth += 1) {
      const row = linkedIncomeById.get(currentId);
      if (!row) {
        return null;
      }
      if (row.type === 'new_sale') {
        return row.entryDate;
      }
      if (!row.relatedDebtIncomeId) {
        return null;
      }
      currentId = row.relatedDebtIncomeId;
    }
    return null;
  };

  for (const income of incomes) {
    const paymentAmount = Number(income.paymentAmount || 0);
    incomeTotal += paymentAmount;

    if (income.type === 'new_sale') {
      newSalesIncomeTotal += paymentAmount;
    } else if (income.type === 'repayment') {
      const saleEntryDate = resolveRootSaleEntryDate(income.relatedDebtIncomeId);
      const isSaleCreatedInSelectedRange = Boolean(
        saleEntryDate
        && saleEntryDate.getTime() >= params.periodStart.getTime()
        && saleEntryDate.getTime() <= params.periodEnd.getTime(),
      );
      if (isSaleCreatedInSelectedRange) {
        newSalesIncomeTotal += paymentAmount;
      } else {
        debtRepaymentIncomeTotal += paymentAmount;
      }
    } else {
      debtRepaymentIncomeTotal += paymentAmount;
    }

    if (income.type !== 'new_sale') {
      continue;
    }

    newSalesCount += 1;
    const agreementAmount = Number(income.coursePriceAmount || 0);
    agreementTotal += agreementAmount;
    const managerStats = managerSalesByUserId.get(income.managerUserId) || { sales: 0, amount: 0 };
    managerStats.sales += 1;
    managerStats.amount += agreementAmount;
    managerSalesByUserId.set(income.managerUserId, managerStats);

    const category = classifyCourseCategory(income.course?.category || income.course?.name);
    if (category === 'online') {
      onlineSalesCount += 1;
      onlineAgreementTotal += agreementAmount;
    } else if (category === 'offline') {
      offlineSalesCount += 1;
      offlineAgreementTotal += agreementAmount;
    } else if (category === 'intensive') {
      intensiveSalesCount += 1;
      intensiveAgreementTotal += agreementAmount;
    }
  }

  const usersByAmoId = new Map<string, { id: string; name: string }>();
  const usersById = new Map<string, { id: string; name: string }>();
  const managerByExtension = new Map<string, string>();
  for (const user of users) {
    const displayName = (user.name || user.username || user.id).trim();
    usersById.set(user.id, { id: user.id, name: displayName });
    if (user.amocrmResponsibleUserId) {
      usersByAmoId.set(String(user.amocrmResponsibleUserId), { id: user.id, name: displayName });
    }
    const extension = normalizeDigits(user.utelManagerExternalId || '');
    if (isAllowedUtelManagerExtension(extension)) {
      managerByExtension.set(extension, user.id);
    }
  }

  const extensionValues = Array.from(managerByExtension.keys());
  const managerCallDurationByUserId = new Map<string, number>();
  const corporateDurationByUserId = await getCorporateCallDurationByManager({
    tenantId: params.tenantId,
    managerUserIds: users.map((user) => user.id),
    rangeStart: params.periodStart,
    rangeEnd: params.periodEnd,
  });
  if (extensionValues.length > 0) {
    const managerCalls = await prisma.call.findMany({
      where: {
        tenantId: params.tenantId,
        provider: 'utel',
        startedAt: {
          gte: params.periodStart,
          lte: params.periodEnd,
        },
        OR: [
          { from: { in: extensionValues } },
          { to: { in: extensionValues } },
        ],
      },
      select: {
        from: true,
        to: true,
        duration: true,
      },
    });

    for (const call of managerCalls) {
      const fromExtension = normalizeDigits(call.from);
      const toExtension = normalizeDigits(call.to);
      const extension = isAllowedUtelManagerExtension(fromExtension)
        ? fromExtension
        : (isAllowedUtelManagerExtension(toExtension) ? toExtension : null);
      if (!extension) {
        continue;
      }
      const managerUserId = managerByExtension.get(extension);
      if (!managerUserId) {
        continue;
      }
      const currentDuration = managerCallDurationByUserId.get(managerUserId) || 0;
      managerCallDurationByUserId.set(managerUserId, currentDuration + Math.max(0, Number(call.duration || 0)));
    }
  }

  const managerRowsByUserId = new Map<string, {
    userId: string;
    name: string;
    leads: number;
    qualified: number;
    sales: number;
    amount: number;
  }>();

  for (const [amoId, leadStats] of managerLeadsByAmoId.entries()) {
    const mappedUser = usersByAmoId.get(amoId);
    if (!mappedUser) {
      continue;
    }
    const existing = managerRowsByUserId.get(mappedUser.id) || {
      userId: mappedUser.id,
      name: mappedUser.name,
      leads: 0,
      qualified: 0,
      sales: 0,
      amount: 0,
    };
    existing.leads += leadStats.leads;
    existing.qualified += leadStats.qualified;
    managerRowsByUserId.set(mappedUser.id, existing);
  }

  for (const [userId, salesStats] of managerSalesByUserId.entries()) {
    const mappedUser = usersById.get(userId);
    const name = mappedUser?.name || userId;
    const existing = managerRowsByUserId.get(userId) || {
      userId,
      name,
      leads: 0,
      qualified: 0,
      sales: 0,
      amount: 0,
    };
    existing.sales += salesStats.sales;
    existing.amount += salesStats.amount;
    managerRowsByUserId.set(userId, existing);
  }

  const nonQualifiedLeads = Math.max(0, newLeads - qualifiedLeads);
  const qualifiedShare = newLeads > 0 ? normalizePercentage((qualifiedLeads / newLeads) * 100) : 0;
  const nonQualifiedShare = newLeads > 0 ? normalizePercentage((nonQualifiedLeads / newLeads) * 100) : 0;
  const conversionPercent = newLeads > 0 ? normalizePercentage((newSalesCount / newLeads) * 100) : 0;

  const reasonBreakdown = Array.from(reasonMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const sourceBreakdown = Array.from(sourceMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const managerRows = Array.from(managerRowsByUserId.values())
    .map((row) => ({
      name: row.name,
      leads: row.leads,
      qualified: row.qualified,
      sales: row.sales,
      conversion: row.leads > 0 ? normalizePercentage((row.sales / row.leads) * 100) : 0,
      amount: row.amount,
      callDurationSeconds: (managerCallDurationByUserId.get(row.userId) || 0) + (corporateDurationByUserId.get(row.userId) || 0),
    }))
    .filter((row) => row.leads > 0 || row.sales > 0 || row.amount > 0)
    .sort((a, b) => {
      if (b.sales !== a.sales) return b.sales - a.sales;
      if (b.leads !== a.leads) return b.leads - a.leads;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 10);

  return {
    newLeads,
    qualifiedLeads,
    nonQualifiedLeads,
    qualifiedShare,
    nonQualifiedShare,
    newSalesCount,
    conversionPercent,
    agreementTotal,
    incomeTotal,
    newSalesIncomeTotal,
    debtRepaymentIncomeTotal,
    onlineSalesCount,
    onlineAgreementTotal,
    offlineSalesCount,
    offlineAgreementTotal,
    intensiveSalesCount,
    intensiveAgreementTotal,
    totalCalls: Number(callAggregate._count.id || 0),
    talkDurationSeconds: Number(callAggregate._sum.duration || 0) + corporateDurationTotal,
    reasonBreakdown,
    sourceBreakdown,
    managerRows,
  };
}

async function getSelectedPipelineIdsForTenant(tenantId: string): Promise<string[]> {
  const amocrmIntegration = await prisma.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'amocrm',
      },
    },
    select: {
      config: true,
    },
  });

  return Array.isArray((amocrmIntegration?.config as any)?.selectedPipelineIds)
    ? (amocrmIntegration?.config as any).selectedPipelineIds.map((value: unknown) => String(value))
    : [];
}

async function sendWindowToIntegration(
  integration: TelegramIntegrationWithTenant,
  window: ReportWindow,
  nowUtc: Date,
): Promise<{ recipientCount: number; fileName: string }> {
  const reportStartedAt = Date.now();
  const recipients = parseTelegramRecipients(integration.config).filter(
    (recipient) => recipient.started && recipient.selectedForReports,
  );
  if (recipients.length === 0) {
    throw new Error('No Telegram recipients selected for reports');
  }

  const selectedPipelineIds = await getSelectedPipelineIdsForTenant(integration.tenantId);
  const metrics = await collectMetrics({
    tenantId: integration.tenantId,
    tenantSettings: integration.tenant.settings,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    selectedPipelineIds,
  });
  const elapsed = Date.now() - reportStartedAt;
  const minWaitMs = window.kind === 'weekly'
    ? MIN_WEEKLY_REPORT_PREP_MS
    : window.kind === 'monthly'
      ? MIN_MONTHLY_REPORT_PREP_MS
      : MIN_DAILY_REPORT_PREP_MS;
  if (elapsed < minWaitMs) {
    await sleep(minWaitMs - elapsed);
  }

  const pdfBuffer = createStyledReportPdf({
    tenantName: getReportTenantName(integration.tenant.name || integration.tenantId),
    title: window.title,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    generatedAt: nowUtc,
    metrics,
  });
  const fileName = `dashboard-report-${window.kind}-${window.periodKey}.pdf`;
  const caption = `${window.title}\n${formatLocalDate(window.periodStart)} - ${formatLocalDate(window.periodEnd)}`;

  const tokens = decryptIntegrationTokens<{ botToken?: string }>(integration.tokensEncrypted || '');
  if (!tokens.botToken) {
    throw new Error('Telegram bot token is missing');
  }

  for (const recipient of recipients) {
    await telegramService.sendDocument(tokens.botToken, recipient.chatId, pdfBuffer, fileName, caption);
  }

  return {
    recipientCount: recipients.length,
    fileName,
  };
}

async function dispatchWindow(window: ReportWindow, nowUtc: Date): Promise<void> {
  const integrations = await prisma.integration.findMany({
    where: {
      type: 'telegram',
      status: 'active',
      tokensEncrypted: { not: null },
    },
    select: {
      id: true,
      tenantId: true,
      tokensEncrypted: true,
      config: true,
      tenant: {
        select: {
          name: true,
          settings: true,
        },
      },
    },
  });

  const redis = getRedisClient();

  for (const integration of integrations as TelegramIntegrationWithTenant[]) {
    const recipientsSelected = parseTelegramRecipients(integration.config).some(
      (recipient) => recipient.started && recipient.selectedForReports,
    );
    if (!recipientsSelected) {
      continue;
    }

    const lockKey = `telegram-report:${window.kind}:${integration.tenantId}:${window.periodKey}`;
    const lockResult = await redis.set(lockKey, nowUtc.toISOString(), 'EX', LOCK_TTL_SECONDS, 'NX');
    if (lockResult !== 'OK') {
      continue;
    }

    try {
      const sent = await sendWindowToIntegration(integration, window, nowUtc);

      await prisma.auditLog.create({
        data: {
          tenantId: integration.tenantId,
          action: 'telegram_report_sent',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            schedule: window.kind,
            periodStart: window.periodStart.toISOString(),
            periodEnd: window.periodEnd.toISOString(),
            recipientCount: sent.recipientCount,
            fileName: sent.fileName,
          },
        },
      });

      log(LogLevel.INFO, 'Scheduled Telegram report sent', {
        tenantId: integration.tenantId,
        schedule: window.kind,
        recipients: sent.recipientCount,
      });
    } catch (error: any) {
      await redis.del(lockKey);
      await prisma.auditLog.create({
        data: {
          tenantId: integration.tenantId,
          action: 'telegram_report_failed',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            schedule: window.kind,
            periodStart: window.periodStart.toISOString(),
            periodEnd: window.periodEnd.toISOString(),
            error: error?.message || 'Unknown error',
          },
        },
      });

      log(LogLevel.ERROR, 'Scheduled Telegram report failed', {
        tenantId: integration.tenantId,
        schedule: window.kind,
        error: error?.message || 'Unknown error',
      });
    }
  }
}

async function tickScheduler(): Promise<void> {
  if (schedulerInProgress) {
    return;
  }
  schedulerInProgress = true;

  try {
    const nowUtc = new Date();
    const dueWindows = resolveReportWindows(nowUtc);
    for (const window of dueWindows) {
      await dispatchWindow(window, nowUtc);
    }
  } catch (error: any) {
    log(LogLevel.ERROR, 'Telegram report scheduler tick failed', {
      error: error?.message || 'Unknown error',
    });
  } finally {
    schedulerInProgress = false;
  }
}

export function startTelegramReportScheduler(): void {
  if (schedulerTimer) {
    return;
  }

  schedulerTimer = setInterval(() => {
    void tickScheduler();
  }, POLL_INTERVAL_MS);

  void tickScheduler();

  log(LogLevel.INFO, 'Telegram report scheduler started', {
    timezone: REPORT_TIMEZONE_LABEL,
    intervalMs: POLL_INTERVAL_MS,
  });
}

export function stopTelegramReportScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

export async function sendImmediateTodayReportForTenant(tenantId: string): Promise<{
  sent: boolean;
  recipientCount: number;
  periodStart: string;
  periodEnd: string;
  schedule: 'manual_today';
}> {
  const result = await sendManualTelegramReportForTenant(tenantId, 'today');
  return {
    ...result,
    schedule: 'manual_today',
  };
}

export async function sendManualTelegramReportForTenant(
  tenantId: string,
  kind: ManualReportKind,
): Promise<{
  sent: boolean;
  recipientCount: number;
  periodStart: string;
  periodEnd: string;
  schedule: 'manual_today' | 'manual_weekly' | 'manual_monthly';
}> {
  const integration = await prisma.integration.findFirst({
    where: {
      tenantId,
      type: 'telegram',
      status: 'active',
      tokensEncrypted: { not: null },
    },
    select: {
      id: true,
      tenantId: true,
      tokensEncrypted: true,
      config: true,
      tenant: {
        select: {
          name: true,
          settings: true,
        },
      },
    },
  });

  if (!integration) {
    throw new Error('Telegram integration is not connected');
  }

  const recipients = parseTelegramRecipients(integration.config).filter(
    (recipient) => recipient.started && recipient.selectedForReports,
  );
  if (recipients.length === 0) {
    throw new Error('No Telegram recipients selected for scheduled reports');
  }

  const nowUtc = new Date();
  const window = kind === 'weekly'
    ? buildCurrentWeekWindow(nowUtc)
    : kind === 'monthly'
      ? buildCurrentMonthWindow(nowUtc)
      : buildTodayWindow(nowUtc);
  const redis = getRedisClient();
  const minuteKey = Math.floor(nowUtc.getTime() / 60_000);
  const schedule = kind === 'weekly'
    ? 'manual_weekly'
    : kind === 'monthly'
      ? 'manual_monthly'
      : 'manual_today';
  const lockKey = `telegram-report:${schedule}:${tenantId}:${window.periodKey}:${minuteKey}`;
  const lockResult = await redis.set(lockKey, nowUtc.toISOString(), 'EX', 120, 'NX');
  if (lockResult !== 'OK') {
    throw new Error('A report was already sent in the last minute. Please wait and try again.');
  }

  try {
    const sent = await sendWindowToIntegration(integration as TelegramIntegrationWithTenant, window, nowUtc);

    await prisma.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: 'telegram_report_sent',
        resource: 'integration',
        resourceId: integration.id,
        metadata: {
          schedule,
          periodStart: window.periodStart.toISOString(),
          periodEnd: window.periodEnd.toISOString(),
          recipientCount: sent.recipientCount,
          fileName: sent.fileName,
        },
      },
    });

    return {
      sent: true,
      recipientCount: sent.recipientCount,
      periodStart: window.periodStart.toISOString(),
      periodEnd: window.periodEnd.toISOString(),
      schedule,
    };
  } catch (error) {
    await redis.del(lockKey);
    throw error;
  }
}
