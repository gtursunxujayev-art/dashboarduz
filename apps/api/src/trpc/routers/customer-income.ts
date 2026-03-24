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
const TARIFF_CHANGE_GROUP_ENV_KEYS = [
  'TARIFF_CHANGE_GROUP_ID',
  'TARIFF_CHANGE_GROUP_IDS',
  'COURSE_CHANGE_GROUP_ID',
  'COURSE_CHANGE_GROUP_IDS',
  'CHANGE_GROUP_ID',
  'CHANGE_GROUP_IDS',
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

function throwIncomeImportDisabledByPolicy(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: "Import moduli vaqtincha o'chirilgan. Qo'lda tushum kiritish rejimidan foydalaning.",
  });
}

function isCourseCategoryConstraintOutdatedError(error: unknown): boolean {
  let details = '';
  try {
    details = JSON.stringify(error);
  } catch {
    details = '';
  }
  const message = [
    String((error as any)?.message || ''),
    String((error as any)?.cause || ''),
    String((error as any)?.meta?.database_error || ''),
    String((error as any)?.meta?.cause || ''),
    details,
  ]
    .join(' ')
    .toLowerCase();
  return (
    message.includes('courses_category_check')
    || (
      message.includes('violates check constraint')
      && message.includes('category')
      && message.includes('courses')
    )
    || (
      message.includes('23514')
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

async function ensureCourseCategoryConstraintSupportsAdditionalService(): Promise<void> {
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`SET LOCAL lock_timeout = '5000ms'`),
    prisma.$executeRawUnsafe(`SET LOCAL statement_timeout = '15000ms'`),
    prisma.$executeRawUnsafe(`
      UPDATE "courses"
      SET "category" = 'offline'
      WHERE "category" IS NULL
         OR LENGTH(TRIM("category")) = 0
         OR "category" NOT IN ('online', 'offline', 'intensive', 'additional_service');
    `),
    prisma.$executeRawUnsafe(`ALTER TABLE "courses" DROP CONSTRAINT IF EXISTS "courses_category_check"`),
    prisma.$executeRawUnsafe(`
      ALTER TABLE "courses"
      ADD CONSTRAINT "courses_category_check"
      CHECK ("category" IN ('online', 'offline', 'intensive', 'additional_service'));
    `),
  ]);
}

async function ensureAdditionalServiceCategoryReady(requestedCategory: string | null | undefined): Promise<void> {
  if (requestedCategory !== 'additional_service') {
    return;
  }

  try {
    await ensureCourseCategoryConstraintSupportsAdditionalService();
  } catch {
    throwCourseCategoryMigrationError();
  }
}

function normalizeHistoricalImportErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  const normalized = raw.toLowerCase();

  if (
    normalized.includes('courses_category_check')
    || (
      normalized.includes('violates check constraint')
      && normalized.includes('category')
      && normalized.includes('courses')
    )
  ) {
    return "Kurs kategoriya cheklovi eskirgan. `additional_service` uchun yangi database migration ni ishga tushiring va keyin importni qayta boshlang.";
  }

  if (
    (normalized.includes('historical_import_sessions') && normalized.includes('does not exist'))
    || (normalized.includes('legacyimportkey') && normalized.includes('does not exist'))
    || (normalized.includes('legacyprofileimportkey') && normalized.includes('does not exist'))
    || (normalized.includes('historicalimportsessionid') && normalized.includes('does not exist'))
  ) {
    return "Tarixiy import ishlashi uchun yangi migratsiyalar hali qo'llanmagan. Avval database migration ni ishga tushiring.";
  }

  return raw;
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

function resolveRefundGroupIds(): string[] {
  const preferred = parseTelegramGroupIdsFromEnvKeys(['REFUND_GROUP_ID', 'REFUND_GROUP_IDS']);
  if (preferred.length > 0) {
    return preferred;
  }
  return parseTelegramGroupIdsFromEnvKeys(REFUND_PAYMENT_GROUP_ENV_KEYS);
}

