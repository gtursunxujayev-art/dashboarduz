import { createHash } from 'crypto';

import { normalizeKey } from '../../lib/text';

import { HISTORICAL_CUSTOMER_HEADERS, HISTORICAL_INCOME_HEADERS, type HistoricalCourseCategory, type HistoricalManagerLookup, type HistoricalRawCell, type HistoricalRawRow, LEGACY_INCOME_EXACT_MAP } from './types';

function collapseWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function excelSerialToIso(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  const milliseconds = epoch + Math.round(serial * 86400000);

  return new Date(milliseconds).toISOString().slice(0, 10);
}

function formatIsoParts(year: number, month: number, day: number): string | null {
  if (!year || !month || !day) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseDateToIso(value: HistoricalRawCell | undefined): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1000 && value < 100000) {
      return excelSerialToIso(value);
    }

    return new Date(value).toISOString().slice(0, 10);
  }

  const raw = collapseWhitespace(String(value ?? ''));

  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  let match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);

  if (match) {
    let year = Number(match[3]);

    if (year < 100) {
      year += 2000;
    }

    return formatIsoParts(year, Number(match[2]), Number(match[1]));
  }

  match = raw.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})$/);
  if (match) {
    const monthMap: Record<string, number> = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      sept: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };
    const monthToken = match[2] || '';
    const month = monthMap[monthToken.toLowerCase()];

    if (!month) {
      return null;
    }

    return formatIsoParts(Number(match[3]), month, Number(match[1]));
  }

  const parsed = new Date(raw);

  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
  }

  return null;
}

export function parseAmountOrNull(value: HistoricalRawCell | undefined): number | null {
  const raw = collapseWhitespace(String(value ?? ''));

  if (!raw) {
    return null;
  }
  const digits = raw.replace(/[^\d-]/g, '');

  if (!digits || digits === '-') {
    return null;
  }
  const parsed = Number.parseInt(digits, 10);

  return Number.isNaN(parsed) ? null : parsed;
}

export function getRawValue(row: HistoricalRawRow, candidates: string[]): HistoricalRawCell | undefined {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate)) {
      return row[candidate];
    }
  }

  const normalizedCandidates = new Set(candidates.map((candidate) => normalizeKey(candidate)));

  for (const [key, value] of Object.entries(row)) {
    if (normalizedCandidates.has(normalizeKey(key))) {
      return value;
    }
  }

  return undefined;
}

export function getStringValue(row: HistoricalRawRow, candidates: string[]): string {
  const rawValue = getRawValue(row, candidates);

  if (rawValue === null || rawValue === undefined) {
    return '';
  }
  if (typeof rawValue === 'string') {
    return collapseWhitespace(rawValue);
  }
  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return collapseWhitespace(String(rawValue));
  }

  return '';
}

export function isEmptyRow(row: HistoricalRawRow): boolean {
  return Object.values(row).every((value) => collapseWhitespace(String(value ?? '')).length === 0);
}

export function isIncomeHeaderLikeRow(row: HistoricalRawRow): boolean {
  const manager = normalizeKey(getStringValue(row, HISTORICAL_INCOME_HEADERS.manager));
  const customerNumber = normalizeKey(getStringValue(row, HISTORICAL_INCOME_HEADERS.customerNumber));
  const type = normalizeKey(getStringValue(row, HISTORICAL_INCOME_HEADERS.type));
  const course = normalizeKey(getStringValue(row, HISTORICAL_INCOME_HEADERS.courseLabel));

  return customerNumber === 'telefonraqami' || type === 'tolovturi' || course === 'kursturi' || (manager === 'operator' && customerNumber === 'telefonraqami');
}

export function isCustomerHeaderLikeRow(row: HistoricalRawRow): boolean {
  const manager = normalizeKey(getStringValue(row, HISTORICAL_CUSTOMER_HEADERS.manager));
  const customerNumber = normalizeKey(getStringValue(row, HISTORICAL_CUSTOMER_HEADERS.customerNumber));
  const course = normalizeKey(getStringValue(row, HISTORICAL_CUSTOMER_HEADERS.courseLabel));

  return customerNumber === 'telefonraqami' || course === 'qaysicouching' || (manager === 'operator' && customerNumber === 'telefonraqami');
}

