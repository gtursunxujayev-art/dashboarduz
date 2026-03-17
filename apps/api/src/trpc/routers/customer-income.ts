import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';
import {
  bulkIncomeImportFromGoogleSheetSchema,
  bulkIncomeImportSchema,
  createCourseSchema,
  createIncomeSchema,
  createTariffSchema,
  customerSearchSchema,
} from '@dashboarduz/shared';
import { z } from 'zod';
import { adminProcedure, protectedProcedure, router } from '../trpc';

const SALES_MANAGER_ROLES = ['Admin', 'Manager', 'Agent'] as const;

function parseDateInput(input: string): Date {
  const value = input.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid date: ${input}` });
  }

  return date;
}

async function assertManagerBelongsToTenant(tenantId: string, managerUserId: string) {
  const manager = await prisma.user.findFirst({
    where: {
      id: managerUserId,
      tenantId,
      isActive: true,
      roles: {
        hasSome: [...SALES_MANAGER_ROLES],
      },
    },
    select: {
      id: true,
    },
  });

  if (!manager) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected sales manager is not available.' });
  }
}

type CreateIncomeInput = z.infer<typeof createIncomeSchema>;
type BulkIncomeCell = string | number | boolean | null;
type BulkIncomeRow = Record<string, BulkIncomeCell>;

type RowLookupContext = {
  managersByKey: Map<string, string>;
  managersByNormalizedName: Array<{ id: string; name: string }>;
  coursesByKey: Map<string, string>;
  tariffsByCourseIdAndKey: Map<string, string>;
};

const ENTRY_DATE_HEADERS = ['entrydate', 'date', 'sana'];
const MANAGER_HEADERS = ['salesmanager', 'manager', 'manageruserid', 'managerid'];
const CUSTOMER_NUMBER_HEADERS = ['customernumber', 'mijozraqami', 'customerphone', 'raqam'];
const CUSTOMER_NAME_HEADERS = ['customername', 'mijozismi', 'name'];
const TELEGRAM_HEADERS = ['telegramusername', 'telegram', 'telegramuser'];
const TYPE_HEADERS = ['type', 'incometype', 'transactiontype', 'turi'];
const COURSE_HEADERS = ['course', 'coursename', 'kurs'];
const TARIFF_HEADERS = ['tariff', 'tarif'];
const COURSE_PRICE_HEADERS = ['courseprice', 'kursnarxi', 'price'];
const PAYMENT_HEADERS = ['payment', 'paymentamount', 'tolov', 'toplov'];
const DEADLINE_HEADERS = ['deadline', 'muddat'];
const DEBT_SOURCE_HEADERS = ['debtsourceincomeid', 'debtincomeid', 'relateddebtincomeid', 'sourceincomeid'];

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/['"`’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeStringValue(value: BulkIncomeCell | undefined): string {
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

function parseAmountValue(value: BulkIncomeCell | undefined): number {
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

function parseDateValue(value: BulkIncomeCell | undefined): string {
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

function resolveType(rawType: string): 'new_sale' | 'repayment' {
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

function getRowValue(row: Map<string, BulkIncomeCell>, candidateHeaders: string[]): BulkIncomeCell | undefined {
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

function buildNormalizedRow(rawRow: BulkIncomeRow): Map<string, BulkIncomeCell> {
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

function buildLookupKey(courseId: string, tariffToken: string): string {
  return `${courseId}:${normalizeKey(tariffToken)}`;
}

async function buildRowLookupContext(tenantId: string): Promise<RowLookupContext> {
  const [managers, courses] = await Promise.all([
    prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        roles: {
          hasSome: [...SALES_MANAGER_ROLES],
        },
      },
      select: {
        id: true,
        name: true,
        username: true,
      },
    }),
    prisma.course.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        tariffs: {
          where: {
            isActive: true,
          },
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const managersByKey = new Map<string, string>();
  const aliasCandidates = new Map<string, Set<string>>();
  const managersByNormalizedName: Array<{ id: string; name: string }> = [];

  const addManagerAlias = (alias: string, managerId: string) => {
    const normalizedAlias = normalizeKey(alias);
    if (!normalizedAlias) {
      return;
    }
    const existing = aliasCandidates.get(normalizedAlias) ?? new Set<string>();
    existing.add(managerId);
    aliasCandidates.set(normalizedAlias, existing);
  };

  for (const manager of managers) {
    addManagerAlias(manager.id, manager.id);
    if (manager.username) {
      addManagerAlias(manager.username, manager.id);
    }
    if (manager.name) {
      addManagerAlias(manager.name, manager.id);
      const tokens = manager.name
        .split(/\s+/)
        .map((token: string) => token.trim())
        .filter(Boolean);
      for (const token of tokens) {
        addManagerAlias(token, manager.id);
      }
      managersByNormalizedName.push({
        id: manager.id,
        name: normalizeKey(manager.name),
      });
    }
  }

  for (const [alias, managerIds] of aliasCandidates.entries()) {
    if (managerIds.size === 1) {
      managersByKey.set(alias, [...managerIds][0] as string);
    }
  }

  const coursesByKey = new Map<string, string>();
  const tariffsByCourseIdAndKey = new Map<string, string>();

  for (const course of courses) {
    coursesByKey.set(normalizeKey(course.id), course.id);
    coursesByKey.set(normalizeKey(course.name), course.id);

    for (const tariff of course.tariffs) {
      tariffsByCourseIdAndKey.set(buildLookupKey(course.id, tariff.id), tariff.id);
      tariffsByCourseIdAndKey.set(buildLookupKey(course.id, tariff.name), tariff.id);
    }
  }

  return {
    managersByKey,
    managersByNormalizedName,
    coursesByKey,
    tariffsByCourseIdAndKey,
  };
}

function resolveManagerUserId(params: {
  rawManagerValue: string;
  lookupContext: RowLookupContext;
  fallbackManagerUserId?: string;
  rowNumber: number;
}): string {
  const { rawManagerValue, lookupContext, fallbackManagerUserId, rowNumber } = params;
  const normalizedRawValue = normalizeKey(rawManagerValue);

  if (!normalizedRawValue) {
    if (fallbackManagerUserId) {
      return fallbackManagerUserId;
    }
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Row ${rowNumber}: sales manager is required.` });
  }

  const exactMatch = lookupContext.managersByKey.get(normalizedRawValue);
  if (exactMatch) {
    return exactMatch;
  }

  const containsMatches = lookupContext.managersByNormalizedName.filter((manager) =>
    manager.name.includes(normalizedRawValue) || normalizedRawValue.includes(manager.name),
  );

  if (containsMatches.length === 1) {
    return containsMatches[0]?.id as string;
  }

  if (fallbackManagerUserId) {
    return fallbackManagerUserId;
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `Row ${rowNumber}: sales manager is missing or not found (${rawManagerValue || 'empty'})`,
  });
}

function parseBulkRowToCreateIncomeInput(
  rawRow: BulkIncomeRow,
  rowNumber: number,
  lookupContext: RowLookupContext,
  fallbackManagerUserId?: string,
): CreateIncomeInput {
  const row = buildNormalizedRow(rawRow);

  const managerRaw = normalizeStringValue(getRowValue(row, MANAGER_HEADERS));
  const managerUserId = resolveManagerUserId({
    rawManagerValue: managerRaw,
    lookupContext,
    fallbackManagerUserId,
    rowNumber,
  });

  const entryDate = parseDateValue(getRowValue(row, ENTRY_DATE_HEADERS));
  if (!entryDate) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Row ${rowNumber}: date is required.` });
  }

  const customerNumber = normalizeStringValue(getRowValue(row, CUSTOMER_NUMBER_HEADERS));
  if (!customerNumber) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Row ${rowNumber}: customer number is required.` });
  }

  const typeRaw = normalizeStringValue(getRowValue(row, TYPE_HEADERS));
  const type = resolveType(typeRaw);

  const customerName = normalizeStringValue(getRowValue(row, CUSTOMER_NAME_HEADERS)) || undefined;
  const telegramUsername = normalizeStringValue(getRowValue(row, TELEGRAM_HEADERS)) || undefined;
  const deadline = parseDateValue(getRowValue(row, DEADLINE_HEADERS)) || undefined;
  const paymentAmount = parseAmountValue(getRowValue(row, PAYMENT_HEADERS));
  const debtSourceIncomeId = normalizeStringValue(getRowValue(row, DEBT_SOURCE_HEADERS)) || undefined;

  if (type === 'new_sale') {
    const courseRaw = normalizeStringValue(getRowValue(row, COURSE_HEADERS));
    const courseId = lookupContext.coursesByKey.get(normalizeKey(courseRaw));
    if (!courseId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Row ${rowNumber}: course is required and must match an active course.`,
      });
    }

    const tariffRaw = normalizeStringValue(getRowValue(row, TARIFF_HEADERS));
    const tariffId = lookupContext.tariffsByCourseIdAndKey.get(buildLookupKey(courseId, tariffRaw));
    if (!tariffId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Row ${rowNumber}: tariff is required and must match an active tariff for the selected course.`,
      });
    }

    const coursePriceAmount = parseAmountValue(getRowValue(row, COURSE_PRICE_HEADERS));
    if (coursePriceAmount <= 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Row ${rowNumber}: course price must be greater than zero.`,
      });
    }

    return {
      entryDate,
      managerUserId,
      customerNumber,
      customerName,
      telegramUsername,
      type,
      courseId,
      tariffId,
      coursePriceAmount,
      paymentAmount,
      deadline,
    };
  }

  return {
    entryDate,
    managerUserId,
    customerNumber,
    customerName,
    telegramUsername,
    type,
    debtSourceIncomeId,
    paymentAmount,
    deadline,
  };
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

