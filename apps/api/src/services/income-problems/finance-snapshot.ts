import type { DbClient } from '@dashboarduz/db';
import { normalizeDigits } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { asObjectOrEmpty } from '../../lib/object';
import { normalizeMatchText } from '../../lib/text';

export type SnapshotMapping = {
  paymentDate: number | null;
  customerPhone: number | null;
  customerName: number | null;
  telegramUsername: number | null;
  managerLabel: number | null;
  courseName: number | null;
  tariffName: number | null;
  subTariffName: number | null;
  paymentType: number | null;
  agreementAmount: number | null;
  paymentAmount: number | null;
  remainingDebtAmount: number | null;
  deadline: number | null;
};

export type FinanceSnapshotRow = {
  rowIndex: number;
  paymentDate: string | null;
  customerPhone: string;
  customerName: string;
  telegramUsername: string;
  managerLabel: string;
  courseName: string;
  tariffName: string;
  subTariffName: string;
  paymentType: string;
  agreementAmount: number;
  paymentAmount: number;
  remainingDebtAmount: number;
  deadline: string | null;
  normalizedPhone: string;
  normalizedName: string;
};

export type ActiveSnapshot = {
  version: 1;
  workbookName: string;
  sheetName: string;
  activatedAt: string;
  mapping: SnapshotMapping;
  rowCount: number;
  rows: FinanceSnapshotRow[];
};

const HEADER_ALIASES: Record<keyof SnapshotMapping, string[]> = {
  paymentDate: ["to'lov sanasi", 'tolov sanasi', 'sana', 'date', 'payment date'],
  customerPhone: ['telefon raqami', 'telefon', 'phone', 'raqam', 'mijoz raqami'],
  customerName: ['mijoz ism familiya', 'ism familiya', 'mijoz', 'ismi', 'customer name'],
  telegramUsername: ['telegram username', 'telegram', 'username', 'tg'],
  managerLabel: ['agent', 'operator', 'manager', 'menedjer', 'sotuv menejeri'],
  courseName: ['kurs turi', 'kurs', 'course'],
  tariffName: ['tarif', 'tariff'],
  subTariffName: ['subtarif', 'sub tarif', 'sub-tarif'],
  paymentType: ["to'lov turi", 'tolov turi', 'payment type', 'tur'],
  agreementAmount: ['kelishilgan narx', 'kelishuv summasi', 'agreement', 'narx'],
  paymentAmount: ["to'lov summasi", 'tolov summasi', 'payment amount', "to'lov"],
  remainingDebtAmount: ['qarzi', 'qarz', 'remaining debt', 'qoldiq qarz'],
  deadline: ['deadline', 'muddat'],
};

