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
import {
  buildHistoricalInitialProgress,
  prepareHistoricalImportPreview,
  type HistoricalCatalogItemPreview,
  type HistoricalImportFailure,
  type HistoricalPreparedCustomerRow,
  type HistoricalPreparedIncomeRow,
  type HistoricalRawRow,
} from '../../services/historical-import';

const SALES_MANAGER_ROLES = ['Admin', 'Manager', 'Agent'] as const;
const COURSE_CATEGORY_VALUES = ['online', 'offline', 'intensive', 'additional_service'] as const;
const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'Finance']);
const APPROVER_ROLES_TARIFF_CHANGE = new Set(['Admin', 'Manager', 'Organizator', 'Organizer', 'Tashkiliy']);
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
const OFFLINE_PAYMENT_GROUP_ENV_KEY_LEGACY = 'OFFLINE_GROUP_ID';
const OFFLINE_PAYMENT_GROUP_ENV_KEYS = [
  OFFLINE_PAYMENT_GROUP_ENV_KEY,
  OFFLINE_PAYMENT_GROUP_ENV_KEY_LEGACY,
  'OFLINE_GROUP_IDS',
  'OFFLINE_GROUP_IDS',
] as const;
const ONLINE_PAYMENT_GROUP_ENV_KEYS = [
  'ONLINE_GROUP_ID',
  'ONLINE_GROUP_IDS',
] as const;
const REFUND_PAYMENT_GROUP_ENV_KEYS = [
  'PAYMENT_RETURN_GROUP_ID',
  'PAYMENT_RETURN_GROUP_IDS',
  'REFUND_GROUP_ID',
  'REFUND_GROUP_IDS',
  'RETURN_GROUP_ID',
  'RETURN_GROUP_IDS',
] as const;

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

function isMissingCourseHiddenFromIncomeFormColumnError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('does not exist')
    && message.includes('ishiddenfromincomeform')
    && (message.includes('courses.ishiddenfromincomeform') || message.includes('courses'))
  );
}

function isMissingHistoricalImportSchemaError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    (message.includes('historical_import_sessions') && message.includes('does not exist'))
    || (message.includes('legacyimportkey') && message.includes('does not exist'))
    || (message.includes('legacyprofileimportkey') && message.includes('does not exist'))
    || (message.includes('historicalimportsessionid') && message.includes('does not exist'))
  );
}

function throwHistoricalImportMigrationError(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: "Tarixiy import ishlashi uchun yangi migratsiyalar hali qo'llanmagan. Avval database migration ni ishga tushiring.",
  });
}

function isCourseCategoryConstraintOutdatedError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('courses_category_check')
    || (
      message.includes('violates check constraint')
      && message.includes('category')
      && message.includes('courses')
    )
  );
}

function throwCourseCategoryMigrationError(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: "Kurs kategoriya cheklovi eskirgan. `additional_service` uchun yangi database migration ni ishga tushiring va keyin importni qayta boshlang.",
  });
}

type CourseWithTariffsSafe = {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
  isHiddenFromIncomeForm: boolean;
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

async function fetchCoursesWithTariffsSafe(params: {
  tenantId: string;
  onlyActive: boolean;
  excludeHiddenFromIncomeForm?: boolean;
}): Promise<CourseWithTariffsSafe[]> {
  const baseWhere: Prisma.CourseWhereInput = params.onlyActive
    ? { tenantId: params.tenantId, isActive: true }
    : { tenantId: params.tenantId };
  const where: Prisma.CourseWhereInput = {
    ...baseWhere,
    ...(params.excludeHiddenFromIncomeForm ? { isHiddenFromIncomeForm: false } : {}),
  };

  try {
    const courses = await prisma.course.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        category: true,
        isActive: true,
        isHiddenFromIncomeForm: true,
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
    const missingCategoryColumn = isMissingCourseCategoryColumnError(error);
    const missingHiddenColumn = isMissingCourseHiddenFromIncomeFormColumnError(error);
    if (!missingCategoryColumn && !missingHiddenColumn) {
      throw error;
    }

    const fallbackWhere: Prisma.CourseWhereInput = {
      ...baseWhere,
      ...(params.excludeHiddenFromIncomeForm && !missingHiddenColumn
        ? { isHiddenFromIncomeForm: false }
        : {}),
    };

    const fallbackCourses = await prisma.course.findMany({
      where: fallbackWhere,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        ...(missingCategoryColumn ? {} : { category: true }),
        isActive: true,
        ...(missingHiddenColumn ? {} : { isHiddenFromIncomeForm: true }),
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
      category?: string;
      isActive: boolean;
      isHiddenFromIncomeForm?: boolean;
      createdAt: Date;
      updatedAt: Date;
      tariffs: CourseWithTariffsSafe['tariffs'];
    }>).map((course) => ({
      ...course,
      category: course.category ?? 'offline',
      isHiddenFromIncomeForm: course.isHiddenFromIncomeForm ?? false,
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
  return roles.some((role) => PRIVILEGED_ROLES.has(role) || role === 'Organizator' || role === 'Organizer' || role === 'Tashkiliy');
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
    || roles.includes('Organizer')
    || roles.includes('Tashkiliy');
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

function parseGmt5DateBoundary(input: string, endOfDay: boolean): Date {
  const value = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid date: ${input}` });
  }

  const timestamp = `${value}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+05:00`;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid date: ${input}` });
  }

  return parsed;
}

function parseTelegramGroupIds(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  const stripWrappingQuotes = (value: string): string => value.replace(/^['"`]+|['"`]+$/g, '').trim();

  return Array.from(
    new Set(
      rawValue
        .split(/[,\n;]+/g)
        .map((value) => stripWrappingQuotes(value))
        .map((value) => value.replace(/\s+/g, ''))
        .filter(Boolean),
    ),
  );
}

function normalizeTelegramSecret(rawValue: string | undefined): string | null {
  if (!rawValue) {
    return null;
  }
  const normalized = rawValue.replace(/^['"`]+|['"`]+$/g, '').trim();
  return normalized || null;
}

function parseTelegramGroupIdsFromEnvKeys(keys: readonly string[]): string[] {
  return Array.from(
    new Set(keys.flatMap((key) => parseTelegramGroupIds(process.env[key]))),
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
  return normalized === 'offline' || normalized === 'intensive' || normalized === 'additional_service';
}

function isOnlineCategory(category: string | null | undefined): boolean {
  return String(category || '').trim().toLowerCase() === 'online';
}

function resolvePaymentGroupEnvKeysByCategory(category: string | null | undefined): readonly string[] | null {
  if (isOfflineOrIntensive(category)) {
    return OFFLINE_PAYMENT_GROUP_ENV_KEYS;
  }
  if (isOnlineCategory(category)) {
    return ONLINE_PAYMENT_GROUP_ENV_KEYS;
  }
  return null;
}

async function resolveTelegramBotTokenForTenant(tenantId: string): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'telegram',
      },
    },
    select: {
      tokensEncrypted: true,
    },
  });

  let botToken = normalizeTelegramSecret(process.env.TELEGRAM_BOT_TOKEN || undefined);
  if (integration?.tokensEncrypted) {
    try {
      const tokens = decryptIntegrationTokens<{ botToken?: string; token?: string }>(integration.tokensEncrypted);
      const integrationBotToken = normalizeTelegramSecret(tokens.botToken || tokens.token);
      botToken = integrationBotToken || botToken;
    } catch (error) {
      console.warn('[Income][Telegram] Failed to decrypt integration bot token, using TELEGRAM_BOT_TOKEN fallback if provided.', {
        tenantId,
        error: String((error as any)?.message || error),
      });
    }
  }

  return botToken;
}

async function sendOfflineOrIntensivePaymentTelegram(params: {
  tenantId: string;
  incomeId: string;
  preferredSubTariffId?: string;
}) {
  type TelegramPaymentDispatchResult = {
    attempted: boolean;
    delivered: boolean;
    sentCount: number;
    failedCount: number;
    reason?: 'groups_missing' | 'bot_token_missing' | 'income_not_found' | 'course_not_eligible' | 'send_failed';
    errors?: string[];
  };

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId);
  if (!botToken) {
    console.warn('[Income][Telegram] Bot token is missing. Connect Telegram integration or set TELEGRAM_BOT_TOKEN.');
    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'bot_token_missing',
    } satisfies TelegramPaymentDispatchResult;
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
    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'income_not_found',
    } satisfies TelegramPaymentDispatchResult;
  }

  const saleIncomeId = createdIncome.type === 'new_sale' ? createdIncome.id : createdIncome.relatedDebtIncomeId;
  if (!saleIncomeId) {
    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'income_not_found',
    } satisfies TelegramPaymentDispatchResult;
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

  if (!saleIncome?.course || !saleIncome.customer) {
    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'course_not_eligible',
    } satisfies TelegramPaymentDispatchResult;
  }

  const categoryGroupKeys = resolvePaymentGroupEnvKeysByCategory(saleIncome.course.category);
  if (!categoryGroupKeys) {
    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'course_not_eligible',
    } satisfies TelegramPaymentDispatchResult;
  }

  const groupIds = parseTelegramGroupIdsFromEnvKeys(categoryGroupKeys);
  if (!groupIds.length) {
    const normalizedCategory = String(saleIncome.course.category || '').trim().toLowerCase() || 'unknown';
    console.warn('[Income][Telegram] Group ID is missing for payment category', {
      tenantId: params.tenantId,
      category: normalizedCategory,
      expectedEnv: categoryGroupKeys,
    });
    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'groups_missing',
    } satisfies TelegramPaymentDispatchResult;
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

  let sentCount = 0;
  const sendErrors: string[] = [];

  for (const groupId of groupIds) {
    try {
      await telegramService.sendMessage(botToken, groupId, message, {
        disable_web_page_preview: true,
      });
      sentCount += 1;
    } catch (error) {
      const errorMessage = String((error as any)?.message || error);
      sendErrors.push(`${groupId}: ${errorMessage}`);
      console.error('[Income][Telegram] Failed to send offline/intensive payment message', {
        tenantId: params.tenantId,
        groupId,
        incomeId: params.incomeId,
        error: errorMessage,
      });
    }
  }

  const dispatchResult = {
    attempted: true,
    delivered: sentCount > 0,
    sentCount,
    failedCount: Math.max(groupIds.length - sentCount, 0),
    reason: sentCount > 0 ? undefined : 'send_failed',
    errors: sendErrors.slice(0, 3),
  } satisfies TelegramPaymentDispatchResult;

  if (!dispatchResult.delivered) {
    console.warn('[Income][Telegram] Payment message was not delivered to any target group.', {
      tenantId: params.tenantId,
      incomeId: params.incomeId,
      groupIds,
      errors: dispatchResult.errors,
    });
  }

  return dispatchResult;
}