async function createIncomeEntry(params: {
  tenantId: string;
  userId: string;
  input: CreateIncomeInput;
  writeAuditLog?: boolean;
}) {
  const { tenantId, userId, input, writeAuditLog = true } = params;

  await assertManagerBelongsToTenant(tenantId, input.managerUserId);
  const entryDate = parseDateInput(input.entryDate);
  const deadline = input.deadline ? parseDateInput(input.deadline) : null;
  const customerNumber = input.customerNumber.trim();

  if (input.paymentAmount < 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Payment amount cannot be negative.' });
  }

  let customer = await prisma.customer.findUnique({
    where: {
      tenantId_customerNumber: {
        tenantId,
        customerNumber,
      },
    },
  });

  if (!customer) {
    if (input.type === 'repayment') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Repayment can only be added for an existing customer debt.',
      });
    }

    if (!input.customerName?.trim()) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Customer name is required for a new customer number.',
      });
    }

    customer = await prisma.customer.create({
      data: {
        tenantId,
        customerNumber,
        name: input.customerName.trim(),
        telegramUsername: input.telegramUsername?.trim() || null,
      },
    });
  }

  let createdIncome;

  if (input.type === 'new_sale') {
    if (!input.courseId || !input.tariffId || input.coursePriceAmount === undefined) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Course, tariff, and course price are required for a new sale.',
      });
    }

    if (input.coursePriceAmount < 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course price cannot be negative.' });
    }

    const [course, tariff] = await Promise.all([
      prisma.course.findFirst({
        where: { id: input.courseId, tenantId, isActive: true },
        select: { id: true },
      }),
      prisma.tariff.findFirst({
        where: { id: input.tariffId, tenantId, courseId: input.courseId, isActive: true },
        select: { id: true },
      }),
    ]);

    if (!course || !tariff) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course or tariff not found.' });
    }

    const remainingDebtAmount = Math.max(input.coursePriceAmount - input.paymentAmount, 0);
    createdIncome = await prisma.income.create({
      data: {
        tenantId,
        customerId: customer.id,
        managerUserId: input.managerUserId,
        type: 'new_sale',
        courseId: input.courseId,
        tariffId: input.tariffId,
        entryDate,
        deadline: remainingDebtAmount > 0 ? deadline : null,
        coursePriceAmount: input.coursePriceAmount,
        debtAmount: input.coursePriceAmount,
        paymentAmount: input.paymentAmount,
        remainingDebtAmount,
      },
    });
  } else {
    let debtSourceId = input.debtSourceIncomeId;
    if (!debtSourceId) {
      const latestDebt = await prisma.income.findFirst({
        where: {
          tenantId,
          customerId: customer.id,
          type: 'new_sale',
          remainingDebtAmount: { gt: 0 },
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        select: { id: true },
      });

      debtSourceId = latestDebt?.id;
    }

    if (!debtSourceId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Debt source is required for repayment.',
      });
    }

    const debtSource = await prisma.income.findFirst({
      where: {
        id: debtSourceId,
        tenantId,
        type: 'new_sale',
        remainingDebtAmount: { gt: 0 },
      },
      select: {
        id: true,
        customerId: true,
        courseId: true,
        tariffId: true,
        remainingDebtAmount: true,
      },
    });

    if (!debtSource) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected debt source not found.' });
    }

    if (debtSource.customerId !== customer.id) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Selected debt does not belong to the selected customer.',
      });
    }

    if (input.paymentAmount <= 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Repayment amount must be greater than zero.',
      });
    }

    if (input.paymentAmount > debtSource.remainingDebtAmount) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Repayment amount cannot exceed the selected debt.',
      });
    }

    const remainingDebtAmount = Math.max(debtSource.remainingDebtAmount - input.paymentAmount, 0);
    createdIncome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const repayment = await tx.income.create({
        data: {
          tenantId,
          customerId: customer!.id,
          managerUserId: input.managerUserId,
          type: 'repayment',
          relatedDebtIncomeId: debtSource.id,
          courseId: debtSource.courseId,
          tariffId: debtSource.tariffId,
          entryDate,
          deadline,
          debtAmount: debtSource.remainingDebtAmount,
          paymentAmount: input.paymentAmount,
          remainingDebtAmount,
        },
      });

      await tx.income.update({
        where: { id: debtSource.id },
        data: {
          remainingDebtAmount,
        },
      });

      return repayment;
    });
  }

  if (writeAuditLog) {
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'income_create',
        resource: 'income',
        resourceId: createdIncome.id,
        metadata: {
          type: input.type,
          customerNumber: customer.customerNumber,
        },
      },
    });
  }

  return {
    income: createdIncome,
    customerNumber: customer.customerNumber,
  };
}