export function buildHashKey(payload: Record<string, unknown>): string {
  return createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

export function toDisplayLabel(value: string): string {
  return collapseWhitespace(value);
}

export function normalizePaymentType(rawValue: string): 'new_sale' | 'repayment' | null {
  const key = normalizeKey(rawValue);

  if (!key) {
    return null;
  }
  if (key === 'qarzdorlik') {
    return 'repayment';
  }
  if (key === 'birinchitolov' || key === 'birinchtolov' || key === 'oxirgitolov') {
    return 'new_sale';
  }

  return null;
}

export function normalizeIncomeCourseSpec(rawLabel: string): { courseName: string; tariffName: string; category: HistoricalCourseCategory } {
  const cleaned = toDisplayLabel(rawLabel);
  const key = normalizeKey(cleaned);
  const exact = LEGACY_INCOME_EXACT_MAP[key];

  if (exact) {
    return exact;
  }

  const onlinePrefix = cleaned.match(/^(onlayn|online)\s*[-/]\s*(.+)$/i);

  if (onlinePrefix) {
    return {
      courseName: 'Onlayn',
      tariffName: toDisplayLabel(onlinePrefix[2] || 'Asosiy'),
      category: 'online',
    };
  }

  const offlinePrefix = cleaned.match(/^(oflayn|offline)\s*[-/]\s*(.+)$/i);

  if (offlinePrefix) {
    return {
      courseName: 'Oflayn',
      tariffName: toDisplayLabel(offlinePrefix[2] || 'Asosiy'),
      category: 'offline',
    };
  }

  if (key.includes('intensiv')) {
    return {
      courseName: 'Intensiv',
      tariffName: 'Asosiy',
      category: 'intensive',
    };
  }

  return {
    courseName: cleaned,
    tariffName: 'Asosiy',
    category: 'additional_service',
  };
}

export function inferProfileCourseCategory(rawCourseLabel: string): HistoricalCourseCategory {
  const key = normalizeKey(rawCourseLabel);

  if (key.includes('online') || key.includes('onlayn')) {
    return 'online';
  }
  if (key.includes('intensiv')) {
    return 'intensive';
  }
  if (key === 'sayohat' || key === 'obuna' || key === 'korporativ' || key === 'talaba' || key === 'oquvquroli' || key === 'shaxsiykonsultatsiya' || key === 'togdarsi') {
    return 'additional_service';
  }

  return 'offline';
}

export function shouldSkipHistoricalCourseCategory(category: HistoricalCourseCategory | null): boolean {
  return category === 'additional_service';
}

export function normalizeAliasMap(aliasMapInput: Record<string, string> | undefined): Record<string, string> {
  const aliasMap: Record<string, string> = {};

  for (const [label, userId] of Object.entries(aliasMapInput || {})) {
    const key = normalizeKey(label);

    if (!key || !userId) {
      continue;
    }
    aliasMap[key] = userId;
  }

  return aliasMap;
}

export function resolveManagerUserId(params: {
  rawManagerValue: string;
  managerLookup: HistoricalManagerLookup;
  aliasMap: Record<string, string>;
  fallbackManagerUserId?: string;
}): { managerUserId: string | null; needsMapping: boolean } {
  const normalizedRawValue = normalizeKey(params.rawManagerValue);

  if (!normalizedRawValue) {
    return {
      managerUserId: params.fallbackManagerUserId || null,
      needsMapping: !params.fallbackManagerUserId,
    };
  }

  const exactMatch = params.managerLookup.managersByKey[normalizedRawValue];

  if (exactMatch) {
    return { managerUserId: exactMatch, needsMapping: false };
  }

  const aliasMatch = params.aliasMap[normalizedRawValue];

  if (aliasMatch) {
    return { managerUserId: aliasMatch, needsMapping: false };
  }

  const containsMatches = params.managerLookup.managersByNormalizedName.filter((manager) => manager.name.includes(normalizedRawValue) || normalizedRawValue.includes(manager.name));

  if (containsMatches.length === 1) {
    return { managerUserId: containsMatches[0]?.id || null, needsMapping: false };
  }

  if (params.fallbackManagerUserId) {
    return { managerUserId: params.fallbackManagerUserId, needsMapping: false };
  }

  return { managerUserId: null, needsMapping: true };
}