async function sendRefundApprovedTelegram(params: {
  tenantId: string;
  requestId: string;
  reviewedByUserId: string;
}) {
  const groupIds = parseTelegramGroupIdsFromEnvKeys(REFUND_PAYMENT_GROUP_ENV_KEYS);
  if (!groupIds.length) {
    console.warn('[Income][Telegram] Refund group is missing. Set PAYMENT_RETURN_GROUP_ID (or REFUND_GROUP_ID).');
    return;
  }

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId);
  if (!botToken) {
    console.warn('[Income][Telegram] Bot token is missing for refund message.');
    return;
  }

  const request = await prisma.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_REFUND,
      status: ADJUSTMENT_STATUS_APPROVED,
    },
    select: {
      id: true,
      reason: true,
      requestedAmount: true,
      income: {
        select: {
          id: true,
          entryDate: true,
          paymentAmount: true,
          customer: {
            select: {
              name: true,
              customerNumber: true,
              telegramUsername: true,
            },
          },
          manager: {
            select: {
              name: true,
              username: true,
            },
          },
          course: {
            select: {
              name: true,
            },
          },
          tariff: {
            select: {
              name: true,
            },
          },
        },
      },
      reviewedBy: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
      reviewedAt: true,
    },
  });

  if (!request?.income?.customer) {
    return;
  }

  const customer = request.income.customer;
  const managerLabel = request.income.manager?.name || request.income.manager?.username || null;
  const reviewerLabel = request.reviewedBy?.name || request.reviewedBy?.username || params.reviewedByUserId;
  const telegramUsername = customer.telegramUsername
    ? (customer.telegramUsername.startsWith('@') ? customer.telegramUsername : `@${customer.telegramUsername}`)
    : '-';

  const messageLines = [
    '#Pul_qaytarish',
    ...(toHashtag(request.income.course?.name) ? [toHashtag(request.income.course?.name)] : []),
    ...(toHashtag(request.income.tariff?.name) ? [toHashtag(request.income.tariff?.name)] : []),
    ...(toHashtag(managerLabel) ? [toHashtag(managerLabel)] : []),
    '',
    `1.Mijoz: ${customer.name}`,
    `2.Tel: ${customer.customerNumber}`,
    `3.Tg: ${telegramUsername}`,
    '',
    `Qaytarilgan summa: ${formatAmountUz(request.requestedAmount ?? request.income.paymentAmount ?? 0)}`,
    `To'lov sanasi: ${formatDateGmt5(request.income.entryDate)}`,
    `Tasdiqlagan: ${reviewerLabel}`,
    `Tasdiqlangan vaqt: ${request.reviewedAt ? formatDateGmt5(request.reviewedAt) : '-'}`,
    ...(request.reason ? [`Izoh: ${request.reason}`] : []),
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
      console.error('[Income][Telegram] Failed to send refund message', {
        tenantId: params.tenantId,
        requestId: params.requestId,
        groupId,
        error: String((error as any)?.message || error),
      });
    }
  }
}