export const customerIncomeRouter = router({
  formOptions: protectedProcedure.query(async ({ ctx }) => {
    const [managers, customers, courses, outstandingDebts] = await Promise.all([
      prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          roles: {
            hasSome: [...SALES_MANAGER_ROLES],
          },
        },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          username: true,
          roles: true,
        },
      }),
      prisma.customer.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: {
          id: true,
          customerNumber: true,
          name: true,
          telegramUsername: true,
        },
      }),
      prisma.course.findMany({
        where: { tenantId: ctx.tenantId, isActive: true },
        orderBy: { name: 'asc' },
        include: {
          tariffs: {
            where: { isActive: true },
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          remainingDebtAmount: { gt: 0 },
        },
        orderBy: { entryDate: 'desc' },
        take: 300,
        select: {
          id: true,
          remainingDebtAmount: true,
          debtAmount: true,
          customer: {
            select: {
              customerNumber: true,
              name: true,
            },
          },
          course: {
            select: { name: true },
          },
          tariff: {
            select: { name: true },
          },
        },
      }),
    ]);

    return {
      managers: (managers as Array<{
        id: string;
        name: string | null;
        username: string | null;
        roles: string[];
      }>).map((manager) => ({
        id: manager.id,
        label: manager.name || manager.username || manager.id,
        roles: manager.roles,
      })),
      customers,
      courses: (courses as Array<{
        id: string;
        name: string;
        tariffs: Array<{ id: string; name: string }>;
      }>).map((course) => ({
        id: course.id,
        name: course.name,
        tariffs: course.tariffs,
      })),
      outstandingDebts: (outstandingDebts as Array<{
        id: string;
        remainingDebtAmount: number;
        debtAmount: number | null;
        customer: { customerNumber: string; name: string };
        course: { name: string } | null;
        tariff: { name: string } | null;
      }>).map((debt) => ({
        id: debt.id,
        remainingDebtAmount: debt.remainingDebtAmount,
        debtAmount: debt.debtAmount,
        customerNumber: debt.customer.customerNumber,
        customerName: debt.customer.name,
        courseName: debt.course?.name || null,
        tariffName: debt.tariff?.name || null,
      })),
    };
  }),

  searchCustomers: protectedProcedure
    .input(customerSearchSchema)
    .query(async ({ ctx, input }) => {
      const query = input.query?.trim();
      return prisma.customer.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(query
            ? {
                OR: [
                  { customerNumber: { contains: query, mode: 'insensitive' } },
                  { name: { contains: query, mode: 'insensitive' } },
                  { telegramUsername: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          customerNumber: true,
          name: true,
          telegramUsername: true,
        },
      });
    }),

  createCourse: adminProcedure
    .input(createCourseSchema)
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();
      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course name is required.' });
      }

      return prisma.course.upsert({
        where: {
          tenantId_name: {
            tenantId: ctx.tenantId,
            name,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          name,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
    }),

  createTariff: adminProcedure
    .input(createTariffSchema)
    .mutation(async ({ ctx, input }) => {
      const course = await prisma.course.findFirst({
        where: {
          id: input.courseId,
          tenantId: ctx.tenantId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!course) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course not found.' });
      }

      const name = input.name.trim();
      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tariff name is required.' });
      }

      return prisma.tariff.upsert({
        where: {
          tenantId_courseId_name: {
            tenantId: ctx.tenantId,
            courseId: input.courseId,
            name,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          courseId: input.courseId,
          name,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
    }),

  createSubTariff: adminProcedure
    .input(
      z.object({
        tariffId: z.string().uuid(),
        name: z.string().min(1).max(120),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tariff = await prisma.tariff.findFirst({
        where: {
          id: input.tariffId,
          tenantId: ctx.tenantId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!tariff) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tariff not found.' });
      }

      const name = input.name.trim();
      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sub-tariff name is required.' });
      }

      return prisma.subTariff.upsert({
        where: {
          tenantId_tariffId_name: {
            tenantId: ctx.tenantId,
            tariffId: input.tariffId,
            name,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          tariffId: input.tariffId,
          name,
          isActive: true,
        },
        update: {
          isActive: true,
        },
      });
    }),

  courseCatalog: protectedProcedure.query(async ({ ctx }) => {
    return prisma.course.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        tariffs: {
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            isActive: true,
            courseId: true,
            createdAt: true,
            updatedAt: true,
            subTariffs: {
              orderBy: { name: 'asc' },
              select: {
                id: true,
                name: true,
                isActive: true,
                tariffId: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
      },
    });
  }),

  updateCourse: adminProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const course = await prisma.course.findFirst({
        where: {
          id: input.courseId,
          tenantId: ctx.tenantId,
        },
        select: { id: true },
      });

      if (!course) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' });
      }

      const data: { name?: string; isActive?: boolean } = {};
      if (typeof input.name === 'string') {
        data.name = input.name.trim();
      }
      if (typeof input.isActive === 'boolean') {
        data.isActive = input.isActive;
      }

      if (!Object.keys(data).length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update.' });
      }

      return prisma.course.update({
        where: { id: input.courseId },
        data,
      });
    }),

  updateTariff: adminProcedure
    .input(
      z.object({
        tariffId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tariff = await prisma.tariff.findFirst({
        where: {
          id: input.tariffId,
          tenantId: ctx.tenantId,
        },
        select: { id: true },
      });

      if (!tariff) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tariff not found.' });
      }

      const data: { name?: string; isActive?: boolean } = {};
      if (typeof input.name === 'string') {
        data.name = input.name.trim();
      }
      if (typeof input.isActive === 'boolean') {
        data.isActive = input.isActive;
      }

      if (!Object.keys(data).length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update.' });
      }

      return prisma.tariff.update({
        where: { id: input.tariffId },
        data,
      });
    }),

  updateSubTariff: adminProcedure
    .input(
      z.object({
        subTariffId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subTariff = await prisma.subTariff.findFirst({
        where: {
          id: input.subTariffId,
          tenantId: ctx.tenantId,
        },
        select: { id: true },
      });

      if (!subTariff) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sub-tariff not found.' });
      }

      const data: { name?: string; isActive?: boolean } = {};
      if (typeof input.name === 'string') {
        data.name = input.name.trim();
      }
      if (typeof input.isActive === 'boolean') {
        data.isActive = input.isActive;
      }

      if (!Object.keys(data).length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update.' });
      }

      return prisma.subTariff.update({
        where: { id: input.subTariffId },
        data,
      });
    }),

  createIncome: protectedProcedure
    .input(createIncomeSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await createIncomeEntry({
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        input,
      });

      return result.income;
    }),

  bulkImportRows: protectedProcedure
    .input(bulkIncomeImportSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.fallbackManagerUserId) {
        await assertManagerBelongsToTenant(ctx.tenantId, input.fallbackManagerUserId);
      }

      const lookupContext = await buildRowLookupContext(ctx.tenantId);
      const failures: Array<{ rowNumber: number; message: string }> = [];
      let importedCount = 0;

      for (let index = 0; index < input.rows.length; index += 1) {
        const rowNumber = index + 2;
        const rawRow = input.rows[index];
        if (!rawRow) {
          failures.push({ rowNumber, message: `Row ${rowNumber}: empty row payload.` });
          continue;
        }

        try {
          const createInput = parseBulkRowToCreateIncomeInput(
            rawRow,
            rowNumber,
            lookupContext,
            input.fallbackManagerUserId,
          );
          await createIncomeEntry({
            tenantId: ctx.tenantId,
            userId: ctx.user.userId,
            input: createInput,
            writeAuditLog: false,
          });
          importedCount += 1;
        } catch (error) {
          const message =
            error instanceof TRPCError
              ? error.message
              : error instanceof Error
                ? error.message
                : 'Unknown import error';
          failures.push({ rowNumber, message });
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_bulk_import',
          resource: 'income',
          metadata: {
            importedCount,
            failedCount: failures.length,
            totalRows: input.rows.length,
            fallbackManagerUserId: input.fallbackManagerUserId || null,
          },
        },
      });

      return {
        totalRows: input.rows.length,
        importedCount,
        failedCount: failures.length,
        failures,
      };
    }),

  bulkImportFromGoogleSheet: protectedProcedure
    .input(bulkIncomeImportFromGoogleSheetSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.fallbackManagerUserId) {
        await assertManagerBelongsToTenant(ctx.tenantId, input.fallbackManagerUserId);
      }

      const csvUrl = resolveGoogleSheetCsvUrl(input.sheetUrl);
      const response = await fetch(csvUrl, {
        headers: {
          Accept: 'text/csv,text/plain,*/*',
        },
      });

      if (!response.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Failed to load Google Sheet CSV (${response.status}). Make sure the sheet is accessible.`,
        });
      }

      const csvContent = await response.text();
      if (!csvContent.trim()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Google Sheet is empty.' });
      }

      if (csvContent.trimStart().startsWith('<')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Google Sheet did not return CSV. Use a valid sheet URL or make the sheet publicly readable.',
        });
      }

      const rows = parseCsvRows(csvContent);
      if (!rows.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No data rows found in Google Sheet CSV.',
        });
      }

      const lookupContext = await buildRowLookupContext(ctx.tenantId);
      const failures: Array<{ rowNumber: number; message: string }> = [];
      let importedCount = 0;

      for (let index = 0; index < rows.length; index += 1) {
        const rowNumber = index + 2;
        const rawRow = rows[index];
        if (!rawRow) {
          failures.push({ rowNumber, message: `Row ${rowNumber}: empty row payload.` });
          continue;
        }
        try {
          const createInput = parseBulkRowToCreateIncomeInput(
            rawRow,
            rowNumber,
            lookupContext,
            input.fallbackManagerUserId,
          );
          await createIncomeEntry({
            tenantId: ctx.tenantId,
            userId: ctx.user.userId,
            input: createInput,
            writeAuditLog: false,
          });
          importedCount += 1;
        } catch (error) {
          const message =
            error instanceof TRPCError
              ? error.message
              : error instanceof Error
                ? error.message
                : 'Unknown import error';
          failures.push({ rowNumber, message });
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_bulk_import_google_sheet',
          resource: 'income',
          metadata: {
            sheetUrl: input.sheetUrl,
            importedCount,
            failedCount: failures.length,
            totalRows: rows.length,
            fallbackManagerUserId: input.fallbackManagerUserId || null,
          },
        },
      });

      return {
        totalRows: rows.length,
        importedCount,
        failedCount: failures.length,
        failures,
      };
    }),

  listIncomes: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(200).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      return prisma.income.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
        take: input?.limit ?? 30,
        include: {
          customer: {
            select: {
              customerNumber: true,
              name: true,
            },
          },
          manager: {
            select: {
              name: true,
              username: true,
            },
          },
          course: {
            select: { name: true },
          },
          tariff: {
            select: { name: true },
          },
          relatedDebtIncome: {
            select: { id: true },
          },
        },
      });
    }),
});
