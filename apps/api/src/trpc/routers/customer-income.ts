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
import { adminProcedure, managerProcedure, protectedProcedure, router } from '../trpc';
import { decryptIntegrationTokens } from '../../services/security/encryption';
import { telegramService } from '../../services/integrations/telegram';

const SALES_MANAGER_ROLES = ['Admin', 'Manager', 'Agent'] as const;
const COURSE_CATEGORY_VALUES = ['online', 'offline', 'intensive'] as const;
const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'Finance']);
const APPROVER_ROLES_TARIFF_CHANGE = new Set(['Admin', 'Manager', 'Organizator', 'Organizer']);
const APPROVER_ROLES_REFUND = new Set(['Admin', 'Finance']);
const INCOME_LIFECYCLE_ACTIVE = 'active';
const INCOME_LIFECYCLE_PENDING_REFUND = 'pending_refund';
const INCOME_LIFECYCLE_REFUNDED = 'refunded';
const ADJUSTMENT_TYPE_REFUND = 'refund';
const ADJUSTMENT_TYPE_TARIFF_CHANGE = 'tariff_change';
const ADJUSTMENT_STATUS_PENDING = 'pending';
const ADJUSTMENT_STATUS_APPROVED = 'approved';
const ADJUSTMENT_STATUS_REJECTED = 'rejected';
const CUSTOMER_NUMBER_REGEX = /^\d+$/;
const TELEGRAM_USERNAME_REGEX = /^@?[A-Za-z0-9_]+$/;
const REPORT_TIMEZONE_OFFSET_MS = 5 * 60 * 60 * 1000; // GMT+5
const OFFLINE_PAYMENT_GROUP_ENV_KEY = 'OFLINE_GROUP_ID';

function isAdminUser(roles: string[]): boolean {
  return roles.includes('Admin');
}

function isMissingCourseCategoryColumnError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('does not exist')
    && message.includes('category')
    && (message.includes('courses.category') || message.includes('courses'))
  );
}

type CourseWithTariffsSafe = {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  tariffs: Array<{
    id: string;
    name: string;
    isActive: boolean;
    courseId: string;
    createdAt: Date;
    updatedAt: Date;
    subTariffs: Array<{
      id: string;
      name: string;
      isActive: boolean;
      tariffId: string;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }>;
};

async function fetchCoursesWithTariffsSafe(params: { tenantId: string; onlyActive: boolean }): Promise<CourseWithTariffsSafe[]> {
  const where = params.onlyActive
    ? { tenantId: params.tenantId, isActive: true }
    : { tenantId: params.tenantId };

  try {
    const courses = await prisma.course.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        category: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        tariffs: {
          where: params.onlyActive ? { isActive: true } : undefined,
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

    return courses as CourseWithTariffsSafe[];
  } catch (error) {
    if (!isMissingCourseCategoryColumnError(error)) {
      throw error;
    }

    const fallbackCourses = await prisma.course.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        tariffs: {
          where: params.onlyActive ? { isActive: true } : undefined,
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

    return (fallbackCourses as Array<{
      id: string;
      name: string;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
      tariffs: CourseWithTariffsSafe['tariffs'];
    }>).map((course) => ({
      ...course,
      category: 'offline',
    }));
  }
}

async function fetchCourseOptionsSafe(tenantId: string): Promise<Array<{ id: string; name: string; category: string }>> {
  try {
    const courses = await prisma.course.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        category: true,
      },
    });
    return courses as Array<{ id: string; name: string; category: string }>;
  } catch (error) {
    if (!isMissingCourseCategoryColumnError(error)) {
      throw error;
    }

    const fallbackCourses = await prisma.course.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
      },
    });

    return (fallbackCourses as Array<{ id: string; name: string }>).map((course) => ({
      ...course,
      category: 'offline',
    }));
  }
}

function isAgentOnly(roles: string[]): boolean {
  return roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));
}

function isPrivilegedAdjustmentViewer(roles: string[]): boolean {
  return roles.some((role) => PRIVILEGED_ROLES.has(role) || role === 'Organizator' || role === 'Organizer');
}

function canApproveRefundRequest(roles: string[]): boolean {
  return roles.some((role) => APPROVER_ROLES_REFUND.has(role));
}

function canApproveTariffChangeRequest(roles: string[]): boolean {
  return roles.some((role) => APPROVER_ROLES_TARIFF_CHANGE.has(role));
}

function getAdjustmentRoleScope(rolesInput: string[]) {
  const roles = rolesInput.map((role) => String(role));
  const isAdmin = roles.includes('Admin');
  const hasFinance = roles.includes('Finance');
  const hasManagerLike = roles.includes('Manager')
    || roles.includes('Organizator')
    || roles.includes('Organizer');
  const canSeeAll = isPrivilegedAdjustmentViewer(roles);

  const typeGuard: typeof ADJUSTMENT_TYPE_REFUND | typeof ADJUSTMENT_TYPE_TARIFF_CHANGE | null = canSeeAll && !isAdmin
    ? (
        hasFinance && !hasManagerLike
          ? ADJUSTMENT_TYPE_REFUND
          : (!hasFinance && hasManagerLike ? ADJUSTMENT_TYPE_TARIFF_CHANGE : null)
      )
    : null;

  return {
    roles,
    isAdmin,
    hasFinance,
    hasManagerLike,
    canSeeAll,
    typeGuard,
  };
}

function getIncomeLifecycleLabel(status: string): string {
  if (status === INCOME_LIFECYCLE_PENDING_REFUND) {
    return 'pending_refund';
  }
  if (status === INCOME_LIFECYCLE_REFUNDED) {
    return 'refunded';
  }
  return INCOME_LIFECYCLE_ACTIVE;
}

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