async function sendRefundRequestedTelegram(params: {
  tenantId: string;
  requestId: string;
  requestedByUserId: string;
}) {
  const groupIds = parseTelegramGroupIdsFromEnvKeys(REFUND_PAYMENT_GROUP_ENV_KEYS);
  if (!groupIds.length) {
    console.warn('[Income][Telegram] Refund request group is missing. Set PAYMENT_RETURN_GROUP_ID (or REFUND_GROUP_ID).');
    return;
  }

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId);
  if (!botToken) {
    console.warn('[Income][Telegram] Bot token is missing for refund request message.');
    return;
  }

  const request = await prisma.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_REFUND,
      status: ADJUSTMENT_STATUS_PENDING,
    },
    select: {
      id: true,
      reason: true,
      requestedAmount: true,
      createdAt: true,
      income: {
        select: {
          id: true,
          entryDate: true,
          paymentAmount: true,
          customer: {
            select: {
              name: true,
              customerNumber: true,
              telegramUsername: true,
            },
          },
          manager: {
            select: {
              name: true,
              username: true,
            },
          },
          course: {
            select: {
              name: true,
            },
          },
          tariff: {
            select: {
              name: true,
            },
          },
        },
      },
      requestedBy: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
  });

  if (!request?.income?.customer) {
    return;
  }

  const customer = request.income.customer;
  const managerLabel = request.income.manager?.name || request.income.manager?.username || null;
  const requesterLabel = request.requestedBy?.name || request.requestedBy?.username || params.requestedByUserId;
  const telegramUsername = customer.telegramUsername
    ? (customer.telegramUsername.startsWith('@') ? customer.telegramUsername : `@${customer.telegramUsername}`)
    : '-';

  const messageLines = [
    '#Pul_qaytarish_so\'rovi',
    ...(toHashtag(request.income.course?.name) ? [toHashtag(request.income.course?.name)] : []),
    ...(toHashtag(request.income.tariff?.name) ? [toHashtag(request.income.tariff?.name)] : []),
    ...(toHashtag(managerLabel) ? [toHashtag(managerLabel)] : []),
    '',
    `1.Mijoz: ${customer.name}`,
    `2.Tel: ${customer.customerNumber}`,
    `3.Tg: ${telegramUsername}`,
    '',
    `So'ralgan summa: ${formatAmountUz(request.requestedAmount ?? request.income.paymentAmount ?? 0)}`,
    `Asl to'lov sanasi: ${formatDateGmt5(request.income.entryDate)}`,
    `So'rov yuborgan: ${requesterLabel}`,
    `So'rov vaqti: ${formatDateGmt5(request.createdAt)}`,
    'Holat: Kutilmoqda',
    ...(request.reason ? [`Izoh: ${request.reason}`] : []),
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
      console.error('[Income][Telegram] Failed to send refund request message', {
        tenantId: params.tenantId,
        requestId: params.requestId,
        groupId,
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
  subTariffsByTariffIdAndKey: Map<string, string>;
  firstSubTariffIdByTariffId: Map<string, string>;
};

const ENTRY_DATE_HEADERS = ['entrydate', 'date', 'sana'];
const MANAGER_HEADERS = ['salesmanager', 'manager', 'manageruserid', 'managerid'];
const CUSTOMER_NUMBER_HEADERS = ['customernumber', 'mijozraqami', 'customerphone', 'raqam'];
const CUSTOMER_NAME_HEADERS = ['customername', 'mijozismi', 'name'];
const TELEGRAM_HEADERS = ['telegramusername', 'telegram', 'telegramuser'];
const TYPE_HEADERS = ['type', 'incometype', 'transactiontype', 'turi'];
const COURSE_HEADERS = ['course', 'coursename', 'kurs'];
const TARIFF_HEADERS = ['tariff', 'tarif'];
const SUB_TARIFF_HEADERS = ['subtariff', 'subtarif', 'sub_tariff', 'sub_tarif', 'subkurs', 'subkursi'];
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
      orderBy: {
        name: 'asc',
      },
      select: {
        id: true,
        name: true,
        tariffs: {
          where: {
            isActive: true,
          },
          orderBy: {
            name: 'asc',
          },
          select: {
            id: true,
            name: true,
            subTariffs: {
              where: {
                isActive: true,
              },
              orderBy: {
                name: 'asc',
              },
              select: {
                id: true,
                name: true,
              },
            },
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
  const subTariffsByTariffIdAndKey = new Map<string, string>();
  const firstSubTariffIdByTariffId = new Map<string, string>();

  for (const course of courses) {
    coursesByKey.set(normalizeKey(course.id), course.id);
    coursesByKey.set(normalizeKey(course.name), course.id);

    for (const tariff of course.tariffs) {
      tariffsByCourseIdAndKey.set(buildLookupKey(course.id, tariff.id), tariff.id);
      tariffsByCourseIdAndKey.set(buildLookupKey(course.id, tariff.name), tariff.id);

      for (const subTariff of tariff.subTariffs) {
        subTariffsByTariffIdAndKey.set(buildLookupKey(tariff.id, subTariff.id), subTariff.id);
        subTariffsByTariffIdAndKey.set(buildLookupKey(tariff.id, subTariff.name), subTariff.id);
      }

      const firstSubTariff = tariff.subTariffs[0];
      if (firstSubTariff?.id) {
        firstSubTariffIdByTariffId.set(tariff.id, firstSubTariff.id);
      }
    }
  }

  return {
    managersByKey,
    managersByNormalizedName,
    coursesByKey,
    tariffsByCourseIdAndKey,
    subTariffsByTariffIdAndKey,
    firstSubTariffIdByTariffId,
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

    const subTariffRaw = normalizeStringValue(getRowValue(row, SUB_TARIFF_HEADERS));
    let subTariffId: string | undefined;
    if (subTariffRaw) {
      subTariffId = lookupContext.subTariffsByTariffIdAndKey.get(buildLookupKey(tariffId, subTariffRaw));
      if (!subTariffId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Row ${rowNumber}: sub-tariff must match an active sub-tariff for the selected tariff.`,
        });
      }
    } else {
      subTariffId = lookupContext.firstSubTariffIdByTariffId.get(tariffId);
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
      subTariffId,
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
  allowHiddenCourseSelection?: boolean;
}) {
  const { tenantId, userId, input, writeAuditLog = true, allowHiddenCourseSelection = false } = params;

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
  let telegramDispatch:
    | {
        attempted: boolean;
        delivered: boolean;
        sentCount: number;
        failedCount: number;
        reason?: string;
        errors?: string[];
      }
    | null = null;

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
        where: {
          id: input.courseId,
          tenantId,
          isActive: true,
          ...(allowHiddenCourseSelection ? {} : { isHiddenFromIncomeForm: false }),
        },
        select: { id: true },
      }).catch((error) => {
        if (!allowHiddenCourseSelection && isMissingCourseHiddenFromIncomeFormColumnError(error)) {
          return prisma.course.findFirst({
            where: { id: input.courseId, tenantId, isActive: true },
            select: { id: true },
          });
        }
        throw error;
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
      telegramDispatch = await sendOfflineOrIntensivePaymentTelegram({
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
      telegramDispatch = {
        attempted: true,
        delivered: false,
        sentCount: 0,
        failedCount: 0,
        reason: 'send_failed',
        errors: [String((error as any)?.message || error)],
      };
    }
  }

  return {
    income: createdIncome,
    customerNumber: customer.customerNumber,
    telegramDispatch,
  };
}

const HISTORICAL_IMPORT_STATUS_PREPARED = 'prepared';
const HISTORICAL_IMPORT_STATUS_RUNNING = 'running';
const HISTORICAL_IMPORT_STATUS_CANCELLING = 'cancelling';
const HISTORICAL_IMPORT_STATUS_CANCELLED = 'cancelled';
const HISTORICAL_IMPORT_STATUS_FAILED = 'failed';
const HISTORICAL_IMPORT_STATUS_COMPLETED = 'completed';
const HISTORICAL_IMPORT_STALE_MS = 2 * 60 * 1000;

const historicalRawRowSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));
const historicalImportPrepareSchema = z.object({
  sessionId: z.string().uuid().optional(),
  incomeFileName: z.string().min(1).max(255).optional(),
  customerFileName: z.string().min(1).max(255).optional(),
  customerSheetName: z.string().min(1).max(255).optional(),
  incomeRows: z.array(historicalRawRowSchema).min(1).max(5000),
  customerRows: z.array(historicalRawRowSchema).min(1).max(5000),
  fallbackManagerUserId: z.string().uuid().optional(),
  managerAliasMap: z.record(z.string().uuid()).optional(),
});
const historicalImportSessionSchema = z.object({
  sessionId: z.string().uuid(),
});

type HistoricalProgressState = {
  stage: string;
  totalRows: number;
  processedRows: number;
  importedRows: number;
  failedRows: number;
  totalIncomeRows: number;
  processedIncomeRows: number;
  importedIncomeRows: number;
  importedNewSaleRows: number;
  importedRepaymentRows: number;
  totalCustomerRows: number;
  processedCustomerRows: number;
  importedCustomerRows: number;
  createdCustomers: number;
  updatedCustomers: number;
  profileOnlyCustomers: number;
  skippedIncomeRows: number;
  skippedCustomerRows: number;
  message?: string;
  incomeCursor?: number;
  customerCursor?: number;
};

function asHistoricalProgressState(value: unknown): HistoricalProgressState {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    stage: String(raw.stage || HISTORICAL_IMPORT_STATUS_PREPARED),
    totalRows: Number(raw.totalRows || 0),
    processedRows: Number(raw.processedRows || 0),
    importedRows: Number(raw.importedRows || 0),
    failedRows: Number(raw.failedRows || 0),
    totalIncomeRows: Number(raw.totalIncomeRows || 0),
    processedIncomeRows: Number(raw.processedIncomeRows || 0),
    importedIncomeRows: Number(raw.importedIncomeRows || 0),
    importedNewSaleRows: Number(raw.importedNewSaleRows || 0),
    importedRepaymentRows: Number(raw.importedRepaymentRows || 0),
    totalCustomerRows: Number(raw.totalCustomerRows || 0),
    processedCustomerRows: Number(raw.processedCustomerRows || 0),
    importedCustomerRows: Number(raw.importedCustomerRows || 0),
    createdCustomers: Number(raw.createdCustomers || 0),
    updatedCustomers: Number(raw.updatedCustomers || 0),
    profileOnlyCustomers: Number(raw.profileOnlyCustomers || 0),
    skippedIncomeRows: Number(raw.skippedIncomeRows || 0),
    skippedCustomerRows: Number(raw.skippedCustomerRows || 0),
    message: raw.message ? String(raw.message) : undefined,
    incomeCursor: Number(raw.incomeCursor || 0),
    customerCursor: Number(raw.customerCursor || 0),
  };
}

function isHistoricalImportSessionStale(status: string, updatedAt: Date | null | undefined): boolean {
  if (status !== HISTORICAL_IMPORT_STATUS_RUNNING && status !== HISTORICAL_IMPORT_STATUS_CANCELLING) {
    return false;
  }
  if (!(updatedAt instanceof Date)) {
    return false;
  }
  return Date.now() - updatedAt.getTime() > HISTORICAL_IMPORT_STALE_MS;
}

function getHistoricalImportStaleResolution(status: string, progress: HistoricalProgressState) {
  if (status === HISTORICAL_IMPORT_STATUS_CANCELLING) {
    return {
      nextStatus: HISTORICAL_IMPORT_STATUS_CANCELLED,
      progress: {
        ...progress,
        stage: HISTORICAL_IMPORT_STATUS_CANCELLED,
        message: "Import bekor qilindi.",
      },
      errorMessage: null,
    };
  }

  return {
    nextStatus: HISTORICAL_IMPORT_STATUS_FAILED,
    progress: {
      ...progress,
      stage: HISTORICAL_IMPORT_STATUS_FAILED,
      message: "Import jarayoni to'xtab qoldi. Preview ni qayta tayyorlab, qaytadan boshlang.",
    },
    errorMessage: "Historical import session became stale before completion.",
  };
}

async function buildHistoricalCatalogContext(tenantId: string) {
  const [lookupContext, courses, existingCustomers] = await Promise.all([
    buildRowLookupContext(tenantId),
    fetchCoursesWithTariffsSafe({ tenantId, onlyActive: false }),
    prisma.customer.findMany({
      where: { tenantId },
      select: {
        customerNumber: true,
      },
    }),
  ]);

  return {
    managerLookup: {
      managersByKey: Object.fromEntries(lookupContext.managersByKey.entries()),
      managersByNormalizedName: lookupContext.managersByNormalizedName,
    },
    catalogLookup: {
      courses: courses.map((course) => ({
        name: course.name,
        category: (course.category as any) || 'offline',
        tariffs: course.tariffs.map((tariff) => tariff.name),
      })),
      existingCustomerNumbers: existingCustomers.map((customer) => customer.customerNumber),
    },
  };
}

async function ensureHistoricalCatalogItems(params: {
  tenantId: string;
  items: HistoricalCatalogItemPreview[];
}) {
  const ensuredCourses = new Map<string, { id: string; name: string; tariffsByKey: Map<string, string> }>();

  for (const item of params.items) {
    const course = await prisma.course.upsert({
      where: {
        tenantId_name: {
          tenantId: params.tenantId,
          name: item.courseName,
        },
      },
      update: {},
      create: {
        tenantId: params.tenantId,
        name: item.courseName,
        category: item.category,
        isActive: true,
        isHiddenFromIncomeForm: false,
      },
      select: {
        id: true,
        name: true,
      },
    });

    const tariffsByKey = ensuredCourses.get(normalizeKey(item.courseName))?.tariffsByKey ?? new Map<string, string>();
    for (const tariffName of item.tariffs) {
      const tariff = await prisma.tariff.upsert({
        where: {
          tenantId_courseId_name: {
            tenantId: params.tenantId,
            courseId: course.id,
            name: tariffName,
          },
        },
        update: {},
        create: {
          tenantId: params.tenantId,
          courseId: course.id,
          name: tariffName,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
        },
      });
      tariffsByKey.set(normalizeKey(tariff.name), tariff.id);
    }

    ensuredCourses.set(normalizeKey(item.courseName), {
      id: course.id,
      name: course.name,
      tariffsByKey,
    });
  }

  const courses = await fetchCoursesWithTariffsSafe({
    tenantId: params.tenantId,
    onlyActive: false,
  });

  const courseIdByKey = new Map<string, string>();
  const tariffIdByCourseAndKey = new Map<string, string>();
  for (const course of courses) {
    courseIdByKey.set(normalizeKey(course.name), course.id);
    for (const tariff of course.tariffs) {
      tariffIdByCourseAndKey.set(`${course.id}:${normalizeKey(tariff.name)}`, tariff.id);
    }
  }

  return {
    courseIdByKey,
    tariffIdByCourseAndKey,
  };
}

function buildHistoricalIncomeMeta(row: HistoricalPreparedIncomeRow) {
  return {
    comment: row.comment,
    rawManagerValue: row.rawManagerValue,
    rawCourseLabel: row.rawCourseLabel,
    remainingDebtHint: row.remainingDebtHint,
  };
}

async function annotateHistoricalIncome(params: {
  incomeId: string;
  tenantId: string;
  sessionId: string;
  legacyImportKey: string;
  legacyImportSource: string;
  legacyImportMeta?: Prisma.InputJsonValue | null;
}) {
  await prisma.income.update({
    where: { id: params.incomeId },
    data: {
      legacyImportKey: params.legacyImportKey,
      legacyImportSource: params.legacyImportSource,
      historicalImportSessionId: params.sessionId,
      legacyImportMeta: params.legacyImportMeta || undefined,
    },
  });
}

function shouldBackfillCustomerText(currentValue: string | null | undefined, fallbackValue: string | null | undefined, customerNumber?: string) {
  const current = String(currentValue || '').trim();
  const fallback = String(fallbackValue || '').trim();
  if (!fallback) {
    return false;
  }
  if (!current) {
    return true;
  }
  if (customerNumber && current === customerNumber) {
    return true;
  }
  if (/^\d+$/.test(current) && current.length >= 7) {
    return true;
  }
  return false;
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
        excludeHiddenFromIncomeForm: true,
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
        isFaol: z.boolean().optional(),
        isHiddenFromIncomeForm: z.boolean().optional(),
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

      const data: {
        name?: string;
        category?: string;
        isActive?: boolean;
        isHiddenFromIncomeForm?: boolean;
      } = {};
      if (typeof input.name === 'string') {
        data.name = input.name.trim();
      }
      if (typeof input.category === 'string') {
        data.category = input.category;
      }
      if (typeof input.isActive === 'boolean') {
        data.isActive = input.isActive;
      } else if (typeof input.isFaol === 'boolean') {
        data.isActive = input.isFaol;
      }
      if (typeof input.isHiddenFromIncomeForm === 'boolean') {
        data.isHiddenFromIncomeForm = input.isHiddenFromIncomeForm;
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
        if (!isMissingCourseCategoryColumnError(error) && !isMissingCourseHiddenFromIncomeFormColumnError(error)) {
          throw error;
        }

        const fallbackData: { name?: string; isActive?: boolean } = {};
        if (typeof input.name === 'string') {
          fallbackData.name = input.name.trim();
        }
        if (typeof input.isActive === 'boolean') {
          fallbackData.isActive = input.isActive;
        } else if (typeof input.isFaol === 'boolean') {
          fallbackData.isActive = input.isFaol;
        }

        if (!Object.keys(fallbackData).length) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Course fields are unavailable until database migrations are applied.',
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
        isFaol: z.boolean().optional(),
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
      } else if (typeof input.isFaol === 'boolean') {
        data.isActive = input.isFaol;
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
        isFaol: z.boolean().optional(),
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
      } else if (typeof input.isFaol === 'boolean') {
        data.isActive = input.isFaol;
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

      return {
        income: result.income,
        telegramDispatch: result.telegramDispatch,
      };
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

      const linkedPendingAdjustmentCount = await prisma.incomeAdjustmentRequest.count({
        where: {
          tenantId: ctx.tenantId,
          incomeId: income.id,
          status: ADJUSTMENT_STATUS_PENDING,
        },
      });

      if (linkedPendingAdjustmentCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This income entry has pending adjustment requests. Resolve them first.',
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

      const transactionSteps: Prisma.PrismaPromise<unknown>[] = [];

      if (income.type === 'repayment' && income.relatedDebtIncomeId) {
        const sourceIncome = await prisma.income.findFirst({
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

          transactionSteps.push(
            prisma.income.updateMany({
              where: {
                id: sourceIncome.id,
                tenantId: ctx.tenantId,
              },
              data: {
                remainingDebtAmount: Math.max(restoredDebt, 0),
              },
            }),
          );
        }
      }

      transactionSteps.push(
        prisma.income.delete({
          where: { id: income.id },
        }),
      );

      await prisma.$transaction(transactionSteps);

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

  deleteIncomesByPeriod: adminProcedure
    .input(
      z.object({
        dateFrom: z.string().min(1),
        dateTo: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rangeStart = parseGmt5DateBoundary(input.dateFrom, false);
      const rangeEnd = parseGmt5DateBoundary(input.dateTo, true);

      if (rangeEnd < rangeStart) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Sana oralig'i noto'g'ri: tugash sanasi boshlanish sanasidan oldin bo'lmasligi kerak.",
        });
      }

      const matchedIncomes = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          entryDate: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
        select: {
          id: true,
          type: true,
          paymentAmount: true,
          relatedDebtIncomeId: true,
        },
      });

      if (!matchedIncomes.length) {
        return {
          success: true,
          matchedCount: 0,
          deletedCount: 0,
          blockedCount: 0,
          blocked: [] as Array<{ incomeId: string; reason: 'pending_adjustment' | 'has_linked_repayments' }>,
        };
      }

      const incomeIds = matchedIncomes.map((income) => income.id);
      const pendingAdjustments = await prisma.incomeAdjustmentRequest.findMany({
        where: {
          tenantId: ctx.tenantId,
          incomeId: { in: incomeIds },
          status: ADJUSTMENT_STATUS_PENDING,
        },
        select: {
          incomeId: true,
        },
      });
      const pendingAdjustmentSet = new Set(pendingAdjustments.map((item) => item.incomeId));

      const newSaleIncomeIds = matchedIncomes
        .filter((income) => income.type === 'new_sale')
        .map((income) => income.id);

      const linkedRepayments = newSaleIncomeIds.length > 0
        ? await prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              type: 'repayment',
              relatedDebtIncomeId: { in: newSaleIncomeIds },
            },
            select: {
              id: true,
              relatedDebtIncomeId: true,
            },
          })
        : [];
      const matchedIncomeIdSet = new Set(incomeIds);
      const saleIdsBlockedByRepayments = new Set<string>();
      for (const linkedRepayment of linkedRepayments) {
        if (!linkedRepayment.relatedDebtIncomeId) {
          continue;
        }
        const repaymentOutsideSelectedRange = !matchedIncomeIdSet.has(linkedRepayment.id);
        const repaymentBlockedByAdjustment = pendingAdjustmentSet.has(linkedRepayment.id);
        if (repaymentOutsideSelectedRange || repaymentBlockedByAdjustment) {
          saleIdsBlockedByRepayments.add(linkedRepayment.relatedDebtIncomeId);
        }
      }

      const blocked = matchedIncomes
        .map((income) => {
          if (pendingAdjustmentSet.has(income.id)) {
            return { incomeId: income.id, reason: 'pending_adjustment' as const };
          }
          if (income.type === 'new_sale' && saleIdsBlockedByRepayments.has(income.id)) {
            return { incomeId: income.id, reason: 'has_linked_repayments' as const };
          }
          return null;
        })
        .filter((item): item is { incomeId: string; reason: 'pending_adjustment' | 'has_linked_repayments' } => Boolean(item));

      const blockedSet = new Set(blocked.map((item) => item.incomeId));
      const deletableIncomes = matchedIncomes.filter((income) => !blockedSet.has(income.id));

      if (!deletableIncomes.length) {
        return {
          success: true,
          matchedCount: matchedIncomes.length,
          deletedCount: 0,
          blockedCount: blocked.length,
          blocked: blocked.slice(0, 50),
        };
      }

      const debtRestoreMap = new Map<string, number>();
      for (const income of deletableIncomes) {
        if (income.type !== 'repayment' || !income.relatedDebtIncomeId) {
          continue;
        }
        const current = debtRestoreMap.get(income.relatedDebtIncomeId) || 0;
        debtRestoreMap.set(income.relatedDebtIncomeId, current + Number(income.paymentAmount || 0));
      }

      const transactionSteps: Prisma.PrismaPromise<unknown>[] = [];
      if (debtRestoreMap.size > 0) {
        const sourceIncomeIds = Array.from(debtRestoreMap.keys());
        const sourceIncomes = await prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: sourceIncomeIds },
          },
          select: {
            id: true,
            debtAmount: true,
            remainingDebtAmount: true,
          },
        });

        for (const sourceIncome of sourceIncomes) {
          const restoreAmount = debtRestoreMap.get(sourceIncome.id) || 0;
          if (restoreAmount <= 0) {
            continue;
          }

          const restoredDebtRaw = (sourceIncome.remainingDebtAmount || 0) + restoreAmount;
          const restoredDebt = sourceIncome.debtAmount !== null
            ? Math.min(restoredDebtRaw, sourceIncome.debtAmount)
            : restoredDebtRaw;

          transactionSteps.push(
            prisma.income.updateMany({
              where: {
                id: sourceIncome.id,
                tenantId: ctx.tenantId,
              },
              data: {
                remainingDebtAmount: Math.max(restoredDebt, 0),
              },
            }),
          );
        }
      }

      transactionSteps.push(
        prisma.income.deleteMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: deletableIncomes.map((income) => income.id) },
          },
        }),
      );

      const transactionResult = await prisma.$transaction(transactionSteps);
      const deletionResult = transactionResult[transactionResult.length - 1] as { count: number };
      const deletedCount = deletionResult.count;

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_bulk_delete_by_period',
          resource: 'income',
          metadata: {
            dateFrom: input.dateFrom,
            dateTo: input.dateTo,
            matchedCount: matchedIncomes.length,
            deletedCount,
            blockedCount: blocked.length,
          },
        },
      });

      return {
        success: true,
        matchedCount: matchedIncomes.length,
        deletedCount,
        blockedCount: blocked.length,
        blocked: blocked.slice(0, 50),
      };
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
            allowHiddenCourseSelection: true,
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
            allowHiddenCourseSelection: true,
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

  prepareHistoricalImport: adminProcedure
    .input(historicalImportPrepareSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        if (input.fallbackManagerUserId) {
          await assertManagerBelongsToTenant(ctx.tenantId, input.fallbackManagerUserId);
        }

        const { managerLookup, catalogLookup } = await buildHistoricalCatalogContext(ctx.tenantId);
        const prepared = prepareHistoricalImportPreview({
          incomeRows: input.incomeRows as HistoricalRawRow[],
          customerRows: input.customerRows as HistoricalRawRow[],
          managerLookup,
          existingCatalog: catalogLookup,
          fallbackManagerUserId: input.fallbackManagerUserId,
          managerAliasMap: input.managerAliasMap,
        });
        const initialProgress = buildHistoricalInitialProgress({
          incomeRows: prepared.incomeRows,
          customerRows: prepared.customerRows,
          preview: prepared.preview,
        });

        if (input.sessionId) {
          const existingSession = await prisma.historicalImportSession.findFirst({
            where: {
              id: input.sessionId,
              tenantId: ctx.tenantId,
            },
            select: {
              id: true,
              status: true,
              updatedAt: true,
            },
          });
          if (!existingSession) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Historical import session not found.' });
          }
          if (
            existingSession.status === HISTORICAL_IMPORT_STATUS_RUNNING
            && !isHistoricalImportSessionStale(existingSession.status, existingSession.updatedAt)
          ) {
            throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Historical import is already running.' });
          }
        }

        const sessionPayload = {
          fallbackManagerUserId: input.fallbackManagerUserId || null,
          sourceFiles: {
            incomeFileName: input.incomeFileName || null,
            customerFileName: input.customerFileName || null,
            customerSheetName: input.customerSheetName || null,
          },
          managerAliasMap: prepared.managerAliasMap,
          incomeRows: prepared.incomeRows as unknown as Prisma.InputJsonValue,
          customerRows: prepared.customerRows as unknown as Prisma.InputJsonValue,
          preview: prepared.preview as unknown as Prisma.InputJsonValue,
          progress: initialProgress as unknown as Prisma.InputJsonValue,
          failureReport: prepared.preview.failures as unknown as Prisma.InputJsonValue,
          status: HISTORICAL_IMPORT_STATUS_PREPARED,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
          cancelledAt: null,
        };

        const session = input.sessionId
          ? await prisma.historicalImportSession.update({
              where: { id: input.sessionId },
              data: sessionPayload,
              select: { id: true, status: true, createdAt: true, updatedAt: true },
            })
          : await prisma.historicalImportSession.create({
              data: {
                tenantId: ctx.tenantId,
                createdByUserId: ctx.user.userId,
                ...sessionPayload,
              },
              select: { id: true, status: true, createdAt: true, updatedAt: true },
            });

        await prisma.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            userId: ctx.user.userId,
            action: 'historical_import_prepare',
            resource: 'historical_import_session',
            resourceId: session.id,
            metadata: {
              preview: prepared.preview,
            },
          },
        });

        return {
          sessionId: session.id,
          status: session.status,
          preview: prepared.preview,
          progress: initialProgress,
        };
      } catch (error) {
        if (isMissingHistoricalImportSchemaError(error)) {
          throwHistoricalImportMigrationError();
        }
        if (isCourseCategoryConstraintOutdatedError(error)) {
          throwCourseCategoryMigrationError();
        }
        throw error;
      }
    }),

  getHistoricalImportProgress: adminProcedure
    .input(historicalImportSessionSchema)
    .query(async ({ ctx, input }) => {
      try {
        const session = await prisma.historicalImportSession.findFirst({
          where: {
            id: input.sessionId,
            tenantId: ctx.tenantId,
          },
          select: {
            id: true,
            status: true,
            preview: true,
            progress: true,
            failureReport: true,
            errorMessage: true,
            createdAt: true,
            updatedAt: true,
            startedAt: true,
            completedAt: true,
            cancelledAt: true,
            sourceFiles: true,
          },
        });

        if (!session) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Historical import session not found.' });
        }

        if (isHistoricalImportSessionStale(session.status, session.updatedAt)) {
          const currentProgress = asHistoricalProgressState(session.progress);
          const resolution = getHistoricalImportStaleResolution(session.status, currentProgress);
          const recoveredSession = await prisma.historicalImportSession.update({
            where: { id: session.id },
            data: {
              status: resolution.nextStatus,
              progress: resolution.progress as unknown as Prisma.InputJsonValue,
              errorMessage: resolution.errorMessage,
              ...(resolution.nextStatus === HISTORICAL_IMPORT_STATUS_CANCELLED
                ? { cancelledAt: session.cancelledAt || new Date() }
                : { completedAt: session.completedAt || new Date() }),
            },
            select: {
              id: true,
              status: true,
              preview: true,
              progress: true,
              failureReport: true,
              errorMessage: true,
              createdAt: true,
              updatedAt: true,
              startedAt: true,
              completedAt: true,
              cancelledAt: true,
              sourceFiles: true,
            },
          });

          return {
            sessionId: recoveredSession.id,
            status: recoveredSession.status,
            preview: (recoveredSession.preview || {}) as Record<string, unknown>,
            progress: asHistoricalProgressState(recoveredSession.progress),
            failureReport: Array.isArray(recoveredSession.failureReport) ? recoveredSession.failureReport : [],
            errorMessage: recoveredSession.errorMessage,
            sourceFiles: recoveredSession.sourceFiles || null,
            createdAt: recoveredSession.createdAt,
            updatedAt: recoveredSession.updatedAt,
            startedAt: recoveredSession.startedAt,
            completedAt: recoveredSession.completedAt,
            cancelledAt: recoveredSession.cancelledAt,
          };
        }

        return {
          sessionId: session.id,
          status: session.status,
          preview: (session.preview || {}) as Record<string, unknown>,
          progress: asHistoricalProgressState(session.progress),
          failureReport: Array.isArray(session.failureReport) ? session.failureReport : [],
          errorMessage: session.errorMessage,
          sourceFiles: session.sourceFiles || null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          cancelledAt: session.cancelledAt,
        };
      } catch (error) {
        if (isMissingHistoricalImportSchemaError(error)) {
          throwHistoricalImportMigrationError();
        }
        throw error;
      }
    }),

  cancelHistoricalImport: adminProcedure
    .input(historicalImportSessionSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const session = await prisma.historicalImportSession.findFirst({
          where: {
            id: input.sessionId,
            tenantId: ctx.tenantId,
          },
          select: {
            id: true,
            status: true,
            updatedAt: true,
            progress: true,
            cancelledAt: true,
          },
        });
        if (!session) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Historical import session not found.' });
        }

        const nextStatus = session.status === HISTORICAL_IMPORT_STATUS_RUNNING
          ? (
              isHistoricalImportSessionStale(session.status, session.updatedAt)
                ? HISTORICAL_IMPORT_STATUS_CANCELLED
                : HISTORICAL_IMPORT_STATUS_CANCELLING
            )
          : HISTORICAL_IMPORT_STATUS_CANCELLED;
        const progress = asHistoricalProgressState(session.progress);
        const nextProgress = nextStatus === HISTORICAL_IMPORT_STATUS_CANCELLED
          ? {
              ...progress,
              stage: HISTORICAL_IMPORT_STATUS_CANCELLED,
              message: "Import bekor qilindi.",
            }
          : progress;

        await prisma.historicalImportSession.update({
          where: { id: session.id },
          data: {
            status: nextStatus,
            cancelledAt: nextStatus === HISTORICAL_IMPORT_STATUS_CANCELLED ? (session.cancelledAt || new Date()) : null,
            progress: nextProgress as unknown as Prisma.InputJsonValue,
          },
        });

        return {
          sessionId: session.id,
          status: nextStatus,
        };
      } catch (error) {
        if (isMissingHistoricalImportSchemaError(error)) {
          throwHistoricalImportMigrationError();
        }
        throw error;
      }
    }),

  executeHistoricalImport: adminProcedure
    .input(historicalImportSessionSchema)
    .mutation(async ({ ctx, input }) => {
      let failureSessionId: string | null = input.sessionId;
      let failureProgress: HistoricalProgressState | null = null;
      let failureReport: HistoricalImportFailure[] = [];
      try {
        const session = await prisma.historicalImportSession.findFirst({
          where: {
            id: input.sessionId,
            tenantId: ctx.tenantId,
          },
          select: {
            id: true,
            status: true,
            incomeRows: true,
            customerRows: true,
            preview: true,
            progress: true,
            failureReport: true,
            fallbackManagerUserId: true,
            managerAliasMap: true,
            startedAt: true,
          },
        });

        if (!session) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Historical import session not found.' });
        }
        failureSessionId = session.id;

        const preview = (session.preview || {}) as {
          canExecute?: boolean;
          missingCatalogItems?: HistoricalCatalogItemPreview[];
        };
        if (!preview.canExecute) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Historical import preview still has blocking issues. Fix preview errors first.',
          });
        }

        const incomeRows = (Array.isArray(session.incomeRows) ? session.incomeRows : []) as unknown as HistoricalPreparedIncomeRow[];
        const customerRows = (Array.isArray(session.customerRows) ? session.customerRows : []) as unknown as HistoricalPreparedCustomerRow[];
        const progress = asHistoricalProgressState(session.progress);
        failureProgress = progress;
        failureReport = (Array.isArray(session.failureReport) ? [...session.failureReport] : []) as HistoricalImportFailure[];

        await prisma.historicalImportSession.update({
          where: { id: session.id },
          data: {
            status: HISTORICAL_IMPORT_STATUS_RUNNING,
            startedAt: session.startedAt || new Date(),
            progress: {
              ...(session.progress as Record<string, unknown> || {}),
              stage: 'catalog',
              message: 'Katalog tekshirilmoqda',
            } as unknown as Prisma.InputJsonValue,
            errorMessage: null,
          },
        });

        const catalogMaps = await ensureHistoricalCatalogItems({
          tenantId: ctx.tenantId,
          items: Array.isArray(preview.missingCatalogItems) ? preview.missingCatalogItems : [],
        });

        const validIncomeRows = incomeRows.filter((row) => row.blockingIssues.length === 0);
        const validCustomerRows = customerRows.filter((row) => row.blockingIssues.length === 0);
        const legacyKeys = Array.from(new Set(
          validIncomeRows.flatMap((row) => [
            row.legacyImportKey,
            ...(row.openingBalanceLegacyKey ? [row.openingBalanceLegacyKey] : []),
          ]),
        ));

        const existingIncomes = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          legacyImportKey: { in: legacyKeys },
        },
        select: {
          id: true,
          legacyImportKey: true,
          type: true,
        },
      });
        const saleIdByLegacyKey = new Map<string, string>();
        const importedIncomeIdByLegacyKey = new Map<string, string>();
        for (const income of existingIncomes) {
          if (income.legacyImportKey) {
            importedIncomeIdByLegacyKey.set(income.legacyImportKey, income.id);
            if (income.type === 'new_sale') {
              saleIdByLegacyKey.set(income.legacyImportKey, income.id);
            }
          }
        }

        const persistProgress = async (message: string) => {
          await prisma.historicalImportSession.update({
            where: { id: session.id },
            data: {
              progress: {
                ...progress,
                message,
              } as unknown as Prisma.InputJsonValue,
              failureReport: failureReport as unknown as Prisma.InputJsonValue,
            },
          });
        };

        for (let index = progress.incomeCursor || 0; index < validIncomeRows.length; index += 1) {
        const row = validIncomeRows[index] as HistoricalPreparedIncomeRow;

        if (index % 25 === 0) {
          const statusCheck = await prisma.historicalImportSession.findFirst({
            where: { id: session.id, tenantId: ctx.tenantId },
            select: { status: true },
          });
          if (statusCheck?.status === HISTORICAL_IMPORT_STATUS_CANCELLING) {
            await prisma.historicalImportSession.update({
              where: { id: session.id },
              data: {
                status: HISTORICAL_IMPORT_STATUS_CANCELLED,
                cancelledAt: new Date(),
                progress: {
                  ...progress,
                  stage: 'cancelled',
                  message: 'Import bekor qilindi',
                } as unknown as Prisma.InputJsonValue,
                failureReport: failureReport as unknown as Prisma.InputJsonValue,
              },
            });
            return {
              sessionId: session.id,
              status: HISTORICAL_IMPORT_STATUS_CANCELLED,
              progress,
            };
          }
        }

        try {
          const courseId = catalogMaps.courseIdByKey.get(normalizeKey(row.courseName));
          const tariffId = courseId
            ? catalogMaps.tariffIdByCourseAndKey.get(`${courseId}:${normalizeKey(row.tariffName)}`)
            : null;

          if (!courseId || !tariffId) {
            throw new Error(`Catalog item not found for ${row.courseName} / ${row.tariffName}.`);
          }

          if (row.type === 'new_sale') {
            const existingIncomeId = importedIncomeIdByLegacyKey.get(row.legacyImportKey);
            if (!existingIncomeId) {
              const created = await createIncomeEntry({
                tenantId: ctx.tenantId,
                userId: ctx.user.userId,
                input: {
                  entryDate: row.entryDate,
                  managerUserId: row.managerUserId as string,
                  customerNumber: row.customerNumber,
                  customerName: row.customerName || undefined,
                  telegramUsername: row.telegramUsername || undefined,
                  type: 'new_sale',
                  courseId,
                  tariffId,
                  coursePriceAmount: row.coursePriceAmount || 0,
                  paymentAmount: row.paymentAmount,
                  deadline: row.deadline || undefined,
                },
                writeAuditLog: false,
                allowHiddenCourseSelection: true,
              });
              await annotateHistoricalIncome({
                incomeId: created.income.id,
                tenantId: ctx.tenantId,
                sessionId: session.id,
                legacyImportKey: row.legacyImportKey,
                legacyImportSource: 'income_ledger',
                legacyImportMeta: buildHistoricalIncomeMeta(row),
              });
              importedIncomeIdByLegacyKey.set(row.legacyImportKey, created.income.id);
              saleIdByLegacyKey.set(row.legacyImportKey, created.income.id);
            } else {
              saleIdByLegacyKey.set(row.legacyImportKey, existingIncomeId);
            }
          } else {
            if (row.requiresOpeningBalance && row.openingBalanceLegacyKey && !saleIdByLegacyKey.has(row.openingBalanceLegacyKey)) {
              const openingIncomeId = importedIncomeIdByLegacyKey.get(row.openingBalanceLegacyKey);
              if (openingIncomeId) {
                saleIdByLegacyKey.set(row.openingBalanceLegacyKey, openingIncomeId);
              } else {
                const openingCreated = await createIncomeEntry({
                  tenantId: ctx.tenantId,
                  userId: ctx.user.userId,
                  input: {
                    entryDate: row.entryDate,
                    managerUserId: row.managerUserId as string,
                    customerNumber: row.customerNumber,
                    customerName: row.customerName || undefined,
                    telegramUsername: row.telegramUsername || undefined,
                    type: 'new_sale',
                    courseId,
                    tariffId,
                    coursePriceAmount: row.openingBalanceAmount || row.paymentAmount,
                    paymentAmount: 0,
                    deadline: row.deadline || undefined,
                  },
                  writeAuditLog: false,
                  allowHiddenCourseSelection: true,
                });
                await annotateHistoricalIncome({
                  incomeId: openingCreated.income.id,
                  tenantId: ctx.tenantId,
                  sessionId: session.id,
                  legacyImportKey: row.openingBalanceLegacyKey,
                  legacyImportSource: 'historical_opening_balance',
                  legacyImportMeta: {
                    linkedIncomeRowKey: row.legacyImportKey,
                    openingBalanceAmount: row.openingBalanceAmount,
                  },
                });
                importedIncomeIdByLegacyKey.set(row.openingBalanceLegacyKey, openingCreated.income.id);
                saleIdByLegacyKey.set(row.openingBalanceLegacyKey, openingCreated.income.id);
              }
            }

            const sourceLegacyKey = row.matchedSaleLegacyKey;
            const sourceIncomeId = sourceLegacyKey ? saleIdByLegacyKey.get(sourceLegacyKey) : null;
            if (!sourceIncomeId) {
              throw new Error('Repayment source could not be resolved.');
            }

            if (!importedIncomeIdByLegacyKey.has(row.legacyImportKey)) {
              const created = await createIncomeEntry({
                tenantId: ctx.tenantId,
                userId: ctx.user.userId,
                input: {
                  entryDate: row.entryDate,
                  managerUserId: row.managerUserId as string,
                  customerNumber: row.customerNumber,
                  customerName: row.customerName || undefined,
                  telegramUsername: row.telegramUsername || undefined,
                  type: 'repayment',
                  debtSourceIncomeId: sourceIncomeId,
                  paymentAmount: row.paymentAmount,
                  deadline: row.deadline || undefined,
                },
                writeAuditLog: false,
                allowHiddenCourseSelection: true,
              });
              await annotateHistoricalIncome({
                incomeId: created.income.id,
                tenantId: ctx.tenantId,
                sessionId: session.id,
                legacyImportKey: row.legacyImportKey,
                legacyImportSource: 'income_ledger',
                legacyImportMeta: buildHistoricalIncomeMeta(row),
              });
              importedIncomeIdByLegacyKey.set(row.legacyImportKey, created.income.id);
            }
          }

          progress.importedIncomeRows += 1;
          if (row.type === 'new_sale') {
            progress.importedNewSaleRows += 1;
          } else {
            progress.importedRepaymentRows += 1;
          }
          progress.importedRows += 1;
        } catch (error) {
          failureReport.push({
            scope: 'income',
            rowNumber: row.rowNumber,
            message: error instanceof Error ? error.message : 'Unknown historical income import error',
          });
          progress.failedRows += 1;
        }

        progress.processedIncomeRows = index + 1;
        progress.processedRows = progress.processedIncomeRows + progress.processedCustomerRows;
        progress.incomeCursor = index + 1;

        if ((index + 1) % 25 === 0 || index === validIncomeRows.length - 1) {
          await persistProgress(`Income import: ${progress.processedIncomeRows}/${progress.totalIncomeRows}`);
        }
        }

        const customerNumbers = Array.from(new Set(validCustomerRows.map((row) => row.customerNumber).filter(Boolean)));
        const existingCustomers = await prisma.customer.findMany({
        where: {
          tenantId: ctx.tenantId,
          customerNumber: { in: customerNumbers },
        },
        select: {
          id: true,
          customerNumber: true,
          name: true,
          telegramUsername: true,
          profileCourseId: true,
          profileTariffId: true,
          profileSubTariffId: true,
        },
      });
        const customerByNumber = new Map(existingCustomers.map((customer) => [customer.customerNumber, customer] as const));

        for (let index = progress.customerCursor || 0; index < validCustomerRows.length; index += 1) {
        const row = validCustomerRows[index] as HistoricalPreparedCustomerRow;

        if (index % 25 === 0) {
          const statusCheck = await prisma.historicalImportSession.findFirst({
            where: { id: session.id, tenantId: ctx.tenantId },
            select: { status: true },
          });
          if (statusCheck?.status === HISTORICAL_IMPORT_STATUS_CANCELLING) {
            await prisma.historicalImportSession.update({
              where: { id: session.id },
              data: {
                status: HISTORICAL_IMPORT_STATUS_CANCELLED,
                cancelledAt: new Date(),
                progress: {
                  ...progress,
                  stage: 'cancelled',
                  message: 'Import bekor qilindi',
                } as unknown as Prisma.InputJsonValue,
                failureReport: failureReport as unknown as Prisma.InputJsonValue,
              },
            });
            return {
              sessionId: session.id,
              status: HISTORICAL_IMPORT_STATUS_CANCELLED,
              progress,
            };
          }
        }

        try {
          const existingCustomer = customerByNumber.get(row.customerNumber);
          const courseId = row.courseName ? catalogMaps.courseIdByKey.get(normalizeKey(row.courseName)) || null : null;
          const tariffId = row.courseName && row.tariffName && courseId
            ? catalogMaps.tariffIdByCourseAndKey.get(`${courseId}:${normalizeKey(row.tariffName)}`) || null
            : null;
          let customerOperation: 'created' | 'updated' = 'updated';

          if (existingCustomer) {
            const updateData: Prisma.CustomerUpdateInput = {
              legacyProfileImportKey: row.legacyProfileImportKey,
              legacyProfileImportSource: 'customer_master',
              historicalImportSessionId: session.id,
              legacyProfileMeta: {
                comment: row.comment,
                rawCourseLabel: row.rawCourseLabel,
                rawTariffLabel: row.rawTariffLabel,
              } as unknown as Prisma.InputJsonValue,
            };

            if (shouldBackfillCustomerText(existingCustomer.name, row.customerName, row.customerNumber)) {
              updateData.name = row.customerName || existingCustomer.name;
            }
            if (shouldBackfillCustomerText(existingCustomer.telegramUsername, row.telegramUsername, row.customerNumber)) {
              updateData.telegramUsername = row.telegramUsername || null;
            }
            if (courseId) {
              updateData.profileCourseId = courseId;
              updateData.profileTariffId = tariffId;
              updateData.profileSubTariffId = null;
            }

            const updatedCustomer = await prisma.customer.update({
              where: { id: existingCustomer.id },
              data: updateData,
              select: {
                id: true,
                customerNumber: true,
                name: true,
                telegramUsername: true,
                profileCourseId: true,
                profileTariffId: true,
                profileSubTariffId: true,
              },
            });
            customerByNumber.set(updatedCustomer.customerNumber, updatedCustomer);
          } else {
            customerOperation = 'created';
            if (!row.customerName) {
              throw new Error('Customer name is required for profile-only customer creation.');
            }
            const createdCustomer = await prisma.customer.create({
              data: {
                tenantId: ctx.tenantId,
                customerNumber: row.customerNumber,
                name: row.customerName,
                telegramUsername: row.telegramUsername || null,
                profileCourseId: courseId,
                profileTariffId: tariffId,
                profileSubTariffId: null,
                legacyProfileImportKey: row.legacyProfileImportKey,
                legacyProfileImportSource: 'customer_master',
                historicalImportSessionId: session.id,
                legacyProfileMeta: {
                  comment: row.comment,
                  rawCourseLabel: row.rawCourseLabel,
                  rawTariffLabel: row.rawTariffLabel,
                } as unknown as Prisma.InputJsonValue,
              },
              select: {
                id: true,
                customerNumber: true,
                name: true,
                telegramUsername: true,
                profileCourseId: true,
                profileTariffId: true,
                profileSubTariffId: true,
              },
            });
            customerByNumber.set(createdCustomer.customerNumber, createdCustomer);
          }

          progress.importedCustomerRows += 1;
          if (customerOperation === 'created') {
            progress.createdCustomers += 1;
          } else {
            progress.updatedCustomers += 1;
          }
          progress.importedRows += 1;
        } catch (error) {
          failureReport.push({
            scope: 'customer',
            rowNumber: row.rowNumber,
            message: error instanceof Error ? error.message : 'Unknown historical customer import error',
          });
          progress.failedRows += 1;
        }

        progress.processedCustomerRows = index + 1;
        progress.processedRows = progress.processedIncomeRows + progress.processedCustomerRows;
        progress.customerCursor = index + 1;

        if ((index + 1) % 25 === 0 || index === validCustomerRows.length - 1) {
          await persistProgress(`Customer import: ${progress.processedCustomerRows}/${progress.totalCustomerRows}`);
        }
        }

        progress.stage = HISTORICAL_IMPORT_STATUS_COMPLETED;
        progress.message = 'Tarixiy import yakunlandi';

        await prisma.historicalImportSession.update({
          where: { id: session.id },
          data: {
            status: HISTORICAL_IMPORT_STATUS_COMPLETED,
            completedAt: new Date(),
            progress: progress as unknown as Prisma.InputJsonValue,
            failureReport: failureReport as unknown as Prisma.InputJsonValue,
          },
        });

        await prisma.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            userId: ctx.user.userId,
            action: 'historical_import_execute',
            resource: 'historical_import_session',
            resourceId: session.id,
            metadata: {
              progress,
            },
          },
        });

        return {
          sessionId: session.id,
          status: HISTORICAL_IMPORT_STATUS_COMPLETED,
          progress,
          failureReport,
        };
      } catch (error) {
        if (failureSessionId) {
          try {
            const stalledProgress = failureProgress || asHistoricalProgressState({});
            await prisma.historicalImportSession.update({
              where: { id: failureSessionId },
              data: {
                status: HISTORICAL_IMPORT_STATUS_FAILED,
                completedAt: new Date(),
                progress: {
                  ...stalledProgress,
                  stage: HISTORICAL_IMPORT_STATUS_FAILED,
                  message: "Import xatolik bilan to'xtadi.",
                } as unknown as Prisma.InputJsonValue,
                failureReport: failureReport as unknown as Prisma.InputJsonValue,
                errorMessage: error instanceof Error ? error.message : String(error),
              },
            });
          } catch {
            // Best-effort recovery only; preserve original error below.
          }
        }
        if (isMissingHistoricalImportSchemaError(error)) {
          throwHistoricalImportMigrationError();
        }
        if (isCourseCategoryConstraintOutdatedError(error)) {
          throwCourseCategoryMigrationError();
        }
        throw error;
      }
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

      if (input.type === ADJUSTMENT_TYPE_REFUND) {
        try {
          await sendRefundRequestedTelegram({
            tenantId: ctx.tenantId,
            requestId: createdRequest.id,
            requestedByUserId: ctx.user.userId,
          });
        } catch (error) {
          console.error('[Income][Telegram] Refund request notification failed (non-blocking)', {
            tenantId: ctx.tenantId,
            requestId: createdRequest.id,
            error: String((error as any)?.message || error),
          });
        }
      }

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
          message: "Admin, Manager, Tashkiliy, or Organizator role is required to approve tariff changes.",
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

      if (request.type === ADJUSTMENT_TYPE_REFUND) {
        try {
          await sendRefundApprovedTelegram({
            tenantId: ctx.tenantId,
            requestId: request.id,
            reviewedByUserId: ctx.user.userId,
          });
        } catch (error) {
          console.error('[Income][Telegram] Refund notification failed (non-blocking)', {
            tenantId: ctx.tenantId,
            requestId: request.id,
            error: String((error as any)?.message || error),
          });
        }
      }

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
          message: "Admin, Manager, Tashkiliy, or Organizator role is required to reject tariff changes.",
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

  customerEditorOptions: adminProcedure.query(async ({ ctx }) => {
    const courses = await fetchCoursesWithTariffsSafe({
      tenantId: ctx.tenantId,
      onlyActive: true,
    });

    return (courses as Array<{
      id: string;
      name: string;
      category: string;
      tariffs: Array<{
        id: string;
        name: string;
        subTariffs: Array<{ id: string; name: string; isActive: boolean }>;
      }>;
    }>).map((course) => ({
      id: course.id,
      name: course.name,
      category: course.category,
      tariffs: course.tariffs.map((tariff) => ({
        id: tariff.id,
        name: tariff.name,
        subTariffs: Array.isArray(tariff.subTariffs)
          ? tariff.subTariffs.filter((subTariff) => subTariff.isActive).map((subTariff) => ({
              id: subTariff.id,
              name: subTariff.name,
            }))
          : [],
      })),
    }));
  }),

  createCustomerOnly: adminProcedure
    .input(
      z.object({
        customerNumber: z.string().min(1).max(64),
        name: z.string().min(1).max(160),
        telegramUsername: z.string().max(160).optional(),
        courseId: z.string().uuid().optional(),
        tariffId: z.string().uuid().optional(),
        subTariffId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const customerNumber = sanitizeCustomerNumber(input.customerNumber.trim());
      if (!customerNumber || !CUSTOMER_NUMBER_REGEX.test(customerNumber)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Customer number must contain only digits.',
        });
      }

      const name = input.name.trim();
      if (!name) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Customer name is required.',
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

      if (!input.courseId && (input.tariffId || input.subTariffId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Course is required when selecting tariff or sub-tariff.',
        });
      }
      if (!input.tariffId && input.subTariffId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tariff is required when selecting sub-tariff.',
        });
      }

      const existing = await prisma.customer.findUnique({
        where: {
          tenantId_customerNumber: {
            tenantId: ctx.tenantId,
            customerNumber,
          },
        },
        select: { id: true },
      });
      if (existing) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Customer with this number already exists.',
        });
      }

      if (input.courseId) {
        const course = await prisma.course.findFirst({
          where: { id: input.courseId, tenantId: ctx.tenantId, isActive: true },
          select: { id: true },
        });
        if (!course) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected course not found.' });
        }
      }
      if (input.tariffId && input.courseId) {
        const tariff = await prisma.tariff.findFirst({
          where: {
            id: input.tariffId,
            tenantId: ctx.tenantId,
            courseId: input.courseId,
            isActive: true,
          },
          select: { id: true },
        });
        if (!tariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected tariff not found for course.' });
        }
      }
      if (input.subTariffId && input.tariffId) {
        const subTariff = await prisma.subTariff.findFirst({
          where: {
            id: input.subTariffId,
            tenantId: ctx.tenantId,
            tariffId: input.tariffId,
            isActive: true,
          },
          select: { id: true },
        });
        if (!subTariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected sub-tariff not found for tariff.' });
        }
      }

      const created = await prisma.customer.create({
        data: {
          tenantId: ctx.tenantId,
          customerNumber,
          name,
          telegramUsername: normalizedTelegramUsername || null,
          profileCourseId: input.courseId || null,
          profileTariffId: input.tariffId || null,
          profileSubTariffId: input.subTariffId || null,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'customer_create_only',
          resource: 'customer',
          resourceId: created.id,
          metadata: {
            customerNumber: created.customerNumber,
          },
        },
      });

      return created;
    }),

  updateCustomersCourseAssignment: adminProcedure
    .input(
      z.object({
        customerIds: z.array(z.string().uuid()).min(1).max(500),
        courseId: z.string().uuid().nullable().optional(),
        tariffId: z.string().uuid().nullable().optional(),
        subTariffId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const customerIds = Array.from(new Set(input.customerIds));
      const courseId = input.courseId || null;
      const tariffId = input.tariffId || null;
      const subTariffId = input.subTariffId || null;

      if (!courseId && (tariffId || subTariffId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Course is required when selecting tariff or sub-tariff.',
        });
      }
      if (!tariffId && subTariffId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tariff is required when selecting sub-tariff.',
        });
      }

      if (courseId) {
        const course = await prisma.course.findFirst({
          where: { id: courseId, tenantId: ctx.tenantId, isActive: true },
          select: { id: true },
        });
        if (!course) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected course not found.' });
        }
      }
      if (courseId && tariffId) {
        const tariff = await prisma.tariff.findFirst({
          where: { id: tariffId, tenantId: ctx.tenantId, courseId, isActive: true },
          select: { id: true },
        });
        if (!tariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected tariff not found for course.' });
        }
      }
      if (tariffId && subTariffId) {
        const subTariff = await prisma.subTariff.findFirst({
          where: { id: subTariffId, tenantId: ctx.tenantId, tariffId, isActive: true },
          select: { id: true },
        });
        if (!subTariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected sub-tariff not found for tariff.' });
        }
      }

      const updateResult = await prisma.customer.updateMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: customerIds },
        },
        data: {
          profileCourseId: courseId,
          profileTariffId: tariffId,
          profileSubTariffId: subTariffId,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'customer_bulk_course_assignment_update',
          resource: 'customer',
          metadata: {
            customerCount: customerIds.length,
            updatedCount: updateResult.count,
            courseId,
            tariffId,
            subTariffId,
          },
        },
      });

      return {
        updatedCount: updateResult.count,
      };
    }),

  deleteCustomers: adminProcedure
    .input(
      z.object({
        customerIds: z.array(z.string().uuid()).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const customerIds = Array.from(new Set(input.customerIds));
      const customers = await prisma.customer.findMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: customerIds },
        },
        select: {
          id: true,
          customerNumber: true,
        },
      });

      if (!customers.length) {
        return { deletedCount: 0 };
      }

      const existingCustomerIds = customers.map((customer) => customer.id);
      const deleteResult = await prisma.customer.deleteMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: existingCustomerIds },
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'customer_bulk_delete',
          resource: 'customer',
          metadata: {
            deletedCount: deleteResult.count,
            requestedCount: customerIds.length,
          },
        },
      });

      return {
        deletedCount: deleteResult.count,
      };
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
            profileCourseId: true,
            profileTariffId: true,
            profileSubTariffId: true,
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
      const profileCourseIds = Array.from(new Set(customers.map((customer) => customer.profileCourseId).filter(Boolean))) as string[];
      const profileTariffIds = Array.from(new Set(customers.map((customer) => customer.profileTariffId).filter(Boolean))) as string[];
      const profileSubTariffIds = Array.from(new Set(customers.map((customer) => customer.profileSubTariffId).filter(Boolean))) as string[];
      const [profileCourses, profileTariffs, profileSubTariffs] = await Promise.all([
        profileCourseIds.length > 0
          ? prisma.course.findMany({
              where: { tenantId: ctx.tenantId, id: { in: profileCourseIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        profileTariffIds.length > 0
          ? prisma.tariff.findMany({
              where: { tenantId: ctx.tenantId, id: { in: profileTariffIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        profileSubTariffIds.length > 0
          ? prisma.subTariff.findMany({
              where: { tenantId: ctx.tenantId, id: { in: profileSubTariffIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
      ]);
      const profileCourseNameById = new Map(profileCourses.map((course) => [course.id, course.name]));
      const profileTariffNameById = new Map(profileTariffs.map((tariff) => [tariff.id, tariff.name]));
      const profileSubTariffNameById = new Map(profileSubTariffs.map((subTariff) => [subTariff.id, subTariff.name]));
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
          const profileCourseName = customer.profileCourseId ? profileCourseNameById.get(customer.profileCourseId) || null : null;
          const profileTariffName = customer.profileTariffId ? profileTariffNameById.get(customer.profileTariffId) || null : null;
          const profileSubTariffName = customer.profileSubTariffId ? profileSubTariffNameById.get(customer.profileSubTariffId) || null : null;
          const profileCourseLabel = [profileCourseName, profileTariffName, profileSubTariffName].filter(Boolean).join(' / ');
          const aggregateCourses = aggregate ? Array.from(aggregate.courses) : [];
          const mergedCourses = profileCourseLabel && !aggregateCourses.includes(profileCourseLabel)
            ? [profileCourseLabel, ...aggregateCourses]
            : aggregateCourses;
          return {
            ...customer,
            totalDebtAmount: aggregate?.totalDebtAmount ?? 0,
            totalPaidAmount: aggregate?.totalPaidAmount ?? 0,
            hasDebt: aggregate?.hasDebt ?? false,
            lastActivityAt: aggregate?.lastActivityAt ?? null,
            courses: mergedCourses,
            profileCourseName,
            profileTariffName,
            profileSubTariffName,
          };
        }),
        courseOptions,
      };
    }),
});