export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // Typographic apostrophes and the Uzbek modifier letters (to‘lov, to’lov, toʻlov) read as a plain one.
    .replace(/[\u2018\u2019\u02BB\u02BC`]/g, "'");
}

/**
 * A spreadsheet amount: spaces are dropped; when both "," and "." occur, the last one is the decimal point; a lone
 * kind of separator is a thousands separator when it repeats or has exactly three digits after it ("2,000,000",
 * "1.500"), otherwise a decimal point ("1500,50"). Returns NaN for text that is not an amount, 0 for an empty cell.
 */
export function parseMoney(value: unknown): number {
  if (typeof value === 'number') return value;
  const raw = String(value ?? '').replace(/[\s\u00A0]+/g, '').replace(/(so'?m|uzs|sum)$/i, '');

  if (!raw) return 0;
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  let normalized = raw;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';

    normalized = raw.split(thousands).join('').replace(decimal, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? ',' : '.';
    const parts = raw.split(separator);
    const isThousands = parts.length > 2 || parts[parts.length - 1]!.length === 3;

    normalized = isThousands ? parts.join('') : parts.join('.');
  }

  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}

function parseDateText(value: unknown): string | null {
  const raw = String(value ?? '').trim();

  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const ddmmyyyy = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);

  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toISOString().slice(0, 10);
}

export function detectHeaderRow(rows: Array<Array<string | number | boolean | null>>): number {
  let bestIndex = 0;
  let bestScore = -1;

  for (let index = 0; index < Math.min(rows.length, 12); index += 1) {
    const normalized = (rows[index] || []).map((cell) => normalizeHeader(cell));
    let score = 0;

    for (const aliases of Object.values(HEADER_ALIASES)) {
      if (normalized.some((header) => aliases.some((alias) => header.includes(alias)))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function detectMapping(headers: string[]): SnapshotMapping {
  const result: SnapshotMapping = {
    paymentDate: null,
    customerPhone: null,
    customerName: null,
    telegramUsername: null,
    managerLabel: null,
    courseName: null,
    tariffName: null,
    subTariffName: null,
    paymentType: null,
    agreementAmount: null,
    paymentAmount: null,
    remainingDebtAmount: null,
    deadline: null,
  };

  const fields = Object.keys(result) as Array<keyof SnapshotMapping>;
  // A header that is exactly some field's alias belongs to that field: "to'lov sanasi" is the payment date even
  // though it contains the payment amount alias "to'lov".
  const exactOwner = (header: string) => fields.find((field) => HEADER_ALIASES[field].includes(header));

  fields.forEach((field) => {
    const aliases = HEADER_ALIASES[field];
    const exactIndex = headers.findIndex((header) => aliases.includes(header));
    const foundIndex = exactIndex >= 0
      ? exactIndex
      : headers.findIndex((header) => {
        const owner = exactOwner(header);

        return (!owner || owner === field) && aliases.some((alias) => header.includes(alias));
      });

    if (foundIndex >= 0) result[field] = foundIndex;
  });

  return result;
}

function getCell(row: Array<string | number | boolean | null>, index: number | null): unknown {
  return index === null || index === undefined ? '' : row[index] ?? '';
}

export function normalizeFinanceRows(rows: Array<Array<string | number | boolean | null>>, mapping: SnapshotMapping): {
  normalizedRows: FinanceSnapshotRow[];
  errors: string[];
} {
  const normalizedRows: FinanceSnapshotRow[] = [];
  const errors: string[] = [];

  rows.forEach((row, rowIndex) => {
    const paymentDate = parseDateText(getCell(row, mapping.paymentDate));
    const customerPhone = String(getCell(row, mapping.customerPhone) ?? '').trim();
    const customerName = String(getCell(row, mapping.customerName) ?? '').trim();
    const normalizedPhone = normalizeDigits(customerPhone);
    const normalizedName = normalizeMatchText(customerName, { collapseWhitespace: true });
    const rawPayment = getCell(row, mapping.paymentAmount);
    const paymentAmount = parseMoney(rawPayment);

    if (!paymentDate && !normalizedPhone && !normalizedName && !paymentAmount) {
      return;
    }
    if (!normalizedPhone && !normalizedName) {
      errors.push(`Qator ${rowIndex + 1}: mijoz telefoni yoki ismi topilmadi.`);

      return;
    }
    if (Number.isNaN(paymentAmount)) {
      errors.push(`Qator ${rowIndex + 1}: to'lov summasi o'qilmadi (${String(rawPayment).slice(0, 40)}).`);

      return;
    }

    normalizedRows.push({
      rowIndex: rowIndex + 1,
      paymentDate,
      customerPhone,
      customerName,
      telegramUsername: String(getCell(row, mapping.telegramUsername) ?? '').trim(),
      managerLabel: String(getCell(row, mapping.managerLabel) ?? '').trim(),
      courseName: String(getCell(row, mapping.courseName) ?? '').trim(),
      tariffName: String(getCell(row, mapping.tariffName) ?? '').trim(),
      subTariffName: String(getCell(row, mapping.subTariffName) ?? '').trim(),
      paymentType: String(getCell(row, mapping.paymentType) ?? '').trim(),
      agreementAmount: parseMoney(getCell(row, mapping.agreementAmount)) || 0,
      paymentAmount,
      remainingDebtAmount: parseMoney(getCell(row, mapping.remainingDebtAmount)) || 0,
      deadline: parseDateText(getCell(row, mapping.deadline)),
      normalizedPhone,
      normalizedName,
    });
  });

  return { normalizedRows, errors };
}

export async function readTenantSettings(tenantId: string, db: DbClient) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });

  if (!tenant) throw new TRPCError({ code: 'NOT_FOUND', message: 'Ish maydoni topilmadi.' });

  return asObjectOrEmpty(tenant.settings);
}

export async function writeTenantSettings(tenantId: string, settings: Record<string, unknown>, db: DbClient) {
  await db.tenant.update({
    where: { id: tenantId },
    data: { settings: JSON.parse(JSON.stringify(settings)) as Prisma.InputJsonValue },
  });
}

/** The finance spreadsheet snapshot activated for the tenant, if any. */
export async function getActiveSnapshot(tenantId: string, db: DbClient): Promise<ActiveSnapshot | null> {
  const settings = await readTenantSettings(tenantId, db);
  const incomeProblems = asObjectOrEmpty(settings.incomeProblems);
  const activeSnapshot = incomeProblems.activeSnapshot;

  if (!activeSnapshot || typeof activeSnapshot !== 'object' || Array.isArray(activeSnapshot)) return null;

  return activeSnapshot as ActiveSnapshot;
}