function parseTelegramGroupIds(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  return Array.from(
    new Set(
      rawValue
        .split(/[,\n;]+/g)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

function toHashtag(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .normalize('NFKD')
    .replace(/['`]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');

  return normalized ? `#${normalized}` : null;
}

function formatAmountUz(value: number | null | undefined): string {
  return `${Number(value || 0).toLocaleString('ru-RU')} UZS`;
}

function formatDateGmt5(dateValue: Date): string {
  const local = new Date(dateValue.getTime() + REPORT_TIMEZONE_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${day}.${month}.${year}`;
}

function isOfflineOrIntensive(category: string | null | undefined): boolean {
  const normalized = String(category || '').trim().toLowerCase();
  return normalized === 'offline' || normalized === 'intensive';
}

async function sendOfflineOrIntensivePaymentTelegram(params: {
  tenantId: string;
  incomeId: string;
  preferredSubTariffId?: string;
}) {
  const groupIds = parseTelegramGroupIds(process.env[OFFLINE_PAYMENT_GROUP_ENV_KEY]);
  if (!groupIds.length) {
    return;
  }

  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId: params.tenantId,
        type: 'telegram',
      },
    },
    select: {
      status: true,
      tokensEncrypted: true,
    },
  });

  if (!integration || integration.status !== 'active' || !integration.tokensEncrypted) {
    return;
  }

  const tokens = decryptIntegrationTokens<{ botToken?: string }>(integration.tokensEncrypted);
  const botToken = tokens.botToken?.trim();
  if (!botToken) {
    return;
  }

  const createdIncome = await prisma.income.findFirst({
    where: {
      id: params.incomeId,
      tenantId: params.tenantId,
    },
    select: {
      id: true,
      type: true,
      relatedDebtIncomeId: true,
      manager: {
        select: {
          name: true,
          username: true,
        },
      },
    },
  });

  if (!createdIncome) {
    return;
  }

  const saleIncomeId = createdIncome.type === 'new_sale' ? createdIncome.id : createdIncome.relatedDebtIncomeId;
  if (!saleIncomeId) {
    return;
  }

  type SaleIncomePayload = {
    id: string;
    entryDate: Date;
    deadline: Date | null;
    coursePriceAmount: number | null;
    debtAmount: number | null;
    remainingDebtAmount: number;
    tariffId: string | null;
    customer: {
      name: string;
      customerNumber: string;
      telegramUsername: string | null;
    } | null;
    course: {
      id: string;
      name: string;
      category: string | null;
    } | null;
    tariff: {
      name: string;
    } | null;
  };

  let saleIncome: SaleIncomePayload | null = null;

  try {
    const withCategory = await prisma.income.findFirst({
      where: {
        id: saleIncomeId,
        tenantId: params.tenantId,
      },
      select: {
        id: true,
        entryDate: true,
        deadline: true,
        coursePriceAmount: true,
        debtAmount: true,
        remainingDebtAmount: true,
        tariffId: true,
        customer: {
          select: {
            name: true,
            customerNumber: true,
            telegramUsername: true,
          },
        },
        course: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
        tariff: {
          select: {
            name: true,
          },
        },
      },
    });
    saleIncome = withCategory
      ? {
          ...withCategory,
          course: withCategory.course
            ? {
                ...withCategory.course,
                category: withCategory.course.category ?? null,
              }
            : null,
        }
      : null;
  } catch (error) {
    if (!isMissingCourseCategoryColumnError(error)) {
      throw error;
    }

    const fallback = await prisma.income.findFirst({
      where: {
        id: saleIncomeId,
        tenantId: params.tenantId,
      },
      select: {
        id: true,
        entryDate: true,
        deadline: true,
        coursePriceAmount: true,
        debtAmount: true,
        remainingDebtAmount: true,
        tariffId: true,
        customer: {
          select: {
            name: true,
            customerNumber: true,
            telegramUsername: true,
          },
        },
        course: {
          select: {
            id: true,
            name: true,
          },
        },
        tariff: {
          select: {
            name: true,
          },
        },
      },
    });

    if (fallback?.course?.id) {
      const safeCourseOptions = await fetchCourseOptionsSafe(params.tenantId);
      const safeCategory = safeCourseOptions.find((course) => course.id === fallback.course?.id)?.category ?? 'offline';
      saleIncome = fallback
        ? {
            ...fallback,
            course: fallback.course ? { ...fallback.course, category: safeCategory } : null,
          }
        : null;
    } else {
      saleIncome = {
        ...(fallback as any),
        course: null,
      };
    }
  }

  if (!saleIncome?.course || !saleIncome.customer || !isOfflineOrIntensive(saleIncome.course.category)) {
    return;
  }

  const payments = await prisma.income.findMany({
    where: {
      tenantId: params.tenantId,
      OR: [
        { id: saleIncomeId },
        { relatedDebtIncomeId: saleIncomeId },
      ],
    },
    orderBy: [
      { entryDate: 'asc' },
      { createdAt: 'asc' },
    ],
    select: {
      paymentAmount: true,
      entryDate: true,
    },
  });

  let subTariffHashtag: string | null = null;
  if (saleIncome.tariffId) {
    if (params.preferredSubTariffId) {
      const selectedSubTariff = await prisma.subTariff.findFirst({
        where: {
          id: params.preferredSubTariffId,
          tenantId: params.tenantId,
          tariffId: saleIncome.tariffId,
          isActive: true,
        },
        select: { name: true },
      });
      if (selectedSubTariff?.name) {
        subTariffHashtag = toHashtag(selectedSubTariff.name);
      }
    }

    if (!subTariffHashtag) {
      const firstActiveSubTariff = await prisma.subTariff.findFirst({
        where: {
          tenantId: params.tenantId,
          tariffId: saleIncome.tariffId,
          isActive: true,
        },
        orderBy: { name: 'asc' },
        select: { name: true },
      });
      if (firstActiveSubTariff?.name) {
        subTariffHashtag = toHashtag(firstActiveSubTariff.name);
      }
    }
  }

  const courseHashtag = toHashtag(saleIncome.course.name);
  const tariffHashtag = toHashtag(saleIncome.tariff?.name);
  const managerName = createdIncome.manager?.name || createdIncome.manager?.username || null;
  const managerHashtag = toHashtag(managerName);
  const telegramUsername = saleIncome.customer.telegramUsername
    ? (saleIncome.customer.telegramUsername.startsWith('@')
      ? saleIncome.customer.telegramUsername
      : `@${saleIncome.customer.telegramUsername}`)
    : '-';
  const agreementAmount = saleIncome.coursePriceAmount ?? saleIncome.debtAmount ?? 0;

  const paymentLines = payments.length
    ? payments.map((payment, index) => `${index + 1}) ${formatAmountUz(payment.paymentAmount)} - ${formatDateGmt5(payment.entryDate)}`)
    : ['1) -'];

  const messageLines = [
    ...(courseHashtag ? [courseHashtag] : []),
    ...(tariffHashtag ? [tariffHashtag] : []),
    ...(subTariffHashtag ? [subTariffHashtag] : []),
    ...(managerHashtag ? [managerHashtag] : []),
    '',
    `1.Mijoz: ${saleIncome.customer.name}`,
    `2.Tel: ${saleIncome.customer.customerNumber}`,
    `3.Tg: ${telegramUsername}`,
    '',
    `Narxi - ${formatAmountUz(agreementAmount)}`,
    '',
    "To'lov:",
    '',
    ...paymentLines,
    '',
    `Qarz: ${formatAmountUz(saleIncome.remainingDebtAmount)}`,
    `Deadline: ${saleIncome.deadline ? formatDateGmt5(saleIncome.deadline) : '-'}`,
    '',
    '@Moliya_b0limi',
    '@najotnur_oflayn',
  ];

  const message = messageLines.join('\n');

  for (const groupId of groupIds) {
    try {
      await telegramService.sendMessage(botToken, groupId, message, {
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error('[Income][Telegram] Failed to send offline/intensive payment message', {
        tenantId: params.tenantId,
        groupId,
        incomeId: params.incomeId,
        error: String((error as any)?.message || error),
      });
    }
  }
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

function sanitizeCustomerNumber(value: string): string {
  return value.replace(/\s+/g, '').replace(/\D/g, '');
}

function sanitizeTelegramUsername(value: string): string {
  return value.replace(/\s+/g, '').replace(/[^A-Za-z0-9_@]/g, '');
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

  const customerNumber = sanitizeCustomerNumber(normalizeStringValue(getRowValue(row, CUSTOMER_NUMBER_HEADERS)));
  if (!customerNumber) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Row ${rowNumber}: customer number is required.` });
  }
  if (!CUSTOMER_NUMBER_REGEX.test(customerNumber)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Row ${rowNumber}: customer number must contain only digits.` });
  }

  const typeRaw = normalizeStringValue(getRowValue(row, TYPE_HEADERS));
  const type = resolveType(typeRaw);

  const customerName = normalizeStringValue(getRowValue(row, CUSTOMER_NAME_HEADERS)) || undefined;
  const telegramUsernameRaw = sanitizeTelegramUsername(normalizeStringValue(getRowValue(row, TELEGRAM_HEADERS)));
  if (telegramUsernameRaw && !TELEGRAM_USERNAME_REGEX.test(telegramUsernameRaw)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Row ${rowNumber}: telegram username contains invalid characters.`,
    });
  }
  const telegramUsername = telegramUsernameRaw || undefined;
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
  const customerNumber = sanitizeCustomerNumber(input.customerNumber.trim());
  if (!customerNumber || !CUSTOMER_NUMBER_REGEX.test(customerNumber)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "Customer number must contain only digits.",
    });
  }

  const normalizedTelegramUsername = input.telegramUsername
    ? sanitizeTelegramUsername(input.telegramUsername.trim())
    : null;
  if (normalizedTelegramUsername && !TELEGRAM_USERNAME_REGEX.test(normalizedTelegramUsername)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Telegram username may contain only letters, digits, "_" and optional "@".',
    });
  }

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
        telegramUsername: normalizedTelegramUsername || null,
      },
    });
  }

  let createdIncome;
  let selectedSubTariffId: string | undefined;

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

    if (input.subTariffId) {
      const subTariff = await prisma.subTariff.findFirst({
        where: {
          id: input.subTariffId,
          tenantId,
          tariffId: input.tariffId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!subTariff) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sub-tariff not found for selected tariff.' });
      }
      selectedSubTariffId = subTariff.id;
    }

    const remainingDebtAmount = Math.max(input.coursePriceAmount - input.paymentAmount, 0);
    createdIncome = await prisma.income.create({
      data: {
        tenantId,
        customerId: customer.id,
        managerUserId: input.managerUserId,
        type: 'new_sale',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
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
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
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
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
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
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
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

    try {
      await sendOfflineOrIntensivePaymentTelegram({
        tenantId,
        incomeId: createdIncome.id,
        preferredSubTariffId: selectedSubTariffId,
      });
    } catch (error) {
      console.error('[Income][Telegram] Payment notification failed (non-blocking)', {
        tenantId,
        incomeId: createdIncome.id,
        error: String((error as any)?.message || error),
      });
    }
  }

  return {
    income: createdIncome,
    customerNumber: customer.customerNumber,
  };
}

export const customerIncomeRouter = router({
  formOptions: protectedProcedure.query(async ({ ctx }) => {
    const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : null;

    const [managers, customers, courses, outstandingDebts] = await Promise.all([
      prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          roles: {
            hasSome: [...SALES_MANAGER_ROLES],
          },
          ...(scopedManagerUserId
            ? {
                id: scopedManagerUserId,
              }
            : {}),
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
        where: {
          tenantId: ctx.tenantId,
          ...(scopedManagerUserId
              ? {
                  incomes: {
                    some: {
                      managerUserId: scopedManagerUserId,
                      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                    },
                  },
                }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: {
          id: true,
          customerNumber: true,
          name: true,
          telegramUsername: true,
        },
      }),
      fetchCoursesWithTariffsSafe({
        tenantId: ctx.tenantId,
        onlyActive: true,
      }),
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          remainingDebtAmount: { gt: 0 },
          ...(scopedManagerUserId
            ? {
                managerUserId: scopedManagerUserId,
              }
            : {}),
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
        category: string;
        tariffs: Array<{
          id: string;
          name: string;
          subTariffs: Array<{ id: string; name: string }>;
        }>;
      }>).map((course) => ({
        id: course.id,
        name: course.name,
        category: course.category,
        tariffs: course.tariffs.map((tariff) => ({
          id: tariff.id,
          name: tariff.name,
          subTariffs: Array.isArray(tariff.subTariffs)
            ? tariff.subTariffs.map((subTariff) => ({ id: subTariff.id, name: subTariff.name }))
            : [],
        })),
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
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : null;
      const query = input.query?.trim();
      return prisma.customer.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(scopedManagerUserId
              ? {
                  incomes: {
                    some: {
                      managerUserId: scopedManagerUserId,
                      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                    },
                  },
                }
            : {}),
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

  createCourse: managerProcedure
    .input(createCourseSchema)
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();
      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course name is required.' });
      }

      try {
        return await prisma.course.upsert({
          where: {
            tenantId_name: {
              tenantId: ctx.tenantId,
              name,
            },
          },
          create: {
            tenantId: ctx.tenantId,
            name,
            category: input.category,
            isActive: true,
          },
          update: {
            category: input.category,
            isActive: true,
          },
        });
      } catch (error) {
        if (!isMissingCourseCategoryColumnError(error)) {
          throw error;
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
      }
    }),

  createTariff: managerProcedure
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

  createSubTariff: managerProcedure
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
    return fetchCoursesWithTariffsSafe({
      tenantId: ctx.tenantId,
      onlyActive: false,
    });
  }),

  updateCourse: managerProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        category: z.enum(COURSE_CATEGORY_VALUES).optional(),
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

      const data: { name?: string; category?: string; isActive?: boolean } = {};
      if (typeof input.name === 'string') {
        data.name = input.name.trim();
      }
      if (typeof input.category === 'string') {
        data.category = input.category;
      }
      if (typeof input.isActive === 'boolean') {
        data.isActive = input.isActive;
      }

      if (!Object.keys(data).length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No fields to update.' });
      }

      try {
        return await prisma.course.update({
          where: { id: input.courseId },
          data,
        });
      } catch (error) {
        if (!isMissingCourseCategoryColumnError(error) || typeof input.category !== 'string') {
          throw error;
        }

        const fallbackData: { name?: string; isActive?: boolean } = {};
        if (typeof input.name === 'string') {
          fallbackData.name = input.name.trim();
        }
        if (typeof input.isActive === 'boolean') {
          fallbackData.isActive = input.isActive;
        }

        if (!Object.keys(fallbackData).length) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Course category field is unavailable until database migrations are applied.',
          });
        }

        return prisma.course.update({
          where: { id: input.courseId },
          data: fallbackData,
        });
      }
    }),

  updateTariff: managerProcedure
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

  updateSubTariff: managerProcedure
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
      if (isAgentOnly(ctx.user.roles) && input.managerUserId !== ctx.user.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Agents can create income records only for themselves.',
        });
      }

      const result = await createIncomeEntry({
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        input,
      });

      return result.income;
    }),

  deleteIncome: adminProcedure
    .input(
      z.object({
        incomeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const income = await prisma.income.findFirst({
        where: {
          id: input.incomeId,
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
          type: true,
          paymentAmount: true,
          relatedDebtIncomeId: true,
        },
      });

      if (!income) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Income entry not found.' });
      }

      const linkedAdjustmentCount = await prisma.incomeAdjustmentRequest.count({
        where: {
          tenantId: ctx.tenantId,
          incomeId: income.id,
        },
      });

      if (linkedAdjustmentCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This income entry has linked adjustment requests. Remove or resolve them first.',
        });
      }

      if (income.type === 'new_sale') {
        const linkedRepayments = await prisma.income.count({
          where: {
            tenantId: ctx.tenantId,
            type: 'repayment',
            relatedDebtIncomeId: income.id,
          },
        });

        if (linkedRepayments > 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This sale has repayments. Delete repayments first.',
          });
        }
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (income.type === 'repayment' && income.relatedDebtIncomeId) {
          const sourceIncome = await tx.income.findFirst({
            where: {
              id: income.relatedDebtIncomeId,
              tenantId: ctx.tenantId,
            },
            select: {
              id: true,
              debtAmount: true,
              remainingDebtAmount: true,
            },
          });

          if (sourceIncome) {
            const restoredDebtRaw = (sourceIncome.remainingDebtAmount || 0) + (income.paymentAmount || 0);
            const restoredDebt = sourceIncome.debtAmount !== null
              ? Math.min(restoredDebtRaw, sourceIncome.debtAmount)
              : restoredDebtRaw;

            await tx.income.update({
              where: { id: sourceIncome.id },
              data: {
                remainingDebtAmount: Math.max(restoredDebt, 0),
              },
            });
          }
        }

        await tx.income.delete({
          where: { id: income.id },
        });
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_delete',
          resource: 'income',
          resourceId: income.id,
          metadata: {
            type: income.type,
          },
        },
      });

      return { success: true };
    }),

  bulkImportRows: protectedProcedure
    .input(bulkIncomeImportSchema)
    .mutation(async ({ ctx, input }) => {
      if (!isAdminUser(ctx.user.roles)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Bulk upload is available for Admin only.',
        });
      }

      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : null;
      if (input.fallbackManagerUserId) {
        if (scopedManagerUserId && input.fallbackManagerUserId !== scopedManagerUserId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Agents can import income only for themselves.',
          });
        }
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
            scopedManagerUserId || input.fallbackManagerUserId,
          );

          if (scopedManagerUserId) {
            createInput.managerUserId = scopedManagerUserId;
          }

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
            fallbackManagerUserId: scopedManagerUserId || input.fallbackManagerUserId || null,
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
      if (!isAdminUser(ctx.user.roles)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Bulk upload is available for Admin only.',
        });
      }

      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : null;
      if (input.fallbackManagerUserId) {
        if (scopedManagerUserId && input.fallbackManagerUserId !== scopedManagerUserId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Agents can import income only for themselves.',
          });
        }
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
            scopedManagerUserId || input.fallbackManagerUserId,
          );

          if (scopedManagerUserId) {
            createInput.managerUserId = scopedManagerUserId;
          }

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
            fallbackManagerUserId: scopedManagerUserId || input.fallbackManagerUserId || null,
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
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : null;
      const incomes = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(scopedManagerUserId
            ? {
                managerUserId: scopedManagerUserId,
              }
            : {}),
        },
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

      return incomes.map((income) => ({
        ...income,
        lifecycleStatus: getIncomeLifecycleLabel(income.lifecycleStatus),
      }));
    }),

  listAdjustableIncomes: protectedProcedure
    .input(z.object({ customerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : null;

      const customer = await prisma.customer.findFirst({
        where: {
          id: input.customerId,
          tenantId: ctx.tenantId,
          ...(scopedManagerUserId
            ? {
                incomes: {
                  some: {
                    managerUserId: scopedManagerUserId,
                  },
                },
              }
            : {}),
        },
        select: {
          id: true,
          customerNumber: true,
          name: true,
          telegramUsername: true,
        },
      });

      if (!customer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found.' });
      }

      const incomes = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          customerId: customer.id,
          paymentAmount: { gt: 0 },
          ...(scopedManagerUserId
            ? {
                managerUserId: scopedManagerUserId,
              }
            : {}),
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        take: 80,
        select: {
          id: true,
          type: true,
          lifecycleStatus: true,
          paymentAmount: true,
          coursePriceAmount: true,
          debtAmount: true,
          remainingDebtAmount: true,
          entryDate: true,
          course: { select: { id: true, name: true } },
          tariff: { select: { id: true, name: true } },
          manager: { select: { id: true, name: true, username: true } },
        },
      });

      return {
        customer,
        incomes: incomes.map((income) => ({
          ...income,
          lifecycleStatus: getIncomeLifecycleLabel(income.lifecycleStatus),
          managerLabel: income.manager.name || income.manager.username || income.manager.id,
          canCreateRequest: income.lifecycleStatus === INCOME_LIFECYCLE_ACTIVE,
          canChangeTariff: income.lifecycleStatus === INCOME_LIFECYCLE_ACTIVE && income.type === 'new_sale',
        })),
      };
    }),

  listAdjustmentRequests: protectedProcedure
    .input(
      z
        .object({
          status: z.enum([ADJUSTMENT_STATUS_PENDING, ADJUSTMENT_STATUS_APPROVED, ADJUSTMENT_STATUS_REJECTED]).optional(),
          type: z.enum([ADJUSTMENT_TYPE_REFUND, ADJUSTMENT_TYPE_TARIFF_CHANGE]).optional(),
          limit: z.number().int().positive().max(200).default(80),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const scope = getAdjustmentRoleScope(ctx.user.roles);
      const roleTypeGuard = scope.typeGuard;

      if (input?.type && roleTypeGuard && input.type !== roleTypeGuard) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this request type.',
        });
      }

      const where: Prisma.IncomeAdjustmentRequestWhereInput = {
        tenantId: ctx.tenantId,
        ...(input?.status ? { status: input.status } : {}),
        ...(input?.type
          ? { type: input.type }
          : (roleTypeGuard ? { type: roleTypeGuard } : {})),
        ...(!scope.canSeeAll
          ? {
              OR: [
                { requestedByUserId: ctx.user.userId },
                { income: { managerUserId: ctx.user.userId } },
              ],
            }
          : {}),
      };

      const requests = await prisma.incomeAdjustmentRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: input?.limit ?? 80,
        select: {
          id: true,
          type: true,
          status: true,
          reason: true,
          reviewNote: true,
          requestedAmount: true,
          newAgreementAmount: true,
          createdAt: true,
          reviewedAt: true,
          income: {
            select: {
              id: true,
              type: true,
              lifecycleStatus: true,
              paymentAmount: true,
              coursePriceAmount: true,
              remainingDebtAmount: true,
              course: { select: { name: true } },
              tariff: { select: { name: true } },
              customer: { select: { customerNumber: true, name: true } },
              manager: { select: { name: true, username: true } },
            },
          },
          requestedBy: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
          reviewedBy: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
          newCourse: { select: { id: true, name: true } },
          newTariff: { select: { id: true, name: true } },
        },
      });

      return requests.map((request) => ({
        ...request,
        income: {
          ...request.income,
          lifecycleStatus: getIncomeLifecycleLabel(request.income.lifecycleStatus),
          managerLabel: request.income.manager.name || request.income.manager.username || '-',
        },
        requestedByLabel: request.requestedBy.name || request.requestedBy.username || request.requestedBy.id,
        reviewedByLabel: request.reviewedBy
          ? (request.reviewedBy.name || request.reviewedBy.username || request.reviewedBy.id)
          : null,
      }));
    }),

  adjustmentBadgeCount: protectedProcedure.query(async ({ ctx }) => {
    const scope = getAdjustmentRoleScope(ctx.user.roles);
    const pendingWhereBase: Prisma.IncomeAdjustmentRequestWhereInput = {
      tenantId: ctx.tenantId,
      status: ADJUSTMENT_STATUS_PENDING,
      ...(scope.typeGuard ? { type: scope.typeGuard } : {}),
      ...(!scope.canSeeAll
        ? {
            OR: [
              { requestedByUserId: ctx.user.userId },
              { income: { managerUserId: ctx.user.userId } },
            ],
          }
        : {}),
    };

    const [pendingTotal, pendingRefund, pendingTariffChange] = await Promise.all([
      prisma.incomeAdjustmentRequest.count({
        where: pendingWhereBase,
      }),
      prisma.incomeAdjustmentRequest.count({
        where: {
          ...pendingWhereBase,
          type: ADJUSTMENT_TYPE_REFUND,
        },
      }),
      prisma.incomeAdjustmentRequest.count({
        where: {
          ...pendingWhereBase,
          type: ADJUSTMENT_TYPE_TARIFF_CHANGE,
        },
      }),
    ]);

    return {
      pendingTotal,
      pendingRefund,
      pendingTariffChange,
      scopedToApproverQueue: scope.canSeeAll,
    };
  }),

  createAdjustmentRequest: protectedProcedure
    .input(
      z.object({
        type: z.enum([ADJUSTMENT_TYPE_REFUND, ADJUSTMENT_TYPE_TARIFF_CHANGE]),
        incomeId: z.string().uuid(),
        reason: z.string().max(500).optional(),
        newCourseId: z.string().uuid().optional(),
        newTariffId: z.string().uuid().optional(),
        newAgreementAmount: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : null;
      const sourceIncome = await prisma.income.findFirst({
        where: {
          id: input.incomeId,
          tenantId: ctx.tenantId,
          paymentAmount: { gt: 0 },
          ...(scopedManagerUserId
            ? {
                managerUserId: scopedManagerUserId,
              }
            : {}),
        },
        select: {
          id: true,
          type: true,
          tenantId: true,
          customerId: true,
          courseId: true,
          tariffId: true,
          coursePriceAmount: true,
          paymentAmount: true,
          lifecycleStatus: true,
        },
      });

      if (!sourceIncome) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Selected income was not found.' });
      }

      if (sourceIncome.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Only active income entries can be adjusted.',
        });
      }

      const existingPending = await prisma.incomeAdjustmentRequest.findFirst({
        where: {
          tenantId: ctx.tenantId,
          incomeId: sourceIncome.id,
          status: ADJUSTMENT_STATUS_PENDING,
        },
        select: { id: true },
      });

      if (existingPending) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'A pending request already exists for this income entry.',
        });
      }

      if (input.type === ADJUSTMENT_TYPE_TARIFF_CHANGE) {
        if (sourceIncome.type !== 'new_sale') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Tariff change is available only for new sale entries.',
          });
        }

        if (!input.newCourseId || !input.newTariffId || !input.newAgreementAmount) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Course, tariff, and agreement amount are required for tariff change.',
          });
        }

        const [course, tariff] = await Promise.all([
          prisma.course.findFirst({
            where: {
              id: input.newCourseId,
              tenantId: ctx.tenantId,
              isActive: true,
            },
            select: { id: true },
          }),
          prisma.tariff.findFirst({
            where: {
              id: input.newTariffId,
              tenantId: ctx.tenantId,
              courseId: input.newCourseId,
              isActive: true,
            },
            select: { id: true },
          }),
        ]);

        if (!course || !tariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected course/tariff was not found.' });
        }
      }

      const createdRequest = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const request = await tx.incomeAdjustmentRequest.create({
          data: {
            tenantId: ctx.tenantId,
            type: input.type,
            status: ADJUSTMENT_STATUS_PENDING,
            incomeId: sourceIncome.id,
            customerId: sourceIncome.customerId,
            requestedByUserId: ctx.user.userId,
            reason: input.reason?.trim() || null,
            requestedAmount: input.type === ADJUSTMENT_TYPE_REFUND ? sourceIncome.paymentAmount : null,
            newCourseId: input.type === ADJUSTMENT_TYPE_TARIFF_CHANGE ? input.newCourseId || null : null,
            newTariffId: input.type === ADJUSTMENT_TYPE_TARIFF_CHANGE ? input.newTariffId || null : null,
            newAgreementAmount: input.type === ADJUSTMENT_TYPE_TARIFF_CHANGE ? input.newAgreementAmount || null : null,
          },
          select: {
            id: true,
            type: true,
            status: true,
          },
        });

        if (input.type === ADJUSTMENT_TYPE_REFUND) {
          await tx.income.update({
            where: { id: sourceIncome.id },
            data: {
              lifecycleStatus: INCOME_LIFECYCLE_PENDING_REFUND,
            },
          });
        }

        return request;
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_adjustment_request_create',
          resource: 'income_adjustment_request',
          resourceId: createdRequest.id,
          metadata: {
            incomeId: sourceIncome.id,
            type: input.type,
          },
        },
      });

      return createdRequest;
    }),

  approveAdjustmentRequest: protectedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        reviewNote: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const request = await prisma.incomeAdjustmentRequest.findFirst({
        where: {
          id: input.requestId,
          tenantId: ctx.tenantId,
        },
        include: {
          income: {
            select: {
              id: true,
              type: true,
              managerUserId: true,
              lifecycleStatus: true,
              paymentAmount: true,
              coursePriceAmount: true,
            },
          },
        },
      });

      if (!request) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found.' });
      }

      if (request.status !== ADJUSTMENT_STATUS_PENDING) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Only pending requests can be approved.' });
      }

      if (request.type === ADJUSTMENT_TYPE_REFUND && !canApproveRefundRequest(ctx.user.roles)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin or Finance role is required to approve refunds.' });
      }

      if (request.type === ADJUSTMENT_TYPE_TARIFF_CHANGE && !canApproveTariffChangeRequest(ctx.user.roles)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Admin, Manager, or Organizator role is required to approve tariff changes.',
        });
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (request.type === ADJUSTMENT_TYPE_REFUND) {
          await tx.income.update({
            where: { id: request.incomeId },
            data: {
              lifecycleStatus: INCOME_LIFECYCLE_REFUNDED,
            },
          });
        } else {
          if (!request.newCourseId || !request.newTariffId || !request.newAgreementAmount) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'Tariff-change request does not have target course/tariff/agreement.',
            });
          }

          const [course, tariff, sourceIncome, repaymentAggregate] = await Promise.all([
            tx.course.findFirst({
              where: {
                id: request.newCourseId,
                tenantId: ctx.tenantId,
                isActive: true,
              },
              select: { id: true },
            }),
            tx.tariff.findFirst({
              where: {
                id: request.newTariffId,
                tenantId: ctx.tenantId,
                courseId: request.newCourseId,
                isActive: true,
              },
              select: { id: true },
            }),
            tx.income.findFirst({
              where: {
                id: request.incomeId,
                tenantId: ctx.tenantId,
                type: 'new_sale',
              },
              select: {
                id: true,
                paymentAmount: true,
                lifecycleStatus: true,
              },
            }),
            tx.income.aggregate({
              where: {
                tenantId: ctx.tenantId,
                type: 'repayment',
                relatedDebtIncomeId: request.incomeId,
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              },
              _sum: {
                paymentAmount: true,
              },
            }),
          ]);

          if (!course || !tariff || !sourceIncome) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'Cannot apply tariff change: source/new course/new tariff is missing.',
            });
          }
          if (sourceIncome.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'Tariff change can be applied only to active income entries.',
            });
          }

          const activeSourcePayment = sourceIncome.lifecycleStatus === INCOME_LIFECYCLE_ACTIVE
            ? (sourceIncome.paymentAmount ?? 0)
            : 0;
          const activeRepayments = repaymentAggregate._sum.paymentAmount ?? 0;
          const totalPaid = activeSourcePayment + activeRepayments;
          const remainingDebtAmount = Math.max(request.newAgreementAmount - totalPaid, 0);

          await tx.income.update({
            where: { id: request.incomeId },
            data: {
              courseId: request.newCourseId,
              tariffId: request.newTariffId,
              coursePriceAmount: request.newAgreementAmount,
              debtAmount: request.newAgreementAmount,
              remainingDebtAmount,
            },
          });

          await tx.income.updateMany({
            where: {
              tenantId: ctx.tenantId,
              type: 'repayment',
              relatedDebtIncomeId: request.incomeId,
            },
            data: {
              courseId: request.newCourseId,
              tariffId: request.newTariffId,
            },
          });
        }

        await tx.incomeAdjustmentRequest.update({
          where: { id: request.id },
          data: {
            status: ADJUSTMENT_STATUS_APPROVED,
            reviewedByUserId: ctx.user.userId,
            reviewNote: input.reviewNote?.trim() || null,
            reviewedAt: new Date(),
          },
        });
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_adjustment_request_approve',
          resource: 'income_adjustment_request',
          resourceId: request.id,
          metadata: {
            type: request.type,
            incomeId: request.incomeId,
          },
        },
      });

      return { success: true };
    }),

  rejectAdjustmentRequest: protectedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        reviewNote: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const request = await prisma.incomeAdjustmentRequest.findFirst({
        where: {
          id: input.requestId,
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
          type: true,
          status: true,
          incomeId: true,
        },
      });

      if (!request) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found.' });
      }

      if (request.status !== ADJUSTMENT_STATUS_PENDING) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Only pending requests can be rejected.' });
      }

      if (request.type === ADJUSTMENT_TYPE_REFUND && !canApproveRefundRequest(ctx.user.roles)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin or Finance role is required to reject refunds.' });
      }

      if (request.type === ADJUSTMENT_TYPE_TARIFF_CHANGE && !canApproveTariffChangeRequest(ctx.user.roles)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Admin, Manager, or Organizator role is required to reject tariff changes.',
        });
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (request.type === ADJUSTMENT_TYPE_REFUND) {
          await tx.income.update({
            where: { id: request.incomeId },
            data: {
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            },
          });
        }

        await tx.incomeAdjustmentRequest.update({
          where: { id: request.id },
          data: {
            status: ADJUSTMENT_STATUS_REJECTED,
            reviewedByUserId: ctx.user.userId,
            reviewNote: input.reviewNote?.trim() || null,
            reviewedAt: new Date(),
          },
        });
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_adjustment_request_reject',
          resource: 'income_adjustment_request',
          resourceId: request.id,
          metadata: {
            type: request.type,
            incomeId: request.incomeId,
          },
        },
      });

      return { success: true };
    }),

  listCustomers: protectedProcedure
    .input(
      z
        .object({
          query: z.string().optional(),
          courseId: z.string().uuid().optional(),
          debtFilter: z.enum(['all', 'with_debt', 'without_debt']).default('all'),
          limit: z.number().int().positive().max(1000).default(300),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : null;
      const trimmedQuery = input?.query?.trim();
      const andConditions: Prisma.CustomerWhereInput[] = [];

      if (scopedManagerUserId) {
        andConditions.push({
          incomes: {
            some: {
              managerUserId: scopedManagerUserId,
            },
          },
        });
      }

      if (trimmedQuery) {
        andConditions.push({
          OR: [
            { customerNumber: { contains: trimmedQuery, mode: 'insensitive' } },
            { name: { contains: trimmedQuery, mode: 'insensitive' } },
            { telegramUsername: { contains: trimmedQuery, mode: 'insensitive' } },
          ],
        });
      }

      if (input?.courseId) {
        andConditions.push({
          incomes: {
            some: {
              ...(scopedManagerUserId
                ? {
                    managerUserId: scopedManagerUserId,
                  }
                : {}),
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              courseId: input.courseId,
            },
          },
        });
      }

      if (input?.debtFilter === 'with_debt') {
        andConditions.push({
          incomes: {
            some: {
              ...(scopedManagerUserId
                ? {
                    managerUserId: scopedManagerUserId,
                  }
                : {}),
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              remainingDebtAmount: { gt: 0 },
            },
          },
        });
      } else if (input?.debtFilter === 'without_debt') {
        andConditions.push({
          NOT: {
            incomes: {
              some: {
                ...(scopedManagerUserId
                  ? {
                      managerUserId: scopedManagerUserId,
                    }
                  : {}),
                type: 'new_sale',
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                remainingDebtAmount: { gt: 0 },
              },
            },
          },
        });
      }

      const where: Prisma.CustomerWhereInput = {
        tenantId: ctx.tenantId,
        ...(andConditions.length ? { AND: andConditions } : {}),
      };

      const [customers, courseOptions] = await Promise.all([
        prisma.customer.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: input?.limit ?? 300,
          select: {
            id: true,
            customerNumber: true,
            name: true,
            telegramUsername: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        fetchCourseOptionsSafe(ctx.tenantId),
      ]);

      if (!customers.length) {
        return {
          customers: [],
          courseOptions,
        };
      }

      const customerIds = customers.map((customer) => customer.id);
      const relatedIncomes = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          customerId: { in: customerIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          ...(scopedManagerUserId
            ? {
                managerUserId: scopedManagerUserId,
              }
            : {}),
        },
        orderBy: { entryDate: 'desc' },
        select: {
          customerId: true,
          type: true,
          paymentAmount: true,
          remainingDebtAmount: true,
          entryDate: true,
          course: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      const aggregatesByCustomer = new Map<
        string,
        {
          totalDebtAmount: number;
          totalPaidAmount: number;
          hasDebt: boolean;
          lastActivityAt: Date | null;
          courses: Set<string>;
        }
      >();

      for (const income of relatedIncomes as Array<{
        customerId: string;
        type: string;
        paymentAmount: number;
        remainingDebtAmount: number;
        entryDate: Date;
        course: { id: string; name: string } | null;
      }>) {
        const current = aggregatesByCustomer.get(income.customerId) || {
          totalDebtAmount: 0,
          totalPaidAmount: 0,
          hasDebt: false,
          lastActivityAt: null as Date | null,
          courses: new Set<string>(),
        };

        current.totalPaidAmount += income.paymentAmount || 0;
        if (income.type === 'new_sale' && income.remainingDebtAmount > 0) {
          current.totalDebtAmount += income.remainingDebtAmount;
          current.hasDebt = true;
        }

        if (!current.lastActivityAt || income.entryDate > current.lastActivityAt) {
          current.lastActivityAt = income.entryDate;
        }

        if (income.course?.name) {
          current.courses.add(income.course.name);
        }

        aggregatesByCustomer.set(income.customerId, current);
      }

      return {
        customers: customers.map((customer) => {
          const aggregate = aggregatesByCustomer.get(customer.id);
          return {
            ...customer,
            totalDebtAmount: aggregate?.totalDebtAmount ?? 0,
            totalPaidAmount: aggregate?.totalPaidAmount ?? 0,
            hasDebt: aggregate?.hasDebt ?? false,
            lastActivityAt: aggregate?.lastActivityAt ?? null,
            courses: aggregate ? Array.from(aggregate.courses) : [],
          };
        }),
        courseOptions,
      };
    }),
});
