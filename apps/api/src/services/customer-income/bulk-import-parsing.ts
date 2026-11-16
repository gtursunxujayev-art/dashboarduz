import type { createIncomeSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import type { z } from 'zod';

import { normalizeKey } from '../../lib/text';

export type CreateIncomeInput = z.infer<typeof createIncomeSchema>;

type BulkIncomeCell = string | number | boolean | null;

export type BulkIncomeRow = Record<string, BulkIncomeCell>;

export type RowLookupContext = {
  managersByKey: Map<string, string>;
  managersByNormalizedName: Array<{ id: string; name: string }>;
  coursesByKey: Map<string, string>;
  tariffsByCourseIdAndKey: Map<string, string>;
  subTariffsByTariffIdAndKey: Map<string, string>;
  firstSubTariffIdByTariffId: Map<string, string>;
};

export const ENTRY_DATE_HEADERS = ['entrydate', 'date', 'sana'];

export const MANAGER_HEADERS = ['salesmanager', 'manager', 'manageruserid', 'managerid'];

export const CUSTOMER_NUMBER_HEADERS = ['customernumber', 'mijozraqami', 'customerphone', 'raqam'];

export const CUSTOMER_NAME_HEADERS = ['customername', 'mijozismi', 'name'];

export const TELEGRAM_HEADERS = ['telegramusername', 'telegram', 'telegramuser'];

export const TYPE_HEADERS = ['type', 'incometype', 'transactiontype', 'turi'];

export const COURSE_HEADERS = ['course', 'coursename', 'kurs'];

export const TARIFF_HEADERS = ['tariff', 'tarif'];

export const SUB_TARIFF_HEADERS = ['subtariff', 'subtarif', 'sub_tariff', 'sub_tarif', 'subkurs', 'subkursi'];

export const COURSE_PRICE_HEADERS = ['courseprice', 'kursnarxi', 'price'];

export const PAYMENT_HEADERS = ['payment', 'paymentamount', 'tolov', 'toplov'];

export const DEADLINE_HEADERS = ['deadline', 'muddat'];

export const DEBT_SOURCE_HEADERS = ['debtsourceincomeid', 'debtincomeid', 'relateddebtincomeid', 'sourceincomeid'];

export function normalizeStringValue(value: BulkIncomeCell | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '';
    }

    return String(value);
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return '';
}

export function parseAmountValue(value: BulkIncomeCell | undefined): number {
  const normalized = normalizeStringValue(value);

  if (!normalized) {
    return 0;
  }

  const digits = normalized.replace(/[^\d-]/g, '');

  if (!digits || digits === '-') {
    return 0;
  }

  const parsed = Number.parseInt(digits, 10);

  if (Number.isNaN(parsed)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid numeric amount: ${normalized}` });
  }

  return parsed;
}

function excelSerialToDateString(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  const milliseconds = epoch + Math.round(serial * 86400000);

  return new Date(milliseconds).toISOString().slice(0, 10);
}

export function parseDateValue(value: BulkIncomeCell | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1000 && value < 100000) {
      return excelSerialToDateString(value);
    }

    return new Date(value).toISOString().slice(0, 10);
  }

  const normalized = normalizeStringValue(value);

  if (!normalized) {
    return '';
  }

  return normalized;
}

export function resolveType(rawType: string): 'new_sale' | 'repayment' {
  const key = normalizeKey(rawType);

  if (!key) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Income type is required.' });
  }

  if (['newsale', 'sale', 'newincome', 'yangisotuv', 'yangi'].includes(key)) {
    return 'new_sale';
  }

  if (['repayment', 'debt', 'qarzdorlik', 'paymentdebt'].includes(key)) {
    return 'repayment';
  }

  throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown income type: ${rawType}` });
}

export function getRowValue(row: Map<string, BulkIncomeCell>, candidateHeaders: string[]): BulkIncomeCell | undefined {
  for (const candidate of candidateHeaders) {
    const value = row.get(candidate);

    if (value === null || value === undefined) {
      continue;
    }

    const normalized = normalizeStringValue(value);

    if (!normalized) {
      continue;
    }

    return value;
  }

  return undefined;
}

export function buildNormalizedRow(rawRow: BulkIncomeRow): Map<string, BulkIncomeCell> {
  const normalizedRow = new Map<string, BulkIncomeCell>();

  for (const [rawHeader, value] of Object.entries(rawRow)) {
    const normalizedHeader = normalizeKey(rawHeader);

    if (!normalizedHeader) {
      continue;
    }
    normalizedRow.set(normalizedHeader, value);
  }

  return normalizedRow;
}

export function buildLookupKey(courseId: string, tariffToken: string): string {
  return `${courseId}:${normalizeKey(tariffToken)}`;
}

function parseCsvRows(csvContent: string): BulkIncomeRow[] {
  const rows: string[][] = [];
  let currentCell = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < csvContent.length; index += 1) {
    const char = csvContent[index];
    const nextChar = csvContent[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }

      currentRow.push(currentCell);
      currentCell = '';
      if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    if (currentRow.some((cell) => cell.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  if (!rows.length) {
    return [];
  }

  const headerRow = rows[0] ?? [];

  if (!headerRow.length) {
    return [];
  }
  const bodyRows = rows.slice(1);
  const headers = headerRow.map((header) => header.trim());

  return bodyRows.map((line) => {
    const result: BulkIncomeRow = {};

    headers.forEach((header, index) => {
      if (!header) {
        return;
      }
      result[header] = line[index] ?? '';
    });

    return result;
  });
}

function resolveGoogleSheetCsvUrl(sheetUrlInput: string): string {
  const trimmedInput = sheetUrlInput.trim();
  const spreadsheetIdPattern = /^[a-zA-Z0-9-_]{20,}$/;

  if (spreadsheetIdPattern.test(trimmedInput)) {
    return `https://docs.google.com/spreadsheets/d/${trimmedInput}/export?format=csv`;
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmedInput);
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Google Sheets URL.' });
  }

  const host = parsedUrl.hostname.toLowerCase();

  if (!host.includes('google.com')) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Google Sheets import currently supports only docs.google.com URLs.',
    });
  }

  if (parsedUrl.pathname.includes('/export') && parsedUrl.searchParams.get('format') === 'csv') {
    return parsedUrl.toString();
  }

  const idMatch = parsedUrl.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  if (!idMatch?.[1]) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Could not detect spreadsheet ID from Google Sheets URL.',
    });
  }

  const gidFromSearch = parsedUrl.searchParams.get('gid');
  const hashMatch = parsedUrl.hash.match(/gid=(\d+)/);
  const gid = gidFromSearch || hashMatch?.[1];

  return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}
