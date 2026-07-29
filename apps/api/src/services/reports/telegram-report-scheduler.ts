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

export type ManagerGroup = 'online' | 'offline';

export type ReportManagerRow = {
  group: ManagerGroup;
  name: string;
  leads: number;
  qualified: number;
  nonQualified: number;
  sales: number;
  conversion: number;
  agreementAmount: number;
  incomeAmount: number;
  callDurationSeconds: number;
};

export type ReportMetrics = {
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
  selectedCourseRows: Array<{
    courseId: string;
    courseName: string;
    salesCount: number;
    tariffBreakdown: Array<{ label: string; value: number }>;
  }>;
  managerRows: ReportManagerRow[];
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

function formatCompactCurrency(value: number): string {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded);
  if (abs >= 1_000_000_000) {
    return `${(rounded / 1_000_000_000).toFixed(abs >= 10_000_000_000 ? 1 : 2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${(rounded / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  }
  if (abs >= 1_000) {
    return `${(rounded / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  }
  return String(rounded);
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDurationHoursMinutes(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseTelegramDailyReportCourseIds(config: unknown): string[] {
  const raw = config && typeof config === 'object' && !Array.isArray(config)
    ? (config as Record<string, unknown>).telegramDailyReportCourseIds
    : null;
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(new Set(
    raw
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )).slice(0, 3);
}

function formatSelectedCourseLine(row: ReportMetrics['selectedCourseRows'][number]): string {
  const tariffs = row.tariffBreakdown.length > 0
    ? row.tariffBreakdown
      .slice(0, 4)
      .map((item) => `${item.label}: ${item.value}`)
      .join(' | ')
    : 'Tariflar: 0';
  return `${row.courseName}: Sotuv - ${row.salesCount} | ${tariffs}`;
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
  private readonly pages: string[][] = [[]];
  private currentPageIndex = 0;

  get pageCount(): number {
    return this.pages.length;
  }

  private get commands(): string[] {
    const page = this.pages[this.currentPageIndex];
    if (!page) {
      throw new Error(`PDF page ${this.currentPageIndex} does not exist`);
    }
    return page;
  }

  addPage(): number {
    this.pages.push([]);
    this.currentPageIndex = this.pages.length - 1;
    return this.currentPageIndex;
  }

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
    const pageObjectIds = this.pages.map((_, index) => 5 + index * 2);
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      `2 0 obj\n<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${this.pages.length} >>\nendobj\n`,
      '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    ];
    for (const [index, pageCommands] of this.pages.entries()) {
      const pageObjectId = pageObjectIds[index] as number;
      const contentObjectId = pageObjectId + 1;
      const contentStream = pageCommands.join('\n');
      objects.push(
        `${pageObjectId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>\nendobj\n`,
        `${contentObjectId} 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
      );
    }

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
  return entries.map((entry) => {
    const normalizedLabel = entry.label.trim().length > 0
      ? humanizeKey(entry.label)
      : fallbackLabel;
    return `${normalizedLabel}: ${entry.value}`;
  });
}

function fitTwoColumnThreeRows(lines: string[]): { left: string[]; right: string[] } {
  const items = lines.length > 0 ? lines : ["Ma'lumot yo'q: 0"];
  const half = Math.ceil(items.length / 2);
  const leftRaw = items.slice(0, half);
  const rightRaw = items.slice(half);

  const fitColumn = (columnItems: string[]): string[] => {
    if (columnItems.length <= 3) {
      return columnItems;
    }
    return [
      columnItems[0] || '-',
      columnItems[1] || '-',
      columnItems.slice(2).join(' | '),
    ];
  };

  return {
    left: fitColumn(leftRaw),
    right: fitColumn(rightRaw),
  };
}

export function getBreakdownLayout(entries: Array<{ label: string; value: number }>): {
  left: string[];
  right: string[];
  rowCount: number;
  height: number;
} {
  const lines = topBreakdownRows(entries, "Ma'lumot yo'q");
  const grid = fitTwoColumnThreeRows(lines);
  const rowCount = Math.max(1, grid.left.length, grid.right.length);
  return {
    ...grid,
    rowCount,
    height: 28 + rowCount * 14 + 8,
  };
}

export function classifyManagerGroup(roles: readonly string[] | null | undefined): ManagerGroup | null {
  if (roles?.includes('OnlineAgent')) {
    return 'online';
  }
  if (roles?.includes('OfflineAgent')) {
    return 'offline';
  }
  return null;
}

export function compareManagerRows(a: ReportManagerRow, b: ReportManagerRow): number {
  if (b.sales !== a.sales) return b.sales - a.sales;
  if (b.leads !== a.leads) return b.leads - a.leads;
  return a.name.localeCompare(b.name);
}

export function groupManagerRows(rows: ReportManagerRow[]): Array<{
  group: ManagerGroup;
  label: string;
  rows: ReportManagerRow[];
}> {
  const groups: Array<{ group: ManagerGroup; label: string }> = [
    { group: 'online', label: 'Online agentlar' },
    { group: 'offline', label: 'Offline agentlar' },
  ];
  return groups
    .map((entry) => ({
      ...entry,
      rows: rows.filter((row) => row.group === entry.group).sort(compareManagerRows),
    }))
    .filter((entry) => entry.rows.length > 0);
}

export function createStyledReportPdf(params: {
  tenantName: string;
  title: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  metrics: ReportMetrics;
}): Buffer {
  const c = new PdfCanvas();
  const dark: PdfColor = [138 / 255, 21 / 255, 56 / 255];
  const lightBorder: PdfColor = [0.72, 0.78, 0.86];
  const cardBg: PdfColor = [0.96, 0.97, 0.99];
  const textDark: PdfColor = [0.11, 0.16, 0.24];
  const accent: PdfColor = [0.12, 0.4, 0.95];
  const white: PdfColor = [1, 1, 1];
  const headerDateRange = `${formatLocalDate(params.periodStart)} - ${formatLocalDate(params.periodEnd)}`;
  const fontDelta = 0;
  const size = (base: number): number => Math.max(6, base + fontDelta);
  const pageContentBottom = 800;
  const pageFooterTop = 816;
  const contentLeft = 44;
  const contentWidth = 503;

  const drawFooter = () => {
    c.text(pageFooterTop, contentLeft, 'Dashboarduz tomonidan yaratildi', {
      size: size(8),
      color: [0.5, 0.56, 0.66],
    });
  };

  c.rect(16, 24, 547, 62, { fill: dark });
  c.text(28, 44, params.tenantName, { font: 'F2', size: size(20), color: white });
  c.text(52, 270, params.title, { font: 'F1', size: size(12), color: [0.76, 0.82, 0.92] });
  c.text(28, 360, `Sana: ${headerDateRange}`, { size: size(10), color: [0.76, 0.82, 0.92] });
  c.text(92, 44, `Davr: ${formatLocalDate(params.periodStart)} - ${formatLocalDate(params.periodEnd)}`, { size: size(10), color: textDark });
  c.text(106, 44, `Tayyorlangan: ${formatLocalDateTime(params.generatedAt)}`, { size: size(10), color: textDark });
  drawFooter();

  const cardTop = 130;
  const cardHeight = 54;
  const cardRowStep = cardHeight + 14;
  const cardLeft = (col: number) => 44 + col * 172;
  const cardRowTop = (row: number) => cardTop + row * cardRowStep;

  const drawStandardCard = (row: number, col: number, title: string, value: string) => {
    const top = cardRowTop(row);
    const left = cardLeft(col);
    c.rect(top, left, 160, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
    c.text(top + 10, left + 10, title, { size: size(9), color: [0.4, 0.46, 0.56] });
    c.text(top + 27, left + 10, value, { font: 'F2', size: size(14), color: accent });
  };

  drawStandardCard(0, 0, 'Kelishuv summasi', formatCurrency(params.metrics.agreementTotal));
  drawStandardCard(0, 2, 'Online kelishuv summasi', formatCurrency(params.metrics.onlineAgreementTotal));
  drawStandardCard(1, 0, 'Offline kelishuv summasi', formatCurrency(params.metrics.offlineAgreementTotal));
  drawStandardCard(1, 2, 'Sifatli lidlar', `${params.metrics.qualifiedLeads} (${params.metrics.qualifiedShare.toFixed(1)}%)`);

  // Tushum card with new-sale vs debt-repayment split.
  const incomeTop = cardRowTop(0);
  const incomeLeft = cardLeft(1);
  c.rect(incomeTop, incomeLeft, 160, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  c.text(incomeTop + 9, incomeLeft + 10, 'Tushum', { size: size(9), color: [0.4, 0.46, 0.56] });
  c.text(incomeTop + 22, incomeLeft + 10, formatCurrency(params.metrics.incomeTotal), { font: 'F2', size: size(14), color: accent });
  c.text(incomeTop + 36, incomeLeft + 10, `Yangi sotuv: ${formatCurrency(params.metrics.newSalesIncomeTotal)}`, {
    size: size(8),
    color: textDark,
  });
  c.text(incomeTop + 46, incomeLeft + 10, `Qarz to'lovi: ${formatCurrency(params.metrics.debtRepaymentIncomeTotal)}`, {
    size: size(8),
    color: textDark,
  });

  // Split half cards in the middle slot of row 2 (by width).
  const splitTop = cardRowTop(1);
  const splitLeft = cardLeft(1);
  const splitGap = 4;
  const splitWidth = Math.floor((160 - splitGap) / 2);

  c.rect(splitTop, splitLeft, splitWidth, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  c.text(splitTop + 9, splitLeft + 8, 'Yangi lidlar', { size: size(8), color: [0.4, 0.46, 0.56] });
  c.text(splitTop + 27, splitLeft + 8, String(params.metrics.newLeads), { font: 'F2', size: size(12), color: accent });

  const salesLeft = splitLeft + splitWidth + splitGap;
  c.rect(splitTop, salesLeft, splitWidth, cardHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  c.text(splitTop + 8, salesLeft + 8, 'Sotuv', { size: size(8), color: [0.4, 0.46, 0.56] });
  c.text(splitTop + 20, salesLeft + 8, String(params.metrics.newSalesCount), { font: 'F2', size: size(10), color: accent });
  c.text(
    splitTop + 33,
    salesLeft + 8,
    `On: ${params.metrics.onlineSalesCount}`,
    { size: size(7.5), color: textDark },
  );
  c.text(
    splitTop + 43,
    salesLeft + 8,
    `Of: ${params.metrics.offlineSalesCount}`,
    { size: size(7.5), color: textDark },
  );

  const summaryTop = cardRowTop(1) + cardHeight + 12;
  const summaryHeight = 72;
  c.rect(summaryTop, contentLeft, contentWidth, summaryHeight, { fill: cardBg, stroke: lightBorder, lineWidth: 0.8 });
  const summaryRows = [
    {
      left: `Sifatsiz lidlar: ${params.metrics.nonQualifiedLeads}`,
      right: `Qo'ng'iroqlar: ${params.metrics.totalCalls}`,
      rightSize: 10.5,
    },
    {
      left: `Yangi sotuvlar: ${params.metrics.newSalesCount}`,
      right: `Suhbat davomiyligi: ${formatDuration(params.metrics.talkDurationSeconds)}`,
      rightSize: 10.5,
    },
    {
      left: `Konversiya: ${params.metrics.conversionPercent.toFixed(2)}%`,
      right: `Online/Offline/Intensiv sotuvlar: ${params.metrics.onlineSalesCount}/${params.metrics.offlineSalesCount}/${params.metrics.intensiveSalesCount}`,
      rightSize: 8.7,
    },
  ];
  for (const [index, row] of summaryRows.entries()) {
    const rowTop = summaryTop + 10 + index * 20;
    c.text(rowTop, 54, row.left, { font: 'F2', size: size(11.5), color: textDark });
    c.text(rowTop, 300, row.right, { size: size(row.rightSize), color: textDark });
  }

  const breakdownRowHeight = 14;
  const breakdownColLeftA = 54;
  const breakdownColLeftB = 300;
  const drawBreakdownSection = (
    top: number,
    title: string,
    entries: Array<{ label: string; value: number }>,
  ): number => {
    c.rect(top, contentLeft, contentWidth, 22, { fill: dark });
    c.text(top + 4, 54, title, { font: 'F2', size: size(12), color: white });
    const layout = getBreakdownLayout(entries);
    for (let row = 0; row < layout.rowCount; row += 1) {
      const y = top + 28 + row * breakdownRowHeight;
      const left = layout.left[row];
      const right = layout.right[row];
      if (typeof left === 'string') {
        c.text(y, breakdownColLeftA, left, { size: size(9), color: textDark });
      }
      if (typeof right === 'string') {
        c.text(y, breakdownColLeftB, right, { size: size(9), color: textDark });
      }
    }
    return top + layout.height;
  };

  let cursor = summaryTop + summaryHeight + 12;
  cursor = drawBreakdownSection(cursor, 'Sifatsiz lid sabablari', params.metrics.reasonBreakdown);
  cursor = drawBreakdownSection(cursor, 'Lid manbalari', params.metrics.sourceBreakdown);

  const selectedCourseRows = params.metrics.selectedCourseRows || [];
  const hasSelectedCourses = selectedCourseRows.length > 0;

  if (hasSelectedCourses) {
    c.rect(cursor, contentLeft, contentWidth, 22, { fill: dark });
    c.text(cursor + 4, 54, 'Tanlangan kurslar sotuvi', { font: 'F2', size: size(12), color: white });
    const courseContentTop = cursor + 28;
    selectedCourseRows.slice(0, 3).forEach((row, index) => {
      c.text(courseContentTop + index * 14, 54, formatSelectedCourseLine(row), { size: size(8.3), color: textDark });
    });
    cursor = courseContentTop + Math.min(3, selectedCourseRows.length) * 14 + 8;
  }

  const columns = [
    { key: 'name', title: 'Menejer', width: 74 },
    { key: 'leads', title: 'Lid', width: 34 },
    { key: 'qualified', title: 'Sifatli', width: 43 },
    { key: 'nonQualified', title: 'Sifatsiz', width: 43 },
    { key: 'sales', title: 'Sotuv', width: 38 },
    { key: 'conversion', title: 'Konv.', width: 48 },
    { key: 'agreementAmount', title: 'Kelishuv', width: 62 },
    { key: 'incomeAmount', title: 'Tushum', width: 58 },
    { key: 'duration', title: 'Suhbat soat', width: 65 },
  ] as const;
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

  const drawManagerColumnHeader = (top: number) => {
    c.rect(top, 54, tableWidth, 20, { fill: [0.92, 0.94, 0.98], stroke: lightBorder, lineWidth: 0.8 });
    let x = 56;
    for (const column of columns) {
      c.text(top + 5, x, column.title, { font: 'F2', size: size(7.4), color: textDark });
      x += column.width;
    }
  };

  const drawManagerRow = (top: number, row: ReportManagerRow, index: number) => {
    c.rect(top, 54, tableWidth, 18, {
      fill: index % 2 === 0 ? ([1, 1, 1] as PdfColor) : ([0.98, 0.99, 1] as PdfColor),
      stroke: lightBorder,
      lineWidth: 0.4,
    });

    const values = [
      row.name,
      String(row.leads),
      String(row.qualified),
      String(row.nonQualified),
      String(row.sales),
      `${row.conversion.toFixed(1)}%`,
      formatCompactCurrency(row.agreementAmount),
      formatCompactCurrency(row.incomeAmount),
      formatDurationHoursMinutes(row.callDurationSeconds),
    ];

    let currentX = 56;
    for (const [colIndex, column] of columns.entries()) {
      c.text(top + 4, currentX, values[colIndex] || '-', { size: size(7.2), color: textDark });
      currentX += column.width;
    }
  };

  const drawContinuationPage = (): number => {
    c.addPage();
    c.rect(24, contentLeft, contentWidth, 50, { fill: dark });
    c.text(34, 54, params.tenantName, { font: 'F2', size: size(15), color: white });
    c.text(53, 54, `${params.title} | ${headerDateRange}`, {
      size: size(8.5),
      color: [0.76, 0.82, 0.92],
    });
    c.rect(86, contentLeft, contentWidth, 22, { fill: dark });
    c.text(90, 54, "Menejerlar bo'yicha sotuvlar (davomi)", { font: 'F2', size: size(12), color: white });
    drawFooter();
    return 114;
  };

  const managerGroups = groupManagerRows(params.metrics.managerRows);
  if (managerGroups.length > 0) {
    c.rect(cursor, contentLeft, contentWidth, 22, { fill: dark });
    c.text(cursor + 4, 54, "Menejerlar bo'yicha sotuvlar", { font: 'F2', size: size(12), color: white });
    cursor += 28;

    for (const managerGroup of managerGroups) {
      let remainingRows = managerGroup.rows;
      let continuation = false;
      while (remainingRows.length > 0) {
        const minimumGroupHeight = 18 + 20 + 18;
        if (cursor + minimumGroupHeight > pageContentBottom) {
          cursor = drawContinuationPage();
        }

        c.rect(cursor, 54, tableWidth, 18, {
          fill: cardBg,
          stroke: lightBorder,
          lineWidth: 0.8,
        });
        c.text(cursor + 3, 56, continuation ? `${managerGroup.label} (davomi)` : managerGroup.label, {
          font: 'F2',
          size: size(8.5),
          color: textDark,
        });
        cursor += 18;
        drawManagerColumnHeader(cursor);
        cursor += 20;

        const availableRows = Math.max(1, Math.floor((pageContentBottom - cursor) / 18));
        const pageRows = remainingRows.slice(0, availableRows);
        for (const [index, row] of pageRows.entries()) {
          drawManagerRow(cursor, row, index);
          cursor += 18;
        }
        remainingRows = remainingRows.slice(pageRows.length);

        if (remainingRows.length > 0) {
          continuation = true;
          cursor = drawContinuationPage();
        } else {
          cursor += 6;
        }
      }
    }
  }

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

function isLostLeadStatus(value: unknown): boolean {
  return String(value || '').trim() === '143';
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
  selectedReportCourseIds: string[];
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
  const qualifiedValues = Array.isArray(dashboardSettings.qualifiedValues)
    ? dashboardSettings.qualifiedValues.map((value) => String(value))
    : [];
  const nonQualifiedValues = Array.isArray(dashboardSettings.nonQualifiedValues)
    ? dashboardSettings.nonQualifiedValues.map((value) => String(value))
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

  const selectedCourseIds = Array.from(new Set(params.selectedReportCourseIds.map((id) => id.trim()).filter(Boolean))).slice(0, 3);

  const [callAggregate, incomes, users, corporateDurationTotal, selectedReportCourses, selectedCourseIncomes] = await Promise.all([
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
        courseId: true,
        course: {
          select: {
            category: true,
            name: true,
          },
        },
        tariff: {
          select: {
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
        roles: true,
        amocrmResponsibleUserId: true,
        utelManagerExternalId: true,
      },
    }),
    getCorporateCallDurationTotal({
      tenantId: params.tenantId,
      rangeStart: params.periodStart,
      rangeEnd: params.periodEnd,
    }),
    selectedCourseIds.length > 0
      ? prisma.course.findMany({
          where: {
            tenantId: params.tenantId,
            id: { in: selectedCourseIds },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : Promise.resolve([]),
    selectedCourseIds.length > 0
      ? prisma.income.findMany({
          where: {
            tenantId: params.tenantId,
            lifecycleStatus: 'active',
            type: 'new_sale',
            courseId: { in: selectedCourseIds },
          },
          select: {
            courseId: true,
            tariff: {
              select: {
                name: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  let newLeads = 0;
  let qualifiedLeads = 0;

  const isMappedValue = (raw: string | null | undefined, mappedValues: string[]): boolean => {
    const normalized = String(raw || '').trim().toLowerCase();
    if (!normalized || mappedValues.length === 0) {
      return false;
    }
    return mappedValues.some((item) => String(item || '').trim().toLowerCase() === normalized);
  };

  const classifyLeadOutcome = (statusIdRaw: string | null | undefined, reasonValueRaw: string | null | undefined): {
    isQualified: boolean;
    isNonQualified: boolean;
  } => {
    const statusId = String(statusIdRaw || '').trim();
    const reasonValue = String(reasonValueRaw || '').trim();
    const isQualifiedByStage = statusId ? qualifiedStageIds.includes(statusId) : false;
    const isQualified = qualifiedStageIds.length > 0
      ? isQualifiedByStage
      : isMappedValue(reasonValue, qualifiedValues);
    const isNonQualifiedByReason = nonQualifiedValues.length > 0
      ? isMappedValue(reasonValue, nonQualifiedValues)
      : false;
    const isNonQualified = isLostLeadStatus(statusId) && isNonQualifiedByReason;

    return { isQualified, isNonQualified };
  };

  const reasonMap = new Map<string, number>();
  const sourceMap = new Map<string, number>();
  const managerLeadsByAmoId = new Map<string, { leads: number; qualified: number; nonQualified: number }>();

  let usedLiveAmoLeads = false;
  let amoContext: Awaited<ReturnType<typeof getTenantAmoCRMContext>> = null;
  try {
    amoContext = await getTenantAmoCRMContext(params.tenantId);
  } catch (error: any) {
    usedLiveAmoLeads = false;
    log(LogLevel.WARN, 'Report generation: failed to load AmoCRM context, falling back to local lead metrics', {
      tenantId: params.tenantId,
      error: error?.message || 'Unknown error',
    });
  }
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
        const reasonValue = extractLeadValue(lead, reasonFieldKey);
        const { isQualified, isNonQualified } = classifyLeadOutcome(statusId, reasonValue);
        if (isQualified) {
          qualifiedLeads += 1;
        }

        if (isNonQualified) {
          const reasonBucket = reasonValue || "Sabab ko'rsatilmagan";
          reasonMap.set(reasonBucket, (reasonMap.get(reasonBucket) || 0) + 1);
        }

        const sourceValue = extractLeadValue(lead, sourceFieldKey);
        if (sourceValue) {
          sourceMap.set(sourceValue, (sourceMap.get(sourceValue) || 0) + 1);
        }

        const responsibleUserId = String((lead as Record<string, unknown>).responsible_user_id || '').trim();
        if (!responsibleUserId) {
          continue;
        }

        const current = managerLeadsByAmoId.get(responsibleUserId) || { leads: 0, qualified: 0, nonQualified: 0 };
        current.leads += 1;
        if (isQualified) {
          current.qualified += 1;
        }
        if (isNonQualified) {
          current.nonQualified += 1;
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
      const statusId = lead.status ? String(lead.status) : '';
      const { isQualified, isNonQualified } = classifyLeadOutcome(statusId, reasonValue);
      if (isNonQualified) {
        const reasonBucket = reasonValue || "Sabab ko'rsatilmagan";
        reasonMap.set(reasonBucket, (reasonMap.get(reasonBucket) || 0) + 1);
      }

      const sourceValue = extractLeadValue(lead.metadata, sourceFieldKey);
      if (sourceValue) {
        sourceMap.set(sourceValue, (sourceMap.get(sourceValue) || 0) + 1);
      }

      const responsibleUserId = String(lead.responsibleUserId || '').trim();
      if (!responsibleUserId) {
        continue;
      }
      const current = managerLeadsByAmoId.get(responsibleUserId) || { leads: 0, qualified: 0, nonQualified: 0 };
      current.leads += 1;
      if (isQualified) {
        current.qualified += 1;
      }
      if (isNonQualified) {
        current.nonQualified += 1;
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
  const managerSalesByUserId = new Map<string, { sales: number; agreementAmount: number; incomeAmount: number }>();
  const selectedCourseIdSet = new Set(selectedReportCourses.map((course) => course.id));
  const selectedCourseStats = new Map<string, { salesCount: number; tariffCounts: Map<string, number> }>();
  for (const course of selectedReportCourses) {
    selectedCourseStats.set(course.id, { salesCount: 0, tariffCounts: new Map<string, number>() });
  }
  for (const income of selectedCourseIncomes) {
    if (!income.courseId || !selectedCourseIdSet.has(income.courseId)) {
      continue;
    }
    const courseStats = selectedCourseStats.get(income.courseId) || { salesCount: 0, tariffCounts: new Map<string, number>() };
    const tariffName = String(income.tariff?.name || "Tarif yo'q").trim() || "Tarif yo'q";
    courseStats.salesCount += 1;
    courseStats.tariffCounts.set(tariffName, (courseStats.tariffCounts.get(tariffName) || 0) + 1);
    selectedCourseStats.set(income.courseId, courseStats);
  }

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

    const managerStats = managerSalesByUserId.get(income.managerUserId) || { sales: 0, agreementAmount: 0, incomeAmount: 0 };
    managerStats.incomeAmount += paymentAmount;

    if (income.type !== 'new_sale') {
      managerSalesByUserId.set(income.managerUserId, managerStats);
      continue;
    }

    newSalesCount += 1;
    const agreementAmount = Number(income.coursePriceAmount || 0);
    agreementTotal += agreementAmount;
    managerStats.sales += 1;
    managerStats.agreementAmount += agreementAmount;
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

  const usersByAmoId = new Map<string, { id: string; name: string; group: ManagerGroup | null }>();
  const usersById = new Map<string, { id: string; name: string; group: ManagerGroup | null }>();
  const managerByExtension = new Map<string, string>();
  for (const user of users) {
    const displayName = (user.name || user.username || user.id).trim();
    const group = classifyManagerGroup(user.roles);
    usersById.set(user.id, { id: user.id, name: displayName, group });
    if (user.amocrmResponsibleUserId) {
      usersByAmoId.set(String(user.amocrmResponsibleUserId), { id: user.id, name: displayName, group });
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
    group: ManagerGroup | null;
    name: string;
    leads: number;
    qualified: number;
    nonQualified: number;
    sales: number;
    agreementAmount: number;
    incomeAmount: number;
  }>();

  for (const [amoId, leadStats] of managerLeadsByAmoId.entries()) {
    const mappedUser = usersByAmoId.get(amoId);
    if (!mappedUser) {
      continue;
    }
    const existing = managerRowsByUserId.get(mappedUser.id) || {
      userId: mappedUser.id,
      group: mappedUser.group,
      name: mappedUser.name,
      leads: 0,
      qualified: 0,
      nonQualified: 0,
      sales: 0,
      agreementAmount: 0,
      incomeAmount: 0,
    };
    existing.leads += leadStats.leads;
    existing.qualified += leadStats.qualified;
    existing.nonQualified += leadStats.nonQualified;
    managerRowsByUserId.set(mappedUser.id, existing);
  }

  for (const [userId, salesStats] of managerSalesByUserId.entries()) {
    const mappedUser = usersById.get(userId);
    const name = mappedUser?.name || userId;
    const existing = managerRowsByUserId.get(userId) || {
      userId,
      group: mappedUser?.group || null,
      name,
      leads: 0,
      qualified: 0,
      nonQualified: 0,
      sales: 0,
      agreementAmount: 0,
      incomeAmount: 0,
    };
    existing.sales += salesStats.sales;
    existing.agreementAmount += salesStats.agreementAmount;
    existing.incomeAmount += salesStats.incomeAmount;
    managerRowsByUserId.set(userId, existing);
  }

  const nonQualifiedLeads = Array.from(reasonMap.values()).reduce((sum, value) => sum + value, 0);
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
      group: row.group,
      name: row.name,
      leads: row.leads,
      qualified: row.qualified,
      nonQualified: row.nonQualified,
      sales: row.sales,
      conversion: row.leads > 0 ? normalizePercentage((row.sales / row.leads) * 100) : 0,
      agreementAmount: row.agreementAmount,
      incomeAmount: row.incomeAmount,
      callDurationSeconds: (managerCallDurationByUserId.get(row.userId) || 0) + (corporateDurationByUserId.get(row.userId) || 0),
    }))
    .filter((row): row is ReportManagerRow => (
      row.group !== null
      && (row.leads > 0 || row.sales > 0 || row.agreementAmount > 0 || row.incomeAmount > 0)
    ))
    .sort(compareManagerRows);

  const coursesById = new Map(selectedReportCourses.map((course) => [course.id, course]));
  const selectedCourseRows = selectedCourseIds
    .map((courseId) => {
      const course = coursesById.get(courseId);
      if (!course) {
        return null;
      }
      const stats = selectedCourseStats.get(courseId) || { salesCount: 0, tariffCounts: new Map<string, number>() };
      return {
        courseId,
        courseName: course.name,
        salesCount: stats.salesCount,
        tariffBreakdown: Array.from(stats.tariffCounts.entries())
          .map(([label, value]) => ({ label, value }))
          .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label)),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

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
    selectedCourseRows,
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
  const selectedReportCourseIds = window.kind === 'daily'
    ? parseTelegramDailyReportCourseIds(integration.config)
    : [];
  const metrics = await collectMetrics({
    tenantId: integration.tenantId,
    tenantSettings: integration.tenant.settings,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    selectedPipelineIds,
    selectedReportCourseIds,
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