async function fetchLatestResponsibleManagerByCustomer(params: {
  tenantId: string;
  customerIds: string[];
  scopedManagerUserId?: string | null;
}): Promise<Map<string, { managerUserId: string | null; managerLabel: string | null }>> {
  if (!params.customerIds.length) {
    return new Map();
  }

  const latestIncomes = await prisma.income.findMany({
    where: {
      tenantId: params.tenantId,
      customerId: { in: params.customerIds },
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      ...(params.scopedManagerUserId
        ? {
            managerUserId: params.scopedManagerUserId,
          }
        : {}),
    },
    orderBy: [
      { entryDate: 'desc' },
      { createdAt: 'desc' },
    ],
    select: {
      customerId: true,
      managerUserId: true,
      manager: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
  });

  const result = new Map<string, { managerUserId: string | null; managerLabel: string | null }>();
  for (const income of latestIncomes) {
    if (result.has(income.customerId)) {
      continue;
    }
    const managerLabel = income.manager?.name || income.manager?.username || income.managerUserId || null;
    result.set(income.customerId, {
      managerUserId: income.managerUserId || null,
      managerLabel,
    });
  }

  return result;
}

function buildTelegramChatIdCandidates(groupId: string): string[] {
  const normalized = String(groupId || '').trim();
  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>([normalized]);
  if (/^-100\d+$/.test(normalized)) {
    candidates.add(`-${normalized.slice(4)}`);
  } else if (/^-\d+$/.test(normalized) && !normalized.startsWith('-100')) {
    candidates.add(`-100${normalized.slice(1)}`);
  }
  return Array.from(candidates);
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
  const splitMessage = (text: string): string[] => {
    const maxLength = 3500;
    if (text.length <= maxLength) {
      return [text];
    }
    const lines = text.split('\n');
    const chunks: string[] = [];
    let current = '';
    for (const line of lines) {
      const next = current ? `${current}\n${line}` : line;
      if (next.length > maxLength) {
        if (current) {
          chunks.push(current);
        }
        if (line.length > maxLength) {
          chunks.push(line.slice(0, maxLength));
          current = line.slice(maxLength);
        } else {
          current = line;
        }
      } else {
        current = next;
      }
    }
    if (current) {
      chunks.push(current);
    }
    return chunks.length ? chunks : [text];
  };
  const messageChunks = splitMessage(message);

  let sentCount = 0;
  const sendErrors: string[] = [];

  for (const groupId of groupIds) {
    try {
      for (const chunk of messageChunks) {
        await telegramService.sendMessage(botToken, groupId, chunk, {
          disable_web_page_preview: true,
        });
      }
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

async function sendTariffChangeRequestedTelegram(params: {
  tenantId: string;
  requestId: string;
  requestedByUserId: string;
}) {
  const request = await prisma.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_TARIFF_CHANGE,
      status: ADJUSTMENT_STATUS_PENDING,
    },
    select: {
      id: true,
      reason: true,
      newAgreementAmount: true,
      createdAt: true,
      requestedBy: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
      income: {
        select: {
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
      newCourse: {
        select: {
          name: true,
          category: true,
        },
      },
      newTariff: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!request?.income?.customer || !request.newCourse) {
    return;
  }

  const groupIds = parseTelegramGroupIdsFromEnvKeys(TARIFF_CHANGE_GROUP_ENV_KEYS);
  if (!groupIds.length) {
    console.warn('[Income][Telegram] Tariff change group is missing. Set TARIFF_CHANGE_GROUP_ID (or CHANGE_GROUP_ID).');
    return;
  }

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId);
  if (!botToken) {
    return;
  }

  const customer = request.income.customer;
  const requesterLabel = request.requestedBy?.name || request.requestedBy?.username || params.requestedByUserId;
  const managerLabel = request.income.manager?.name || request.income.manager?.username || null;
  const telegramUsername = customer.telegramUsername
    ? (customer.telegramUsername.startsWith('@') ? customer.telegramUsername : `@${customer.telegramUsername}`)
    : '-';

  const hashtags = [
    "#Tarif_o'zgarishi_so'rovi",
    ...(toHashtag(request.newCourse.name) ? [toHashtag(request.newCourse.name)] : []),
    ...(toHashtag(request.newTariff?.name) ? [toHashtag(request.newTariff?.name)] : []),
    ...(toHashtag(managerLabel) ? [toHashtag(managerLabel)] : []),
  ].join('\n');

  const customerBlock = [
    `1.Mijoz: ${customer.name}`,
    `2.Tel: ${customer.customerNumber}`,
    `3.Tg: ${telegramUsername}`,
  ].join('\n');

  const courseChangeBlock = [
    `Eski kurs/tarif: ${[request.income.course?.name, request.income.tariff?.name].filter(Boolean).join(' / ') || '-'}`,
    `Yangi kurs/tarif: ${[request.newCourse?.name, request.newTariff?.name].filter(Boolean).join(' / ') || '-'}`,
  ].join('\n');

  const agreementBlock = `Yangi kelishuv: ${formatAmountUz(request.newAgreementAmount ?? 0)}`;

  const metaBlock = [
    `So'rov yuborgan: ${requesterLabel}`,
    `So'rov vaqti: ${formatDateGmt5(request.createdAt)}`,
    ...(request.reason ? [`Izoh: ${request.reason}`] : []),
  ].join('\n');

  const message = [
    hashtags,
    customerBlock,
    courseChangeBlock,
    agreementBlock,
    metaBlock,
  ].filter(Boolean).join('\n\n');
  for (const groupId of groupIds) {
    try {
      await telegramService.sendMessage(botToken, groupId, message, {
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error('[Income][Telegram] Failed to send tariff-change requested message', {
        tenantId: params.tenantId,
        requestId: params.requestId,
        groupId,
        error: String((error as any)?.message || error),
      });
    }
  }
}

async function sendTariffChangeApprovedTelegram(params: {
  tenantId: string;
  requestId: string;
  reviewedByUserId: string;
}) {
  const request = await prisma.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_TARIFF_CHANGE,
      status: ADJUSTMENT_STATUS_APPROVED,
    },
    select: {
      id: true,
      reason: true,
      newAgreementAmount: true,
      reviewedAt: true,
      reviewedBy: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
      income: {
        select: {
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
              category: true,
            },
          },
          tariff: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  if (!request?.income?.customer || !request.income.course) {
    return;
  }

  const groupIds = parseTelegramGroupIdsFromEnvKeys(TARIFF_CHANGE_GROUP_ENV_KEYS);
  if (!groupIds.length) {
    console.warn('[Income][Telegram] Tariff change group is missing. Set TARIFF_CHANGE_GROUP_ID (or CHANGE_GROUP_ID).');
    return;
  }

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId);
  if (!botToken) {
    return;
  }

  const customer = request.income.customer;
  const reviewerLabel = request.reviewedBy?.name || request.reviewedBy?.username || params.reviewedByUserId;
  const managerLabel = request.income.manager?.name || request.income.manager?.username || null;
  const telegramUsername = customer.telegramUsername
    ? (customer.telegramUsername.startsWith('@') ? customer.telegramUsername : `@${customer.telegramUsername}`)
    : '-';

  const messageLines = [
    "#Tarif_o'zgarishi_tasdiqlandi",
    ...(toHashtag(request.income.course?.name) ? [toHashtag(request.income.course?.name)] : []),
    ...(toHashtag(request.income.tariff?.name) ? [toHashtag(request.income.tariff?.name)] : []),
    ...(toHashtag(managerLabel) ? [toHashtag(managerLabel)] : []),
    '',
    `1.Mijoz: ${customer.name}`,
    `2.Tel: ${customer.customerNumber}`,
    `3.Tg: ${telegramUsername}`,
    '',
    `Yangi kurs/tarif: ${[request.income.course?.name, request.income.tariff?.name].filter(Boolean).join(' / ') || '-'}`,
    `Yangi kelishuv: ${formatAmountUz(request.newAgreementAmount ?? 0)}`,
    `Tasdiqlagan: ${reviewerLabel}`,
    `Tasdiqlangan vaqt: ${request.reviewedAt ? formatDateGmt5(request.reviewedAt) : '-'}`,
    ...(request.reason ? [`Izoh: ${request.reason}`] : []),
  ];

  const message = messageLines.join('\n');
  for (const groupId of groupIds) {
    try {
      await telegramService.sendMessage(botToken, groupId, message, {
        disable_web_page_preview: true,
      });
    } catch (error) {
      console.error('[Income][Telegram] Failed to send tariff-change approved message', {
        tenantId: params.tenantId,
        requestId: params.requestId,
        groupId,
        error: String((error as any)?.message || error),
      });
    }
  }
}

async function sendRefundApprovedTelegram(params: {
  tenantId: string;
  requestId: string;
  reviewedByUserId: string;
}) {
  const groupIds = resolveRefundGroupIds();
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

  const messageLines = [
    ...(toHashtag(managerLabel) ? [toHashtag(managerLabel)] : []),
    `${customer.name}`,
    `${customer.customerNumber}`,
    `Summa - ${formatAmountUz(request.requestedAmount ?? request.income.paymentAmount ?? 0)}`,
    '✅ Qaytarildi',
  ];

  const message = messageLines.join('\n');

  for (const groupId of groupIds) {
    const chatIdCandidates = buildTelegramChatIdCandidates(groupId);
    let delivered = false;
    let lastError = '';

    for (const candidate of chatIdCandidates) {
      try {
        await telegramService.sendMessage(botToken, candidate, message, {
          disable_web_page_preview: true,
        });
        delivered = true;
        break;
      } catch (error) {
        lastError = String((error as any)?.message || error);
      }
    }

    if (!delivered) {
      console.error('[Income][Telegram] Failed to send refund message', {
        tenantId: params.tenantId,
        requestId: params.requestId,
        groupId,
        chatIdCandidates,
        error: lastError,
      });
    }
  }
}

async function sendRefundRequestedTelegram(params: {
  tenantId: string;
  requestId: string;
  requestedByUserId: string;
}) {
  const groupIds = resolveRefundGroupIds();
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
    const chatIdCandidates = buildTelegramChatIdCandidates(groupId);
    let delivered = false;
    let lastError = '';

    for (const candidate of chatIdCandidates) {
      try {
        await telegramService.sendMessage(botToken, candidate, message, {
          disable_web_page_preview: true,
        });
        delivered = true;
        break;
      } catch (error) {
        lastError = String((error as any)?.message || error);
      }
    }

    if (!delivered) {
      console.error('[Income][Telegram] Failed to send refund request message', {
        tenantId: params.tenantId,
        requestId: params.requestId,
        groupId,
        chatIdCandidates,
        error: lastError,
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

const updateIncomeSchema = z.object({
  incomeId: z.string().uuid(),
  entryDate: z.string().min(1).optional(),
  managerUserId: z.string().uuid().optional(),
  paymentAmount: z.number().int().min(0).optional(),
  deadline: z.string().min(1).nullable().optional(),
  courseId: z.string().uuid().optional(),
  tariffId: z.string().uuid().optional(),
  coursePriceAmount: z.number().int().min(0).optional(),
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
    // Temporary production-safe guard:
    // If DB constraint for courses.category does not yet allow "additional_service",
    // never attempt to create/update those catalog items during historical import.
    if (item.category === 'additional_service') {
      continue;
    }

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

    const responsibleManagerMap = await fetchLatestResponsibleManagerByCustomer({
      tenantId: ctx.tenantId,
      customerIds: (customers as Array<{ id: string }>).map((customer) => customer.id),
      scopedManagerUserId,
    });

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
      customers: (customers as Array<{
        id: string;
        customerNumber: string;
        name: string;
        telegramUsername: string | null;
      }>).map((customer) => {
        const responsibleManager = responsibleManagerMap.get(customer.id);
        return {
          ...customer,
          responsibleManagerUserId: responsibleManager?.managerUserId ?? null,
          responsibleManagerLabel: responsibleManager?.managerLabel ?? null,
        };
      }),
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
      const customers = await prisma.customer.findMany({
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

      const responsibleManagerMap = await fetchLatestResponsibleManagerByCustomer({
        tenantId: ctx.tenantId,
        customerIds: customers.map((customer) => customer.id),
        scopedManagerUserId,
      });

      return customers.map((customer) => {
        const responsibleManager = responsibleManagerMap.get(customer.id);
        return {
          ...customer,
          responsibleManagerUserId: responsibleManager?.managerUserId ?? null,
          responsibleManagerLabel: responsibleManager?.managerLabel ?? null,
        };
      });
    }),

  createCourse: managerProcedure
    .input(createCourseSchema)
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();
      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course name is required.' });
      }

      await ensureAdditionalServiceCategoryReady(input.category);

      const upsertCourse = () => prisma.course.upsert({
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

      try {
        return await upsertCourse();
      } catch (error) {
        if (isCourseCategoryConstraintOutdatedError(error)) {
          try {
            await ensureCourseCategoryConstraintSupportsAdditionalService();
            return await upsertCourse();
          } catch {
            throwCourseCategoryMigrationError();
          }
        }
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

      await ensureAdditionalServiceCategoryReady(data.category);

      const updateCourse = () => prisma.course.update({
        where: { id: input.courseId },
        data,
      });

      try {
        return await updateCourse();
      } catch (error) {
        if (isCourseCategoryConstraintOutdatedError(error)) {
          try {
            await ensureCourseCategoryConstraintSupportsAdditionalService();
            return await updateCourse();
          } catch {
            throwCourseCategoryMigrationError();
          }
        }
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

  updateIncome: adminProcedure
    .input(updateIncomeSchema)
    .mutation(async ({ ctx, input }) => {
      const income = await prisma.income.findFirst({
        where: {
          id: input.incomeId,
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
          type: true,
          customerId: true,
          managerUserId: true,
          courseId: true,
          tariffId: true,
          entryDate: true,
          deadline: true,
          paymentAmount: true,
          coursePriceAmount: true,
          debtAmount: true,
          remainingDebtAmount: true,
          relatedDebtIncomeId: true,
          lifecycleStatus: true,
        },
      });

      if (!income) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Income entry not found.' });
      }

      if (income.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Only active income entries can be edited.',
        });
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

      const parsedEntryDate = input.entryDate ? parseDateInput(input.entryDate) : null;
      const parsedDeadline = input.deadline === undefined
        ? undefined
        : (input.deadline === null ? null : parseDateInput(input.deadline));

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
            message: 'This sale has repayments. Edit repayments first.',
          });
        }

        const nextManagerUserId = input.managerUserId ?? income.managerUserId;
        await assertManagerBelongsToTenant(ctx.tenantId, nextManagerUserId);

        const nextCourseId = input.courseId ?? income.courseId;
        const nextTariffId = input.tariffId ?? income.tariffId;
        const nextCoursePriceAmount = input.coursePriceAmount ?? income.coursePriceAmount ?? 0;
        const nextPaymentAmount = input.paymentAmount ?? income.paymentAmount;

        if (!nextCourseId || !nextTariffId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Course and tariff are required for a new sale.',
          });
        }

        const [course, tariff] = await Promise.all([
          prisma.course.findFirst({
            where: {
              id: nextCourseId,
              tenantId: ctx.tenantId,
              isActive: true,
            },
            select: { id: true },
          }),
          prisma.tariff.findFirst({
            where: {
              id: nextTariffId,
              tenantId: ctx.tenantId,
              courseId: nextCourseId,
              isActive: true,
            },
            select: { id: true },
          }),
        ]);

        if (!course || !tariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course or tariff not found.' });
        }

        const remainingDebtAmount = Math.max(nextCoursePriceAmount - nextPaymentAmount, 0);

        const updated = await prisma.income.update({
          where: { id: income.id },
          data: {
            managerUserId: nextManagerUserId,
            entryDate: parsedEntryDate ?? income.entryDate,
            deadline: remainingDebtAmount > 0
              ? (parsedDeadline !== undefined ? parsedDeadline : income.deadline)
              : null,
            courseId: nextCourseId,
            tariffId: nextTariffId,
            coursePriceAmount: nextCoursePriceAmount,
            debtAmount: nextCoursePriceAmount,
            paymentAmount: nextPaymentAmount,
            remainingDebtAmount,
          },
        });

        await prisma.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            userId: ctx.user.userId,
            action: 'income_update',
            resource: 'income',
            resourceId: income.id,
            metadata: {
              type: income.type,
              mode: 'new_sale',
            },
          },
        });

        return {
          success: true,
          income: updated,
        };
      }

      if (input.courseId !== undefined || input.tariffId !== undefined || input.coursePriceAmount !== undefined) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Repayment rows do not support course or tariff edits.',
        });
      }

      const nextManagerUserId = input.managerUserId ?? income.managerUserId;
      await assertManagerBelongsToTenant(ctx.tenantId, nextManagerUserId);

      const nextPaymentAmount = input.paymentAmount ?? income.paymentAmount;
      if (nextPaymentAmount <= 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Repayment amount must be greater than zero.',
        });
      }

      if (!income.relatedDebtIncomeId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This repayment does not have a source debt.',
        });
      }

      const sourceIncome = await prisma.income.findFirst({
        where: {
          id: income.relatedDebtIncomeId,
          tenantId: ctx.tenantId,
          type: 'new_sale',
        },
        select: {
          id: true,
          debtAmount: true,
          remainingDebtAmount: true,
        },
      });

      if (!sourceIncome) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Debt source income was not found.',
        });
      }

      const sourceDebtAtRepaymentTime = income.debtAmount ?? (sourceIncome.remainingDebtAmount + income.paymentAmount);
      if (nextPaymentAmount > sourceDebtAtRepaymentTime) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Repayment amount cannot exceed source debt.',
        });
      }

      const paymentDelta = nextPaymentAmount - income.paymentAmount;
      const nextSourceRemainingDebtRaw = sourceIncome.remainingDebtAmount - paymentDelta;
      const nextSourceRemainingDebt = sourceIncome.debtAmount !== null
        ? Math.min(nextSourceRemainingDebtRaw, sourceIncome.debtAmount)
        : nextSourceRemainingDebtRaw;

      if (nextSourceRemainingDebt < 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Repayment amount cannot exceed source debt.',
        });
      }

      const nextRepaymentRemainingDebt = Math.max(sourceDebtAtRepaymentTime - nextPaymentAmount, 0);

      const [, updatedRepayment] = await prisma.$transaction([
        prisma.income.update({
          where: { id: sourceIncome.id },
          data: {
            remainingDebtAmount: nextSourceRemainingDebt,
          },
        }),
        prisma.income.update({
          where: { id: income.id },
          data: {
            managerUserId: nextManagerUserId,
            entryDate: parsedEntryDate ?? income.entryDate,
            deadline: parsedDeadline !== undefined ? parsedDeadline : income.deadline,
            debtAmount: sourceDebtAtRepaymentTime,
            paymentAmount: nextPaymentAmount,
            remainingDebtAmount: nextRepaymentRemainingDebt,
          },
        }),
      ]);

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_update',
          resource: 'income',
          resourceId: income.id,
          metadata: {
            type: income.type,
            mode: 'repayment',
          },
        },
      });

      return {
        success: true,
        income: updatedRepayment,
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
    .mutation(async () => {
      throwIncomeImportDisabledByPolicy();
    }),

  bulkImportFromGoogleSheet: protectedProcedure
    .input(bulkIncomeImportFromGoogleSheetSchema)
    .mutation(async () => {
      throwIncomeImportDisabledByPolicy();
    }),

  prepareHistoricalImport: adminProcedure
    .input(historicalImportPrepareSchema)
    .mutation(async () => {
      throwIncomeImportDisabledByPolicy();
    }),

  getHistoricalImportProgress: adminProcedure
    .input(historicalImportSessionSchema)
    .query(async () => {
      throwIncomeImportDisabledByPolicy();
    }),

  cancelHistoricalImport: adminProcedure
    .input(historicalImportSessionSchema)
    .mutation(async () => {
      throwIncomeImportDisabledByPolicy();
    }),

  executeHistoricalImport: adminProcedure
    .input(historicalImportSessionSchema)
    .mutation(async () => {
      throwIncomeImportDisabledByPolicy();
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
      } else if (input.type === ADJUSTMENT_TYPE_TARIFF_CHANGE) {
        try {
          await sendTariffChangeRequestedTelegram({
            tenantId: ctx.tenantId,
            requestId: createdRequest.id,
            requestedByUserId: ctx.user.userId,
          });
        } catch (error) {
          console.error('[Income][Telegram] Tariff-change request notification failed (non-blocking)', {
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
        include: {
          income: {
            select: {
              id: true,
              customerId: true,
              courseId: true,
              tariffId: true,
              lifecycleStatus: true,
            },
          },
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
        await tx.income.update({
          where: { id: request.income.id },
          data: {
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          },
        });

        await tx.customer.update({
          where: { id: request.income.customerId },
          data: {
            profileCourseId: request.income.courseId ?? null,
            profileTariffId: request.income.tariffId ?? null,
          },
        });

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
            incomeId: request.income.id,
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
          tariffId: z.string().uuid().optional(),
          subTariffId: z.string().uuid().optional(),
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
          OR: [
            {
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
            },
            {
              profileCourseId: input.courseId,
            },
          ],
        });
      }

      if (input?.tariffId) {
        andConditions.push({
          OR: [
            {
              incomes: {
                some: {
                  ...(scopedManagerUserId
                    ? {
                        managerUserId: scopedManagerUserId,
                      }
                    : {}),
                  lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                  tariffId: input.tariffId,
                },
              },
            },
            {
              profileTariffId: input.tariffId,
            },
          ],
        });
      }

      if (input?.subTariffId) {
        andConditions.push({
          profileSubTariffId: input.subTariffId,
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

      const [customers, courseOptions, catalogCourses] = await Promise.all([
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
        fetchCoursesWithTariffsSafe({
          tenantId: ctx.tenantId,
          onlyActive: true,
        }),
      ]);

      if (!customers.length) {
        return {
          customers: [],
          courseOptions,
          catalogOptions: (catalogCourses as Array<{
            id: string;
            name: string;
            tariffs: Array<{
              id: string;
              name: string;
              subTariffs: Array<{ id: string; name: string; isActive: boolean }>;
            }>;
          }>).map((course) => ({
            id: course.id,
            name: course.name,
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
          })),
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
          managerUserId: true,
          manager: {
            select: {
              name: true,
              username: true,
            },
          },
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
          responsibleManagerUserId: string | null;
          responsibleManagerLabel: string | null;
        }
      >();

      for (const income of relatedIncomes as Array<{
        customerId: string;
        type: string;
        paymentAmount: number;
        remainingDebtAmount: number;
        entryDate: Date;
        managerUserId: string | null;
        manager: { name: string | null; username: string | null } | null;
        course: { id: string; name: string } | null;
      }>) {
        const current = aggregatesByCustomer.get(income.customerId) || {
          totalDebtAmount: 0,
          totalPaidAmount: 0,
          hasDebt: false,
          lastActivityAt: null as Date | null,
          courses: new Set<string>(),
          responsibleManagerUserId: null as string | null,
          responsibleManagerLabel: null as string | null,
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

        if (!current.responsibleManagerLabel) {
          current.responsibleManagerUserId = income.managerUserId || null;
          current.responsibleManagerLabel = income.manager?.name || income.manager?.username || income.managerUserId || null;
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
            responsibleManagerUserId: aggregate?.responsibleManagerUserId ?? null,
            responsibleManagerLabel: aggregate?.responsibleManagerLabel ?? null,
            profileCourseName,
            profileTariffName,
            profileSubTariffName,
          };
        }),
        courseOptions,
        catalogOptions: (catalogCourses as Array<{
          id: string;
          name: string;
          tariffs: Array<{
            id: string;
            name: string;
            subTariffs: Array<{ id: string; name: string; isActive: boolean }>;
          }>;
        }>).map((course) => ({
          id: course.id,
          name: course.name,
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
        })),
      };
    }),
});

