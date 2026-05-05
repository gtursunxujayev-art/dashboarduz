import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma/client';
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
import {
  buildSaleChainMetricsBySaleId,
  evaluateSaleChainConsistency,
  getSaleAgreementAmount,
  type SaleChainSaleRow,
} from '../../services/income-chain';

const SALES_MANAGER_ROLES = ['Admin', 'Manager', 'TeamLeader', 'Agent'] as const;
const SALES_MANAGER_ROLE_TOKENS = new Set(
  SALES_MANAGER_ROLES.map((role) => String(role).trim().toLowerCase()),
);
const COURSE_CATEGORY_VALUES = ['online', 'offline', 'intensive', 'additional_service'] as const;
const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);
const APPROVER_ROLES_TARIFF_CHANGE = new Set(['Admin', 'Manager', 'TeamLeader', 'Organizator', 'Organizer', 'Tashkiliy']);
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
const SALE_SUB_TARIFF_META_KEY = 'saleSubTariffId';
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
const CANONICAL_COURSE_CATEGORIES = new Set(['online', 'offline', 'intensive', 'additional_service']);

function isAdminUser(roles: string[]): boolean {
  return roles.includes('Admin');
}

function hasSalesManagerRole(roles: unknown): boolean {
  if (Array.isArray(roles)) {
    return roles.some((role) => SALES_MANAGER_ROLE_TOKENS.has(String(role).trim().toLowerCase()));
  }
  if (typeof roles === 'string') {
    const normalized = roles.trim().toLowerCase();
    if (SALES_MANAGER_ROLE_TOKENS.has(normalized)) {
      return true;
    }
    return normalized
      .split(/[,\s|;]+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .some((token) => SALES_MANAGER_ROLE_TOKENS.has(token));
  }
  return false;
}

function normalizeCourseCategoryValue(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'offline';
  }
  if (CANONICAL_COURSE_CATEGORIES.has(normalized)) {
    return normalized;
  }
  if (normalized === 'ofline' || normalized === 'offlayn' || normalized === 'offline_course') {
    return 'offline';
  }
  if (normalized === 'onlayn' || normalized === 'online_course') {
    return 'online';
  }
  if (normalized === 'intensiv') {
    return 'intensive';
  }
  if (normalized === "qo'shimcha_xizmat" || normalized === 'qoshimcha_xizmat' || normalized === 'additional') {
    return 'additional_service';
  }
  return 'offline';
}

function extractErrorText(error: unknown): string {
  const message = String((error as any)?.message || '');
  const cause = String((error as any)?.cause || '');
  let serialized = '';
  try {
    serialized = JSON.stringify(error);
  } catch {
    serialized = '';
  }
  return `${message}\n${cause}\n${serialized}`.toLowerCase();
}

function isMissingCourseCategoryColumnError(error: unknown): boolean {
  const message = extractErrorText(error);
  return (
    (message.includes('courses.category') || message.includes('course.category') || message.includes(' category '))
    && (message.includes('does not exist') || message.includes('unknown') || message.includes('column'))
  );
}

function isMissingCourseHiddenFromIncomeFormColumnError(error: unknown): boolean {
  const message = extractErrorText(error);
  return (
    (message.includes('courses.ishiddenfromincomeform') || message.includes('ishiddenfromincomeform'))
    && (message.includes('does not exist') || message.includes('unknown') || message.includes('column'))
  );
}

function isMissingCourseStartDateColumnError(error: unknown): boolean {
  const message = extractErrorText(error);
  return (
    message.includes('courses.startdate')
    || message.includes('course.startdate')
    || message.includes('"startdate"')
    || message.includes(' startdate ')
    || message.includes('`startdate`')
  );
}

function isMissingCourseEndDateColumnError(error: unknown): boolean {
  const message = extractErrorText(error);
  return (
    message.includes('courses.enddate')
    || message.includes('course.enddate')
    || message.includes('"enddate"')
    || message.includes(' enddate ')
    || message.includes('`enddate`')
  );
}

function isMissingSubTariffSchemaError(error: unknown): boolean {
  const message = extractErrorText(error);
  return (
    (
      message.includes('sub_tariffs')
      || message.includes('subtariff')
      || message.includes('subtariffid')
    )
    && (
      message.includes('does not exist')
      || message.includes('unknown')
      || message.includes('column')
    )
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

function extractSaleSubTariffId(meta: Prisma.JsonValue | null | undefined): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return null;
  }
  const candidate = (meta as Record<string, unknown>)[SALE_SUB_TARIFF_META_KEY];
  if (typeof candidate !== 'string') {
    return null;
  }
  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveManagerLabel(
  manager: { id?: string | null; name?: string | null; username?: string | null } | null | undefined,
  fallbackId?: string | null,
): string {
  const candidate = manager?.name || manager?.username || manager?.id || fallbackId || null;
  return candidate ? String(candidate) : '-';
}

function withSaleSubTariffMeta(
  existingMeta: Prisma.JsonValue | null | undefined,
  subTariffId: string | null,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  const nextMeta: Record<string, unknown> = (
    existingMeta
    && typeof existingMeta === 'object'
    && !Array.isArray(existingMeta)
  )
    ? { ...(existingMeta as Record<string, unknown>) }
    : {};

  if (subTariffId) {
    nextMeta[SALE_SUB_TARIFF_META_KEY] = subTariffId;
  } else {
    delete nextMeta[SALE_SUB_TARIFF_META_KEY];
  }

  return Object.keys(nextMeta).length > 0 ? (nextMeta as Prisma.InputJsonValue) : Prisma.JsonNull;
}

async function buildActiveSaleChainMetrics(params: {
  tenantId: string;
  sales: SaleChainSaleRow[];
}) {
  if (params.sales.length === 0) {
    return new Map<string, {
      agreementAmount: number;
      paidAmount: number;
      currentDebtAmount: number;
      lastActivityAt: Date;
    }>();
  }

  const saleIds = params.sales.map((sale) => sale.id);
  const chainRows = await prisma.income.findMany({
    where: {
      tenantId: params.tenantId,
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      OR: [
        { id: { in: saleIds } },
        { relatedDebtIncomeId: { in: saleIds } },
      ],
    },
    select: {
      id: true,
      relatedDebtIncomeId: true,
      paymentAmount: true,
      entryDate: true,
    },
  });

  return buildSaleChainMetricsBySaleId({
    sales: params.sales,
    chainRows,
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

async function refreshCustomerProfileFromLatestActiveSale(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    customerId: string;
  },
): Promise<void> {
  const latestActiveSale = await tx.income.findFirst({
    where: {
      tenantId: params.tenantId,
      customerId: params.customerId,
      type: 'new_sale',
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
    },
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      courseId: true,
      tariffId: true,
    },
  });

  if (!latestActiveSale) {
    await tx.customer.update({
      where: { id: params.customerId },
      data: {
        profileCourseId: null,
        profileTariffId: null,
        profileSubTariffId: null,
      },
    });
    return;
  }

  let nextSubTariffId: string | null = null;
  if (latestActiveSale.tariffId) {
    const customer = await tx.customer.findUnique({
      where: { id: params.customerId },
      select: { profileSubTariffId: true },
    });

    if (customer?.profileSubTariffId) {
      const subTariff = await tx.subTariff.findFirst({
        where: {
          tenantId: params.tenantId,
          id: customer.profileSubTariffId,
          tariffId: latestActiveSale.tariffId,
          isActive: true,
        },
        select: { id: true },
      });
      nextSubTariffId = subTariff?.id || null;
    }
  }

  await tx.customer.update({
    where: { id: params.customerId },
    data: {
      profileCourseId: latestActiveSale.courseId ?? null,
      profileTariffId: latestActiveSale.tariffId ?? null,
      profileSubTariffId: nextSubTariffId,
    },
  });
}

async function normalizeSaleChainChronology(tx: Prisma.TransactionClient, params: {
  tenantId: string;
  saleId: string;
}): Promise<{ didReorder: boolean; canonicalSaleId: string; reorderedIncomeIds: string[] }> {
  const sourceSale = await tx.income.findFirst({
    where: {
      id: params.saleId,
      tenantId: params.tenantId,
      type: 'new_sale',
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
    },
    select: {
      id: true,
      customerId: true,
      managerUserId: true,
      courseId: true,
      tariffId: true,
      entryDate: true,
      createdAt: true,
      deadline: true,
      coursePriceAmount: true,
      debtAmount: true,
      legacyImportMeta: true,
      paymentAmount: true,
    },
  });

  if (!sourceSale) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Source sale not found for chronology normalization.',
    });
  }

  const activeRepayments = await tx.income.findMany({
    where: {
      tenantId: params.tenantId,
      type: 'repayment',
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      relatedDebtIncomeId: sourceSale.id,
    },
    select: {
      id: true,
      managerUserId: true,
      entryDate: true,
      createdAt: true,
      deadline: true,
      paymentAmount: true,
    },
  });

  if (activeRepayments.length === 0) {
    return {
      didReorder: false,
      canonicalSaleId: sourceSale.id,
      reorderedIncomeIds: [],
    };
  }

  const chain = [
    {
      ...sourceSale,
      type: 'new_sale' as const,
    },
    ...activeRepayments.map((repayment) => ({
      ...repayment,
      type: 'repayment' as const,
    })),
  ].sort((a, b) => {
    const byDate = a.entryDate.getTime() - b.entryDate.getTime();
    if (byDate !== 0) {
      return byDate;
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const earliestRow = chain[0]!;
  const shouldReorder = (
    earliestRow.id !== sourceSale.id
    && earliestRow.type === 'repayment'
    && earliestRow.entryDate.getTime() < sourceSale.entryDate.getTime()
  );

  if (!shouldReorder) {
    return {
      didReorder: false,
      canonicalSaleId: sourceSale.id,
      reorderedIncomeIds: [],
    };
  }

  const sourceSaleSubTariffId = extractSaleSubTariffId(sourceSale.legacyImportMeta);
  const preservedSaleMeta = withSaleSubTariffMeta(sourceSale.legacyImportMeta, sourceSaleSubTariffId);
  const sourceAgreementAmount = Number(sourceSale.coursePriceAmount ?? sourceSale.debtAmount ?? 0);
  const totalPaid = chain.reduce((sum, row) => sum + Math.max(Number(row.paymentAmount || 0), 0), 0);
  const agreementAmount = sourceAgreementAmount > 0 ? sourceAgreementAmount : totalPaid;
  const canonicalSaleId = earliestRow.id;

  let rollingDebt = Math.max(agreementAmount - Math.max(Number(earliestRow.paymentAmount || 0), 0), 0);

  await tx.income.update({
    where: { id: canonicalSaleId },
    data: {
      type: 'new_sale',
      relatedDebtIncomeId: null,
      managerUserId: sourceSale.managerUserId,
      courseId: sourceSale.courseId,
      tariffId: sourceSale.tariffId,
      coursePriceAmount: agreementAmount,
      debtAmount: agreementAmount,
      remainingDebtAmount: rollingDebt,
      deadline: rollingDebt > 0 ? sourceSale.deadline : null,
      legacyImportMeta: preservedSaleMeta,
    },
  });

  for (const repayment of chain.slice(1)) {
    const debtAmount = rollingDebt;
    rollingDebt = Math.max(debtAmount - Math.max(Number(repayment.paymentAmount || 0), 0), 0);

    await tx.income.update({
      where: { id: repayment.id },
      data: {
        type: 'repayment',
        relatedDebtIncomeId: canonicalSaleId,
        courseId: sourceSale.courseId,
        tariffId: sourceSale.tariffId,
        coursePriceAmount: null,
        debtAmount,
        remainingDebtAmount: rollingDebt,
        legacyImportMeta: Prisma.JsonNull,
      },
    });
  }

  await refreshCustomerProfileFromLatestActiveSale(tx, {
    tenantId: params.tenantId,
    customerId: sourceSale.customerId,
  });

  return {
    didReorder: true,
    canonicalSaleId,
    reorderedIncomeIds: chain.map((row) => row.id),
  };
}

async function assertSaleChainDebtInvariant(tx: Prisma.TransactionClient, params: {
  tenantId: string;
  saleId: string;
}): Promise<void> {
  const recomputeSaleChainDebtFields = async (saleId: string) => {
    const sourceSale = await tx.income.findFirst({
      where: {
        id: saleId,
        tenantId: params.tenantId,
        type: 'new_sale',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      },
      select: {
        id: true,
        paymentAmount: true,
        coursePriceAmount: true,
        debtAmount: true,
        deadline: true,
      },
    });
    if (!sourceSale) {
      return false;
    }

    const repayments = await tx.income.findMany({
      where: {
        tenantId: params.tenantId,
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        type: 'repayment',
        relatedDebtIncomeId: sourceSale.id,
      },
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        paymentAmount: true,
      },
    });

    const agreementAmount = getSaleAgreementAmount(sourceSale);
    let rollingDebt = Math.max(agreementAmount - Math.max(Number(sourceSale.paymentAmount || 0), 0), 0);

    for (const repayment of repayments) {
      const debtAmount = rollingDebt;
      rollingDebt = Math.max(debtAmount - Math.max(Number(repayment.paymentAmount || 0), 0), 0);
      await tx.income.update({
        where: { id: repayment.id },
        data: {
          debtAmount,
          remainingDebtAmount: rollingDebt,
          relatedDebtIncomeId: sourceSale.id,
        },
      });
    }

    await tx.income.update({
      where: { id: sourceSale.id },
      data: {
        debtAmount: agreementAmount,
        remainingDebtAmount: rollingDebt,
        deadline: rollingDebt > 0 ? sourceSale.deadline : null,
      },
    });

    return true;
  };

  const loadConsistency = async (saleId: string) => {
    const sale = await tx.income.findFirst({
      where: {
        id: saleId,
        tenantId: params.tenantId,
        type: 'new_sale',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      },
      select: {
        id: true,
        coursePriceAmount: true,
        debtAmount: true,
        paymentAmount: true,
      },
    });
    if (!sale) {
      return null;
    }

    const chainRows = await tx.income.findMany({
      where: {
        tenantId: params.tenantId,
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        OR: [
          { id: sale.id },
          { relatedDebtIncomeId: sale.id },
        ],
      },
      select: {
        id: true,
        type: true,
        relatedDebtIncomeId: true,
        paymentAmount: true,
        entryDate: true,
        createdAt: true,
        debtAmount: true,
        remainingDebtAmount: true,
      },
    });
    const agreementAmount = getSaleAgreementAmount(sale);
    const consistency = evaluateSaleChainConsistency({
      saleId: sale.id,
      agreementAmount,
      chainRows,
    });
    return { sale, consistency };
  };

  let loaded = await loadConsistency(params.saleId);
  if (!loaded) {
    return;
  }
  let { sale, consistency } = loaded;

  if (!consistency.ok) {
    const shouldAutoRepair = consistency.issues.some((issue) => (
      issue === 'sale_debt_amount_mismatch'
      || issue === 'sale_remaining_mismatch'
      || issue === 'repayment_debt_amount_mismatch'
      || issue === 'repayment_remaining_mismatch'
    ));

    let repaired = false;
    if (shouldAutoRepair) {
      repaired = await recomputeSaleChainDebtFields(sale.id);
      if (repaired) {
        loaded = await loadConsistency(sale.id);
        if (loaded) {
          sale = loaded.sale;
          consistency = loaded.consistency;
        }
      }
    }

    if (consistency.ok) {
      return;
    }

    const invariantDebug = {
      saleId: sale.id,
      expectedDebt: consistency.expectedCurrentDebtAmount,
      storedSaleDebt: consistency.actualSaleRemainingDebtAmount,
      chainRows: consistency.chainLength,
      repaired,
    };
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: `Debt invariant mismatch after mutation: ${consistency.issues.join(', ')} | debug=${JSON.stringify(invariantDebug)}`,
    });
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
  startDate: Date | null;
  endDate: Date | null;
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
        startDate: true,
        endDate: true,
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

    return (courses as CourseWithTariffsSafe[]).map((course) => ({
      ...course,
      category: normalizeCourseCategoryValue(course.category),
    }));
  } catch (error) {
    const missingCategoryColumn = isMissingCourseCategoryColumnError(error);
    const missingHiddenColumn = isMissingCourseHiddenFromIncomeFormColumnError(error);
    const missingStartDateColumn = isMissingCourseStartDateColumnError(error);
    const missingEndDateColumn = isMissingCourseEndDateColumnError(error);
    if (!missingCategoryColumn && !missingHiddenColumn && !missingStartDateColumn && !missingEndDateColumn) {
      throw error;
    }

    const fallbackCourses = await prisma.course.findMany({
      where: baseWhere,
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
      category: normalizeCourseCategoryValue(null),
      startDate: null,
      endDate: null,
      isHiddenFromIncomeForm: false,
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
    return (courses as Array<{ id: string; name: string; category: string }>).map((course) => ({
      ...course,
      category: normalizeCourseCategoryValue(course.category),
    }));
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
      category: normalizeCourseCategoryValue(null),
    }));
  }
}

function isAgentOnly(roles: string[]): boolean {
  return roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));
}

function shouldSelfScopeManagerActions(roles: string[]): boolean {
  return isAgentOnly(roles);
}

function isPrivilegedAdjustmentViewer(roles: string[]): boolean {
  return roles.some((role) => (
    role === 'Admin'
    || role === 'Manager'
    || role === 'Finance'
    || role === 'Organizator'
    || role === 'Organizer'
    || role === 'Tashkiliy'
  ));
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
    || roles.includes('TeamLeader')
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

function parseCustomDateInReportTimezone(input: string, endOfDay: boolean): Date {
  const value = String(input || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid date format: ${input}` });
  }
  const timestamp = `${value}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+05:00`;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid date: ${input}` });
  }
  return date;
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

function buildRefundDetailsBlock(params: {
  customerName: string;
  customerNumber: string;
  telegramUsername?: string | null;
  amount: number;
  courseName?: string | null;
  tariffName?: string | null;
  requesterLabel?: string | null;
  reviewerLabel?: string | null;
  createdAt?: Date | null;
  reviewedAt?: Date | null;
  reason?: string | null;
  reviewNote?: string | null;
}): string {
  const tg = params.telegramUsername
    ? (params.telegramUsername.startsWith('@') ? params.telegramUsername : `@${params.telegramUsername}`)
    : '-';
  const details = [
    `1.Mijoz: ${params.customerName}`,
    `2.Tel: ${params.customerNumber}`,
    `3.Tg: ${tg}`,
    '',
    `Summa: ${formatAmountUz(params.amount)}`,
    `Kurs/Tarif: ${[params.courseName, params.tariffName].filter(Boolean).join(' / ') || '-'}`,
    ...(params.requesterLabel ? [`So'rov yuborgan: ${params.requesterLabel}`] : []),
    ...(params.reviewerLabel ? [`Ko'rib chiqqan: ${params.reviewerLabel}`] : []),
    ...(params.createdAt ? [`So'rov vaqti: ${formatDateGmt5(params.createdAt)}`] : []),
    ...(params.reviewedAt ? [`Ko'rib chiqilgan vaqt: ${formatDateGmt5(params.reviewedAt)}`] : []),
    ...(params.reason ? [`Izoh: ${params.reason}`] : []),
    ...(params.reviewNote ? [`Javob izohi: ${params.reviewNote}`] : []),
  ];
  return details.join('\n');
}

async function sendMessageToTelegramChat(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const normalized = String(chatId || '').trim();
  if (!normalized) {
    throw new Error('Empty Telegram chat id');
  }

  const candidates = buildTelegramChatIdCandidates(normalized);
  let lastError = '';
  for (const candidate of candidates) {
    try {
      await telegramService.sendMessage(botToken, candidate, text, {
        disable_web_page_preview: true,
      });
      return;
    } catch (error) {
      lastError = String((error as any)?.message || error);
    }
  }

  throw new Error(lastError || 'Failed to send Telegram message');
}

async function notifyFinanceUsersRefundRequested(params: {
  tenantId: string;
  requestId: string;
  requestedByUserId: string;
}) {
  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId);
  if (!botToken) {
    return;
  }

  const [request, financeUsers] = await Promise.all([
    prisma.incomeAdjustmentRequest.findFirst({
      where: {
        id: params.requestId,
        tenantId: params.tenantId,
        type: ADJUSTMENT_TYPE_REFUND,
        status: ADJUSTMENT_STATUS_PENDING,
      },
      select: {
        requestedAmount: true,
        reason: true,
        createdAt: true,
        requestedBy: {
          select: {
            name: true,
            username: true,
          },
        },
        income: {
          select: {
            paymentAmount: true,
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
            customer: {
              select: {
                name: true,
                customerNumber: true,
                telegramUsername: true,
              },
            },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        tenantId: params.tenantId,
        isActive: true,
        roles: {
          has: 'Finance',
        },
        telegramId: {
          not: null,
        },
      },
      select: {
        id: true,
        telegramId: true,
      },
    }),
  ]);

  if (!request?.income?.customer || financeUsers.length === 0) {
    return;
  }

  const requesterLabel = request.requestedBy?.name || request.requestedBy?.username || params.requestedByUserId;
  const details = buildRefundDetailsBlock({
    customerName: request.income.customer.name,
    customerNumber: request.income.customer.customerNumber,
    telegramUsername: request.income.customer.telegramUsername || null,
    amount: request.requestedAmount ?? request.income.paymentAmount ?? 0,
    courseName: request.income.course?.name || null,
    tariffName: request.income.tariff?.name || null,
    requesterLabel,
    createdAt: request.createdAt,
    reason: request.reason || null,
  });
  const message = `Pul qaytarish uchun yangi so'rov\n\n${details}`;

  for (const financeUser of financeUsers) {
    const chatId = String(financeUser.telegramId || '').trim();
    if (!chatId) {
      continue;
    }
    try {
      await sendMessageToTelegramChat(botToken, chatId, message);
    } catch (error) {
      console.error('[Income][Telegram] Failed to notify finance user about refund request', {
        tenantId: params.tenantId,
        requestId: params.requestId,
        financeUserId: financeUser.id,
        chatId,
        error: String((error as any)?.message || error),
      });
    }
  }
}

async function notifyRefundRequesterReviewResult(params: {
  tenantId: string;
  requestId: string;
  status: 'approved' | 'rejected';
}) {
  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId);
  if (!botToken) {
    return;
  }

  const request = await prisma.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_REFUND,
      status: params.status,
    },
    select: {
      requestedAmount: true,
      reason: true,
      reviewNote: true,
      createdAt: true,
      reviewedAt: true,
      requestedBy: {
        select: {
          id: true,
          name: true,
          username: true,
          telegramId: true,
        },
      },
      reviewedBy: {
        select: {
          name: true,
          username: true,
        },
      },
      income: {
        select: {
          paymentAmount: true,
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
          customer: {
            select: {
              name: true,
              customerNumber: true,
              telegramUsername: true,
            },
          },
        },
      },
    },
  });

  const requesterChatId = String(request?.requestedBy?.telegramId || '').trim();
  if (!request?.income?.customer || !requesterChatId) {
    return;
  }

  const reviewerLabel = request.reviewedBy?.name || request.reviewedBy?.username || null;
  const requesterLabel = request.requestedBy?.name || request.requestedBy?.username || request.requestedBy?.id || '-';
  const details = buildRefundDetailsBlock({
    customerName: request.income.customer.name,
    customerNumber: request.income.customer.customerNumber,
    telegramUsername: request.income.customer.telegramUsername || null,
    amount: request.requestedAmount ?? request.income.paymentAmount ?? 0,
    courseName: request.income.course?.name || null,
    tariffName: request.income.tariff?.name || null,
    requesterLabel,
    reviewerLabel,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
    reason: request.reason || null,
    reviewNote: request.reviewNote || null,
  });

  const header = params.status === 'approved'
    ? '✅ Pul qaytarildi'
    : '❌ Qaytarish rad etildi';
  const message = `${header}\n\n${details}`;

  try {
    await sendMessageToTelegramChat(botToken, requesterChatId, message);
  } catch (error) {
    console.error('[Income][Telegram] Failed to notify requester about refund review result', {
      tenantId: params.tenantId,
      requestId: params.requestId,
      requesterUserId: request.requestedBy?.id || null,
      chatId: requesterChatId,
      status: params.status,
      error: String((error as any)?.message || error),
    });
  }
}

function canSelectInactiveManagerForIncome(roles: string[]): boolean {
  return roles.some((role) => role === 'Admin' || role === 'Finance' || role === 'TeamLeader');
}

async function assertManagerBelongsToTenantWithOptions(params: {
  tenantId: string;
  managerUserId: string;
  includeInactive: boolean;
}) {
  const manager = await prisma.user.findFirst({
    where: {
      id: params.managerUserId,
      tenantId: params.tenantId,
      ...(params.includeInactive ? {} : { isActive: true }),
    },
    select: {
      id: true,
      roles: true,
    },
  });

  if (!manager || !hasSalesManagerRole(manager.roles)) {
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
      },
      select: {
        id: true,
        name: true,
        username: true,
        roles: true,
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

  const managerRows = managers as Array<{
    id: string;
    name: string | null;
    username: string | null;
    roles: string[];
  }>;
  const availableManagersFiltered = managerRows.filter((manager) => hasSalesManagerRole(manager.roles));
  const availableManagers = availableManagersFiltered.length > 0 ? availableManagersFiltered : managerRows;

  for (const manager of availableManagers) {
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
  requesterRoles?: string[];
  writeAuditLog?: boolean;
  allowHiddenCourseSelection?: boolean;
  skipTelegramNotification?: boolean;
}) {
  const {
    tenantId,
    userId,
    input,
    requesterRoles = [],
    writeAuditLog = true,
    allowHiddenCourseSelection = false,
    skipTelegramNotification = false,
  } = params;

  await assertManagerBelongsToTenantWithOptions({
    tenantId,
    managerUserId: input.managerUserId,
    includeInactive: canSelectInactiveManagerForIncome(requesterRoles),
  });
  const entryDate = parseDateInput(input.entryDate);
  if (entryDate > new Date()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: "Kelajakdagi sana kiritish mumkin emas. Bugungi yoki o'tgan sanani tanlang." });
  }
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
  let chronologyReordered = false;
  let chronologyCanonicalSaleId: string | null = null;
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

    const [course, tariff, activeSubTariffCount] = await Promise.all([
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
      prisma.subTariff.count({
        where: {
          tenantId,
          tariffId: input.tariffId,
          isActive: true,
        },
      }),
    ]);

    if (!course || !tariff) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course or tariff not found.' });
    }

    if (activeSubTariffCount > 0 && !input.subTariffId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Sub-tariff is required for the selected tariff.',
      });
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
    createdIncome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const createdSale = await tx.income.create({
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
          legacyImportMeta: selectedSubTariffId
            ? ({ [SALE_SUB_TARIFF_META_KEY]: selectedSubTariffId } as Prisma.InputJsonValue)
            : undefined,
        },
      });

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          profileSubTariffId: selectedSubTariffId || null,
        },
      });

      await refreshCustomerProfileFromLatestActiveSale(tx, {
        tenantId,
        customerId: customer.id,
      });
      await assertSaleChainDebtInvariant(tx, {
        tenantId,
        saleId: createdSale.id,
      });

      return createdSale;
    }, {
      // Keep transaction alive for chain normalization/invariant checks on busy tenants.
      maxWait: 10_000,
      timeout: 30_000,
    });
  } else {
    let debtSourceId = input.debtSourceIncomeId;
    if (!debtSourceId) {
      const candidateDebts = await prisma.income.findMany({
        where: {
          tenantId,
          customerId: customer.id,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        take: 200,
        select: {
          id: true,
          entryDate: true,
          coursePriceAmount: true,
          debtAmount: true,
          paymentAmount: true,
        },
      });
      const candidateMetrics = await buildActiveSaleChainMetrics({
        tenantId,
        sales: candidateDebts,
      });
      const latestDebt = candidateDebts.find((sale) => (candidateMetrics.get(sale.id)?.currentDebtAmount ?? 0) > 0);
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
      },
      select: {
        id: true,
        customerId: true,
        courseId: true,
        tariffId: true,
        entryDate: true,
        coursePriceAmount: true,
        debtAmount: true,
        paymentAmount: true,
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

    const sourceMetrics = await buildActiveSaleChainMetrics({
      tenantId,
      sales: [debtSource],
    });
    const sourceCurrentDebt = sourceMetrics.get(debtSource.id)?.currentDebtAmount ?? debtSource.remainingDebtAmount;

    if (sourceCurrentDebt <= 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Selected debt source has no remaining debt.',
      });
    }

    if (input.paymentAmount > sourceCurrentDebt) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Repayment amount cannot exceed the selected debt.',
      });
    }

    const remainingDebtAmount = Math.max(sourceCurrentDebt - input.paymentAmount, 0);
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
          debtAmount: sourceCurrentDebt,
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

      const normalized = await normalizeSaleChainChronology(tx, {
        tenantId,
        saleId: debtSource.id,
      });
      if (normalized.didReorder) {
        chronologyReordered = true;
        chronologyCanonicalSaleId = normalized.canonicalSaleId;
      }
      await assertSaleChainDebtInvariant(tx, {
        tenantId,
        saleId: chronologyCanonicalSaleId || debtSource.id,
      });

      const refreshedRepayment = await tx.income.findUnique({
        where: { id: repayment.id },
      });
      return refreshedRepayment ?? repayment;
    }, {
      // Repayment flow can touch long chains; avoid premature interactive transaction close.
      maxWait: 10_000,
      timeout: 30_000,
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
          ...(chronologyReordered
            ? {
                mode: 'income_chain_reordered_by_date',
                canonicalSaleIncomeId: chronologyCanonicalSaleId,
              }
            : {}),
        },
      },
    });

    if (skipTelegramNotification) {
      telegramDispatch = {
        attempted: false,
        delivered: false,
        sentCount: 0,
        failedCount: 0,
        reason: 'skipped_by_admin',
      };
    } else {
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
  }

  return {
    income: createdIncome,
    customerNumber: customer.customerNumber,
    telegramDispatch,
    chronologyDebug: {
      incomeChainReorderedByDate: chronologyReordered,
      canonicalSaleIncomeId: chronologyCanonicalSaleId,
    },
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
  subTariffId: z.string().uuid().nullable().optional(),
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
    const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;
    const includeInactiveManagers = canSelectInactiveManagerForIncome(ctx.user.roles);

    const [managersInitial, customers, outstandingDebts] = await Promise.all([
      prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(includeInactiveManagers ? {} : { isActive: true }),
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
          isActive: true,
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
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
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
          entryDate: true,
          coursePriceAmount: true,
          debtAmount: true,
          paymentAmount: true,
          remainingDebtAmount: true,
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

    let managers = managersInitial;
    if ((managersInitial as Array<unknown>).length === 0) {
      managers = await prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(includeInactiveManagers ? {} : { isActive: true }),
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
          isActive: true,
        },
      });
    }

    let courses: Array<{
      id: string;
      name: string;
      category: string;
      tariffs: Array<{
        id: string;
        name: string;
        subTariffs: Array<{ id: string; name: string }>;
      }>;
    }> = [];

    try {
      courses = await fetchCoursesWithTariffsSafe({
        tenantId: ctx.tenantId,
        onlyActive: true,
        excludeHiddenFromIncomeForm: true,
      });
    } catch (courseError) {
      console.error('[Income/FormOptions] Failed to load courses, returning empty course list:', courseError);
      courses = [];
    }
    const outstandingDebtMetricsBySaleId = await buildActiveSaleChainMetrics({
      tenantId: ctx.tenantId,
      sales: outstandingDebts as SaleChainSaleRow[],
    });

    const responsibleManagerMap = await fetchLatestResponsibleManagerByCustomer({
      tenantId: ctx.tenantId,
      customerIds: (customers as Array<{ id: string }>).map((customer) => customer.id),
      scopedManagerUserId,
    });

    const managerRows = managers as Array<{
      id: string;
      name: string | null;
      username: string | null;
      roles: string[];
      isActive: boolean;
    }>;
    const availableManagersFiltered = managerRows.filter((manager) => hasSalesManagerRole(manager.roles));
    const availableManagers = availableManagersFiltered.length > 0 ? availableManagersFiltered : managerRows;

    const managerOptions = availableManagers.map((manager) => ({
      id: manager.id,
      label: `${manager.name || manager.username || manager.id}${manager.isActive === false ? ' (Nofaol)' : ''}`,
      roles: manager.roles,
    }));
    const managersForResponse = managerOptions.length > 0
      ? managerOptions
      : [
          {
            id: ctx.user.userId,
            label: ctx.user.userId,
            roles: Array.isArray(ctx.user.roles) ? ctx.user.roles : [],
          },
        ];

    return {
      managers: managersForResponse,
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
        entryDate: Date;
        coursePriceAmount: number | null;
        remainingDebtAmount: number;
        debtAmount: number | null;
        paymentAmount: number;
        customer: { customerNumber: string; name: string };
        course: { name: string } | null;
        tariff: { name: string } | null;
      }>)
        .filter((debt) => (outstandingDebtMetricsBySaleId.get(debt.id)?.currentDebtAmount ?? debt.remainingDebtAmount) > 0)
        .map((debt) => ({
        id: debt.id,
        remainingDebtAmount: outstandingDebtMetricsBySaleId.get(debt.id)?.currentDebtAmount ?? debt.remainingDebtAmount,
        debtAmount: outstandingDebtMetricsBySaleId.get(debt.id)?.agreementAmount
          ?? getSaleAgreementAmount(debt),
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
      const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;
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
          profileCourseId: true,
          profileTariffId: true,
          profileSubTariffId: true,
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

  customerOutstandingDebts: protectedProcedure
    .input(
      z.object({
        customerNumber: z.string().min(1).max(64),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;
      const normalizedCustomerNumber = input.customerNumber.replace(/\D/g, '').trim();

      if (!normalizedCustomerNumber) {
        return [];
      }

      const debts = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          customer: {
            customerNumber: normalizedCustomerNumber,
          },
          ...(scopedManagerUserId
            ? {
                managerUserId: scopedManagerUserId,
              }
            : {}),
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        take: 200,
        select: {
          id: true,
          entryDate: true,
          coursePriceAmount: true,
          paymentAmount: true,
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
      });
      const debtMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: debts as SaleChainSaleRow[],
      });

      return debts
        .filter((debt) => (debtMetricsBySaleId.get(debt.id)?.currentDebtAmount ?? debt.remainingDebtAmount) > 0)
        .map((debt) => ({
        id: debt.id,
        remainingDebtAmount: debtMetricsBySaleId.get(debt.id)?.currentDebtAmount ?? debt.remainingDebtAmount,
        debtAmount: debtMetricsBySaleId.get(debt.id)?.agreementAmount ?? getSaleAgreementAmount(debt),
        customerNumber: debt.customer.customerNumber,
        customerName: debt.customer.name,
        courseName: debt.course?.name || null,
        tariffName: debt.tariff?.name || null,
      }));
    }),

  createCourse: managerProcedure
    .input(createCourseSchema)
    .mutation(async ({ ctx, input }) => {
      const name = input.name.trim();
      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course name is required.' });
      }
      const startDate = input.startDate ? parseDateInput(input.startDate) : null;
      const endDate = input.endDate ? parseDateInput(input.endDate) : null;
      if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Course end date must be same or later than start date.',
        });
      }

      await ensureAdditionalServiceCategoryReady(input.category);

      const upsertCourse = (params: { withCategory: boolean; withDates: boolean }) => prisma.course.upsert({
        where: {
          tenantId_name: {
            tenantId: ctx.tenantId,
            name,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          name,
          ...(params.withCategory ? { category: input.category } : {}),
          ...(params.withDates ? { startDate, endDate } : {}),
          isActive: true,
        },
        update: {
          ...(params.withCategory ? { category: input.category } : {}),
          ...(params.withDates ? { startDate, endDate } : {}),
          isActive: true,
        },
      });

      try {
        return await upsertCourse({ withCategory: true, withDates: true });
      } catch (error) {
        let normalizedError = error;
        if (isCourseCategoryConstraintOutdatedError(error)) {
          try {
            await ensureCourseCategoryConstraintSupportsAdditionalService();
            return await upsertCourse({ withCategory: true, withDates: true });
          } catch (retryError) {
            normalizedError = retryError;
            if (isCourseCategoryConstraintOutdatedError(retryError)) {
              throwCourseCategoryMigrationError();
            }
          }
        }
        const missingCategoryColumn = isMissingCourseCategoryColumnError(normalizedError);
        const missingStartDateColumn = isMissingCourseStartDateColumnError(normalizedError);
        const missingEndDateColumn = isMissingCourseEndDateColumnError(normalizedError);
        if (!missingCategoryColumn && !missingStartDateColumn && !missingEndDateColumn) {
          throw normalizedError;
        }

        return upsertCourse({
          withCategory: !missingCategoryColumn,
          withDates: !missingStartDateColumn && !missingEndDateColumn,
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
    try {
      return await fetchCoursesWithTariffsSafe({
        tenantId: ctx.tenantId,
        onlyActive: false,
      });
    } catch (error) {
      const errorText = extractErrorText(error);
      const hasMissingCourseColumn =
        errorText.includes('does not exist')
        && errorText.includes('courses.')
        && (
          errorText.includes('courses.category')
          || errorText.includes('courses.startdate')
          || errorText.includes('courses.enddate')
          || errorText.includes('courses.ishiddenfromincomeform')
        );
      if (!hasMissingCourseColumn) {
        throw error;
      }

      const fallbackCourses = await prisma.course.findMany({
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

      return fallbackCourses.map((course) => ({
        ...course,
        category: 'offline',
        startDate: null,
        endDate: null,
        isHiddenFromIncomeForm: false,
      }));
    }
  }),

  updateCourse: managerProcedure
    .input(
      z.object({
        courseId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        category: z.enum(COURSE_CATEGORY_VALUES).optional(),
        startDate: z.string().optional().nullable(),
        endDate: z.string().optional().nullable(),
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
        startDate?: Date | null;
        endDate?: Date | null;
        isActive?: boolean;
        isHiddenFromIncomeForm?: boolean;
      } = {};
      if (typeof input.name === 'string') {
        data.name = input.name.trim();
      }
      if (typeof input.category === 'string') {
        data.category = input.category;
      }
      if (input.startDate !== undefined) {
        data.startDate = input.startDate ? parseDateInput(input.startDate) : null;
      }
      if (input.endDate !== undefined) {
        data.endDate = input.endDate ? parseDateInput(input.endDate) : null;
      }
      if (
        data.startDate !== undefined
        && data.endDate !== undefined
        && data.startDate
        && data.endDate
        && data.endDate.getTime() < data.startDate.getTime()
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Course end date must be same or later than start date.',
        });
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

      const updateCourse = (updateData: typeof data) => prisma.course.update({
        where: { id: input.courseId },
        data: updateData,
      });

      try {
        return await updateCourse(data);
      } catch (error) {
        if (isCourseCategoryConstraintOutdatedError(error)) {
          try {
            await ensureCourseCategoryConstraintSupportsAdditionalService();
            return await updateCourse(data);
          } catch {
            throwCourseCategoryMigrationError();
          }
        }
        const missingCategoryColumn = isMissingCourseCategoryColumnError(error);
        const missingHiddenColumn = isMissingCourseHiddenFromIncomeFormColumnError(error);
        const missingStartDateColumn = isMissingCourseStartDateColumnError(error);
        const missingEndDateColumn = isMissingCourseEndDateColumnError(error);
        if (!missingCategoryColumn && !missingHiddenColumn && !missingStartDateColumn && !missingEndDateColumn) {
          throw error;
        }

        const fallbackData: typeof data = {
          ...data,
        };

        if (missingCategoryColumn) {
          delete fallbackData.category;
        }
        if (missingHiddenColumn) {
          delete fallbackData.isHiddenFromIncomeForm;
        }
        if (missingStartDateColumn) {
          delete fallbackData.startDate;
        }
        if (missingEndDateColumn) {
          delete fallbackData.endDate;
        }

        if (!Object.keys(fallbackData).length) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Course fields are unavailable until database migrations are applied.',
          });
        }

        return updateCourse(fallbackData);
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
      if (shouldSelfScopeManagerActions(ctx.user.roles) && input.managerUserId !== ctx.user.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can create income records only for yourself.',
        });
      }

      const isAdmin = isAdminUser(ctx.user.roles);
      const skipTelegramNotification = isAdmin && Boolean(input.skipTelegramNotification);

      const result = await createIncomeEntry({
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        input,
        requesterRoles: ctx.user.roles,
        skipTelegramNotification,
      });

      return {
        income: result.income,
        telegramDispatch: result.telegramDispatch,
        debug: result.chronologyDebug,
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
          legacyImportMeta: true,
          customer: {
            select: {
              profileCourseId: true,
              profileTariffId: true,
              profileSubTariffId: true,
            },
          },
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
      if (parsedEntryDate && parsedEntryDate > new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "Kelajakdagi sana kiritish mumkin emas. Bugungi yoki o'tgan sanani tanlang." });
      }
      const parsedDeadline = input.deadline === undefined
        ? undefined
        : (input.deadline === null ? null : parseDateInput(input.deadline));

      if (income.type === 'new_sale') {
        const linkedRepayments = await prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'repayment',
            relatedDebtIncomeId: income.id,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          },
          orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            entryDate: true,
            paymentAmount: true,
          },
        });

        const nextManagerUserId = input.managerUserId ?? income.managerUserId;
        await assertManagerBelongsToTenantWithOptions({
          tenantId: ctx.tenantId,
          managerUserId: nextManagerUserId,
          includeInactive: true,
        });

        const nextCourseId = input.courseId ?? income.courseId;
        const nextTariffId = input.tariffId ?? income.tariffId;
        const existingSaleSubTariffId = extractSaleSubTariffId(income.legacyImportMeta);
        const isProfileMatchingNextSelection = Boolean(
          income.customer?.profileCourseId
          && income.customer?.profileTariffId
          && income.customer.profileCourseId === nextCourseId
          && income.customer.profileTariffId === nextTariffId,
        );
        const profileFallbackSubTariffId = isProfileMatchingNextSelection
          ? (income.customer?.profileSubTariffId ?? null)
          : null;
        const requestedSubTariffId = input.subTariffId === undefined
          ? (existingSaleSubTariffId || profileFallbackSubTariffId)
          : input.subTariffId;
        const nextCoursePriceAmount = input.coursePriceAmount ?? income.coursePriceAmount ?? 0;
        const nextPaymentAmount = input.paymentAmount ?? income.paymentAmount;
        const totalRepaymentPaid = linkedRepayments.reduce((sum, repayment) => sum + Number(repayment.paymentAmount || 0), 0);
        const totalPaidForSale = nextPaymentAmount + totalRepaymentPaid;

        if (!nextCourseId || !nextTariffId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Course and tariff are required for a new sale.',
          });
        }

        if (nextCoursePriceAmount < totalPaidForSale) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Agreement amount cannot be less than total paid amount for this sale.",
          });
        }

        const [course, tariff, activeSubTariffCount] = await Promise.all([
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
          prisma.subTariff.count({
            where: {
              tenantId: ctx.tenantId,
              tariffId: nextTariffId,
              isActive: true,
            },
          }),
        ]);

        if (!course || !tariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course or tariff not found.' });
        }

        if (activeSubTariffCount > 0 && !requestedSubTariffId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Sub-tariff is required for the selected tariff.',
          });
        }

        let nextSubTariffId: string | null = null;
        if (requestedSubTariffId) {
          const subTariff = await prisma.subTariff.findFirst({
            where: {
              id: requestedSubTariffId,
              tenantId: ctx.tenantId,
              tariffId: nextTariffId,
              isActive: true,
            },
            select: { id: true },
          });

          if (!subTariff) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Sub-tariff not found for selected tariff.',
            });
          }
          nextSubTariffId = subTariff.id;
        }

        let rollingDebt = Math.max(nextCoursePriceAmount - nextPaymentAmount, 0);
        const repaymentDebtStates = linkedRepayments.map((repayment) => {
          const debtAmount = rollingDebt;
          const remainingDebtAmount = Math.max(debtAmount - Number(repayment.paymentAmount || 0), 0);
          rollingDebt = remainingDebtAmount;
          return {
            id: repayment.id,
            debtAmount,
            remainingDebtAmount,
          };
        });

        const sourceRemainingDebtAmount = rollingDebt;

        let chronologyReordered = false;
        let chronologyCanonicalSaleId: string | null = null;

        const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const updatedSale = await tx.income.update({
            where: { id: income.id },
            data: {
              managerUserId: nextManagerUserId,
              entryDate: parsedEntryDate ?? income.entryDate,
              deadline: sourceRemainingDebtAmount > 0
                ? (parsedDeadline !== undefined ? parsedDeadline : income.deadline)
                : null,
              courseId: nextCourseId,
              tariffId: nextTariffId,
              coursePriceAmount: nextCoursePriceAmount,
              debtAmount: nextCoursePriceAmount,
              paymentAmount: nextPaymentAmount,
              remainingDebtAmount: sourceRemainingDebtAmount,
              legacyImportMeta: withSaleSubTariffMeta(income.legacyImportMeta, nextSubTariffId),
            },
          });

          if (repaymentDebtStates.length > 0) {
            for (const repaymentState of repaymentDebtStates) {
              await tx.income.update({
                where: { id: repaymentState.id },
                data: {
                  courseId: nextCourseId,
                  tariffId: nextTariffId,
                  debtAmount: repaymentState.debtAmount,
                  remainingDebtAmount: repaymentState.remainingDebtAmount,
                },
              });
            }
          }

          await tx.customer.update({
            where: { id: income.customerId },
            data: {
              profileSubTariffId: nextSubTariffId,
            },
          });

          await refreshCustomerProfileFromLatestActiveSale(tx, {
            tenantId: ctx.tenantId,
            customerId: income.customerId,
          });

          if (linkedRepayments.length > 0) {
            const normalized = await normalizeSaleChainChronology(tx, {
              tenantId: ctx.tenantId,
              saleId: income.id,
            });
            if (normalized.didReorder) {
              chronologyReordered = true;
              chronologyCanonicalSaleId = normalized.canonicalSaleId;
              const refreshedIncome = await tx.income.findUnique({
                where: { id: income.id },
              });
              await assertSaleChainDebtInvariant(tx, {
                tenantId: ctx.tenantId,
                saleId: normalized.canonicalSaleId,
              });
              return refreshedIncome ?? updatedSale;
            }
          }

          await assertSaleChainDebtInvariant(tx, {
            tenantId: ctx.tenantId,
            saleId: chronologyCanonicalSaleId || income.id,
          });

          return updatedSale;
        }, {
          // Income edit can trigger chain normalization + full debt recompute.
          // Keep transaction open long enough to prevent "Transaction not found".
          maxWait: 15000,
          timeout: 60000,
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
              mode: chronologyReordered
                ? 'income_chain_reordered_by_date'
                : 'new_sale',
              ...(chronologyReordered
                ? { canonicalSaleIncomeId: chronologyCanonicalSaleId }
                : {}),
            },
          },
        });

        return {
          success: true,
          income: updated,
          debug: {
            incomeChainReorderedByDate: chronologyReordered,
            canonicalSaleIncomeId: chronologyCanonicalSaleId,
          },
        };
      }

      if (
        input.courseId !== undefined
        || input.tariffId !== undefined
        || input.subTariffId !== undefined
        || input.coursePriceAmount !== undefined
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Repayment rows do not support course or tariff edits.',
        });
      }

      const nextManagerUserId = input.managerUserId ?? income.managerUserId;
      await assertManagerBelongsToTenantWithOptions({
        tenantId: ctx.tenantId,
        managerUserId: nextManagerUserId,
        includeInactive: true,
      });

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
          entryDate: true,
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

      let chronologyReordered = false;
      let chronologyCanonicalSaleId: string | null = null;

      const updatedRepayment = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.income.update({
          where: { id: sourceIncome.id },
          data: {
            remainingDebtAmount: nextSourceRemainingDebt,
          },
        });

        const updatedRow = await tx.income.update({
          where: { id: income.id },
          data: {
            managerUserId: nextManagerUserId,
            entryDate: parsedEntryDate ?? income.entryDate,
            deadline: parsedDeadline !== undefined ? parsedDeadline : income.deadline,
            debtAmount: sourceDebtAtRepaymentTime,
            paymentAmount: nextPaymentAmount,
            remainingDebtAmount: nextRepaymentRemainingDebt,
          },
        });

        const normalized = await normalizeSaleChainChronology(tx, {
          tenantId: ctx.tenantId,
          saleId: sourceIncome.id,
        });
        if (normalized.didReorder) {
          chronologyReordered = true;
          chronologyCanonicalSaleId = normalized.canonicalSaleId;
          const refreshedIncome = await tx.income.findUnique({
            where: { id: income.id },
          });
          await assertSaleChainDebtInvariant(tx, {
            tenantId: ctx.tenantId,
            saleId: normalized.canonicalSaleId,
          });
          return refreshedIncome ?? updatedRow;
        }

        await assertSaleChainDebtInvariant(tx, {
          tenantId: ctx.tenantId,
          saleId: sourceIncome.id,
        });

        return updatedRow;
      }, {
        // Repayment edit can trigger chronology normalize + chain invariant repair.
        maxWait: 15000,
        timeout: 60000,
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
            mode: chronologyReordered
              ? 'income_chain_reordered_by_date'
              : 'repayment',
            ...(chronologyReordered
              ? { canonicalSaleIncomeId: chronologyCanonicalSaleId }
              : {}),
          },
        },
      });

      return {
        success: true,
        income: updatedRepayment,
        debug: {
          incomeChainReorderedByDate: chronologyReordered,
          canonicalSaleIncomeId: chronologyCanonicalSaleId,
        },
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
    .mutation(async (): Promise<{ sessionId: string; preview: any }> => {
      throwIncomeImportDisabledByPolicy();
    }),

  getHistoricalImportProgress: adminProcedure
    .input(historicalImportSessionSchema)
    .query(async (): Promise<{
      status: string;
      preview: any;
      progress: {
        stage: string;
        message: string;
        processedRows: number;
        totalRows: number;
        processedIncomeRows: number;
        totalIncomeRows: number;
        processedCustomerRows: number;
        totalCustomerRows: number;
        importedRows: number;
        failedRows: number;
        importedNewSaleRows: number;
        importedRepaymentRows: number;
        createdCustomers: number;
        updatedCustomers: number;
        profileOnlyCustomers: number;
        skippedIncomeRows: number;
        skippedCustomerRows: number;
      } | null;
      failureReport: any[];
      errorMessage: string | null;
    }> => {
      throwIncomeImportDisabledByPolicy();
    }),

  cancelHistoricalImport: adminProcedure
    .input(historicalImportSessionSchema)
    .mutation(async (): Promise<{ ok: boolean }> => {
      throwIncomeImportDisabledByPolicy();
    }),

  executeHistoricalImport: adminProcedure
    .input(historicalImportSessionSchema)
    .mutation(async (): Promise<{ ok: boolean }> => {
      throwIncomeImportDisabledByPolicy();
    }),

  listIncomes: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(200).default(30),
          query: z.string().trim().max(120).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;
      const searchQuery = (input?.query || '').trim();
        const incomes = await prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
          ...(scopedManagerUserId
            ? {
                managerUserId: scopedManagerUserId,
              }
            : {}),
          ...(searchQuery
            ? {
                customer: {
                  OR: [
                    {
                      customerNumber: {
                        contains: searchQuery,
                        mode: 'insensitive',
                      },
                    },
                    {
                      name: {
                        contains: searchQuery,
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
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
              profileCourseId: true,
              profileTariffId: true,
              profileSubTariffId: true,
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

        const manualIncomeIds = incomes
          .filter((income) => !income.legacyImportSource)
          .map((income) => income.id);

        const auditLogs = manualIncomeIds.length
          ? await prisma.auditLog.findMany({
              where: {
                tenantId: ctx.tenantId,
                action: 'income_create',
                resource: 'income',
                resourceId: {
                  in: manualIncomeIds,
                },
              },
              orderBy: { createdAt: 'asc' },
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    username: true,
                    phone: true,
                    email: true,
                  },
                },
              },
            })
          : [];

        const createdByLabelByIncomeId = new Map<string, string>();
        for (const log of auditLogs) {
          if (!log.resourceId || createdByLabelByIncomeId.has(log.resourceId)) {
            continue;
          }
          const label = log.user?.name
            || log.user?.username
            || log.user?.phone
            || log.user?.email
            || 'qo‘lda';
          createdByLabelByIncomeId.set(log.resourceId, label);
        }
  
        return incomes.map((income) => {
          const saleSubTariffId = extractSaleSubTariffId(income.legacyImportMeta);
          const profileMatchedSubTariffId = (
            income.customer?.profileCourseId === income.courseId
            && income.customer?.profileTariffId === income.tariffId
          )
            ? (income.customer?.profileSubTariffId || null)
            : null;
          const effectiveSubTariffId = saleSubTariffId || profileMatchedSubTariffId || null;

          return {
            ...income,
            lifecycleStatus: getIncomeLifecycleLabel(income.lifecycleStatus),
            createdByLabel: income.legacyImportSource
              ? 'import'
              : (createdByLabelByIncomeId.get(income.id) || 'qo‘lda'),
            effectiveSubTariffId,
          };
        });
      }),

  exportIncomesByDateRange: adminProcedure
    .input(
      z.object({
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rangeStart = parseCustomDateInReportTimezone(input.dateFrom, false);
      const rangeEnd = parseCustomDateInReportTimezone(input.dateTo, true);

      if (rangeEnd < rangeStart) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas.",
        });
      }

      const totalCount = await prisma.income.count({
        where: {
          tenantId: ctx.tenantId,
          entryDate: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
      });

      if (totalCount > 20000) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Tanlangan davrda yozuvlar juda ko'p. Iltimos, kichikroq davr tanlang.",
        });
      }

      const incomes = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          entryDate: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          customer: {
            select: {
              customerNumber: true,
              name: true,
              telegramUsername: true,
              profileSubTariffId: true,
            },
          },
          manager: {
            select: {
              id: true,
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
        },
      });

      const subTariffIds = Array.from(
        new Set(
          incomes
            .map((income) => extractSaleSubTariffId(income.legacyImportMeta))
            .filter((id): id is string => Boolean(id)),
        ),
      );

      const subTariffNameById = new Map<string, string>();
      if (subTariffIds.length > 0) {
        const subTariffs = await prisma.subTariff.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: subTariffIds },
          },
          select: {
            id: true,
            name: true,
          },
        });
        for (const subTariff of subTariffs) {
          subTariffNameById.set(subTariff.id, subTariff.name);
        }
      }

      return {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        totalCount,
        rows: incomes.map((income) => {
          const saleSubTariffId = extractSaleSubTariffId(income.legacyImportMeta);
          const profileSubTariffId = income.customer?.profileSubTariffId || null;
          const subTariffId = saleSubTariffId || profileSubTariffId || null;
          const subTariffName = subTariffId ? subTariffNameById.get(subTariffId) || null : null;
          return {
            id: income.id,
            entryDate: income.entryDate,
            deadline: income.deadline,
            type: income.type,
            lifecycleStatus: getIncomeLifecycleLabel(income.lifecycleStatus),
            customerNumber: income.customer?.customerNumber || '',
            customerName: income.customer?.name || '',
            telegramUsername: income.customer?.telegramUsername || '',
            managerLabel: income.manager?.name || income.manager?.username || income.managerUserId || '',
            courseName: income.course?.name || '',
            tariffName: income.tariff?.name || '',
            subTariffName,
            agreementAmount: Number(income.coursePriceAmount ?? income.debtAmount ?? 0),
            paymentAmount: Number(income.paymentAmount ?? 0),
            remainingDebtAmount: Number(income.remainingDebtAmount ?? 0),
          };
        }),
      };
    }),

  listAdjustableIncomes: protectedProcedure
    .input(z.object({ customerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;

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
          profileCourseId: true,
          profileTariffId: true,
          profileSubTariffId: true,
        },
      });

      if (!customer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found.' });
      }

      const sales = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          customerId: customer.id,
          type: 'new_sale',
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

      const saleIds = sales.map((sale) => sale.id);
      const saleChainPayments = saleIds.length
        ? await prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              customerId: customer.id,
              paymentAmount: { gt: 0 },
              OR: [
                { id: { in: saleIds } },
                { relatedDebtIncomeId: { in: saleIds } },
              ],
              ...(scopedManagerUserId
                ? {
                    managerUserId: scopedManagerUserId,
                  }
                : {}),
            },
            select: {
              id: true,
              relatedDebtIncomeId: true,
              paymentAmount: true,
            },
          })
        : [];

      const paidBySaleId = new Map<string, number>();
      for (const payment of saleChainPayments) {
        const saleId = payment.relatedDebtIncomeId || payment.id;
        paidBySaleId.set(saleId, (paidBySaleId.get(saleId) ?? 0) + Number(payment.paymentAmount || 0));
      }

      return {
        customer,
        incomes: sales.map((sale) => ({
          ...sale,
          paymentAmount: paidBySaleId.get(sale.id) ?? Number(sale.paymentAmount || 0),
          lifecycleStatus: getIncomeLifecycleLabel(sale.lifecycleStatus),
          managerLabel: resolveManagerLabel(sale.manager),
          canCreateRequest: sale.lifecycleStatus === INCOME_LIFECYCLE_ACTIVE,
          canChangeTariff: sale.lifecycleStatus === INCOME_LIFECYCLE_ACTIVE,
        })),
      };
    }),

  customerPaymentHistory: protectedProcedure
    .input(z.object({ customerId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;
      const customerLookupValue = input.customerId.trim();

      if (!customerLookupValue) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Customer id is required.' });
      }

      const customerWhereBase: Prisma.CustomerWhereInput = {
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
      };

      let customer = await prisma.customer.findFirst({
        where: {
          ...customerWhereBase,
          id: customerLookupValue,
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

      if (!customer && CUSTOMER_NUMBER_REGEX.test(customerLookupValue)) {
        customer = await prisma.customer.findFirst({
          where: {
            ...customerWhereBase,
            customerNumber: customerLookupValue,
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
      }

      if (!customer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found.' });
      }

      const [courseSales, paymentHistory] = await Promise.all([
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            customerId: customer.id,
            type: 'new_sale',
            ...(scopedManagerUserId
              ? {
                  managerUserId: scopedManagerUserId,
                }
              : {}),
          },
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            type: true,
            lifecycleStatus: true,
            entryDate: true,
            coursePriceAmount: true,
            paymentAmount: true,
            remainingDebtAmount: true,
            legacyImportMeta: true,
            course: { select: { id: true, name: true } },
            tariff: { select: { id: true, name: true } },
            manager: { select: { id: true, name: true, username: true } },
          },
        }),
        prisma.income.findMany({
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
          select: {
            id: true,
            type: true,
            lifecycleStatus: true,
            entryDate: true,
            paymentAmount: true,
            remainingDebtAmount: true,
            relatedDebtIncomeId: true,
            legacyImportMeta: true,
            course: { select: { id: true, name: true } },
            tariff: { select: { id: true, name: true } },
            relatedDebtIncome: {
              select: {
                id: true,
                legacyImportMeta: true,
                course: { select: { id: true, name: true } },
                tariff: { select: { id: true, name: true } },
              },
            },
            manager: { select: { id: true, name: true, username: true } },
          },
        }),
      ]);

      const collectedSubTariffIds = new Set<string>();
      const maybeAddSubTariffId = (value: string | null) => {
        if (value) {
          collectedSubTariffIds.add(value);
        }
      };

      for (const sale of courseSales as Array<{ legacyImportMeta: Prisma.JsonValue | null }>) {
        maybeAddSubTariffId(extractSaleSubTariffId(sale.legacyImportMeta));
      }
      for (const payment of paymentHistory as Array<{
        legacyImportMeta: Prisma.JsonValue | null;
        relatedDebtIncome: { legacyImportMeta: Prisma.JsonValue | null } | null;
      }>) {
        maybeAddSubTariffId(extractSaleSubTariffId(payment.legacyImportMeta));
        maybeAddSubTariffId(extractSaleSubTariffId(payment.relatedDebtIncome?.legacyImportMeta));
      }
      maybeAddSubTariffId(customer.profileSubTariffId || null);

      const subTariffNameById = new Map<string, string>();
      if (collectedSubTariffIds.size > 0) {
        try {
          const subTariffs = await prisma.subTariff.findMany({
            where: {
              tenantId: ctx.tenantId,
              id: { in: Array.from(collectedSubTariffIds) },
            },
            select: {
              id: true,
              name: true,
            },
          });
          for (const subTariff of subTariffs) {
            subTariffNameById.set(subTariff.id, subTariff.name);
          }
        } catch (error) {
          if (!isMissingSubTariffSchemaError(error)) {
            throw error;
          }
        }
      }

      return {
        customer,
        courses: courseSales.map((sale) => ({
          subTariffName: (() => {
            const saleSubTariffId = extractSaleSubTariffId(sale.legacyImportMeta);
            const profileMatchedSubTariffId = customer.profileCourseId === sale.course?.id
              && customer.profileTariffId === sale.tariff?.id
              ? (customer.profileSubTariffId || null)
              : null;
            const effectiveSubTariffId = saleSubTariffId || profileMatchedSubTariffId;
            return effectiveSubTariffId ? subTariffNameById.get(effectiveSubTariffId) || null : null;
          })(),
          saleIncomeId: sale.id,
          lifecycleStatus: getIncomeLifecycleLabel(sale.lifecycleStatus),
          entryDate: sale.entryDate,
          courseName: sale.course?.name || '-',
          tariffName: sale.tariff?.name || '-',
          agreementAmount: sale.coursePriceAmount ?? sale.paymentAmount ?? 0,
          firstPaymentAmount: sale.paymentAmount ?? 0,
          remainingDebtAmount: sale.remainingDebtAmount ?? 0,
          managerLabel: resolveManagerLabel(sale.manager),
        })),
        payments: paymentHistory.map((income) => {
          const fallbackCourse = income.relatedDebtIncome?.course?.name || '-';
          const fallbackTariff = income.relatedDebtIncome?.tariff?.name || '-';
          return {
            id: income.id,
            type: income.type,
            lifecycleStatus: getIncomeLifecycleLabel(income.lifecycleStatus),
            entryDate: income.entryDate,
            paymentAmount: income.paymentAmount ?? 0,
            remainingDebtAmount: income.remainingDebtAmount ?? 0,
            courseName: income.course?.name || fallbackCourse,
            tariffName: income.tariff?.name || fallbackTariff,
            subTariffName: (() => {
              const saleSubTariffId = extractSaleSubTariffId(income.legacyImportMeta)
                || extractSaleSubTariffId(income.relatedDebtIncome?.legacyImportMeta);
              const profileMatchedSubTariffId = customer.profileCourseId === (income.course?.id || income.relatedDebtIncome?.course?.id || null)
                && customer.profileTariffId === (income.tariff?.id || income.relatedDebtIncome?.tariff?.id || null)
                ? (customer.profileSubTariffId || null)
                : null;
              const effectiveSubTariffId = saleSubTariffId || profileMatchedSubTariffId;
              return effectiveSubTariffId ? subTariffNameById.get(effectiveSubTariffId) || null : null;
            })(),
            managerLabel: resolveManagerLabel(income.manager),
            debtSourceIncomeId: income.relatedDebtIncomeId || income.id,
          };
        }),
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
              customer: { select: { customerNumber: true, name: true, profileSubTariffId: true } },
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

      const profileSubTariffIds = Array.from(
        new Set(
          requests
            .map((request) => request.income.customer.profileSubTariffId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const newTariffIds = Array.from(
        new Set(
          requests
            .map((request) => request.newTariff?.id)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const [profileSubTariffs, newTariffSubTariffs] = await Promise.all([
        profileSubTariffIds.length
          ? prisma.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                id: { in: profileSubTariffIds },
              },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        newTariffIds.length
          ? prisma.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                tariffId: { in: newTariffIds },
                isActive: true,
              },
              select: { tariffId: true, name: true },
            })
          : Promise.resolve([]),
      ]);

      const profileSubTariffNameById = new Map(profileSubTariffs.map((subTariff) => [subTariff.id, subTariff.name]));
      const newTariffSubTariffNamesByTariffId = new Map<string, Set<string>>();
      for (const subTariff of newTariffSubTariffs) {
        const tariffId = subTariff.tariffId;
        const bucket = newTariffSubTariffNamesByTariffId.get(tariffId) || new Set<string>();
        bucket.add(subTariff.name.trim().toLowerCase());
        newTariffSubTariffNamesByTariffId.set(tariffId, bucket);
      }

      return requests.map((request) => ({
        ...request,
        income: {
          ...request.income,
          lifecycleStatus: getIncomeLifecycleLabel(request.income.lifecycleStatus),
          managerLabel: request.income.manager.name || request.income.manager.username || '-',
          profileSubTariffName: request.income.customer.profileSubTariffId
            ? profileSubTariffNameById.get(request.income.customer.profileSubTariffId) || null
            : null,
        },
        inferredNewSubTariffName: (() => {
          const oldSubTariffName = request.income.customer.profileSubTariffId
            ? profileSubTariffNameById.get(request.income.customer.profileSubTariffId) || null
            : null;
          if (!oldSubTariffName || !request.newTariff?.id) {
            return null;
          }
          const normalizedOldName = oldSubTariffName.trim().toLowerCase();
          const targetTariffNames = newTariffSubTariffNamesByTariffId.get(request.newTariff.id);
          if (!targetTariffNames || !targetTariffNames.has(normalizedOldName)) {
            return null;
          }
          return oldSubTariffName;
        })(),
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
      const scopedManagerUserId = shouldSelfScopeManagerActions(ctx.user.roles) ? ctx.user.userId : null;
      const sourceIncomeRaw = await prisma.income.findFirst({
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
          relatedDebtIncomeId: true,
          tenantId: true,
          customerId: true,
          courseId: true,
          tariffId: true,
          coursePriceAmount: true,
          paymentAmount: true,
          lifecycleStatus: true,
        },
      });

      if (!sourceIncomeRaw) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Selected income was not found.' });
      }

      let sourceIncome = sourceIncomeRaw;
      if (input.type === ADJUSTMENT_TYPE_REFUND && sourceIncomeRaw.type === 'repayment') {
        if (!sourceIncomeRaw.relatedDebtIncomeId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Qarzdorlik to'lovi uchun asosiy sotuv topilmadi.",
          });
        }

        const rootSaleIncome = await prisma.income.findFirst({
          where: {
            id: sourceIncomeRaw.relatedDebtIncomeId,
            tenantId: ctx.tenantId,
            customerId: sourceIncomeRaw.customerId,
            type: 'new_sale',
            ...(scopedManagerUserId
              ? {
                  managerUserId: scopedManagerUserId,
                }
              : {}),
          },
          select: {
            id: true,
            type: true,
            relatedDebtIncomeId: true,
            tenantId: true,
            customerId: true,
            courseId: true,
            tariffId: true,
            coursePriceAmount: true,
            paymentAmount: true,
            lifecycleStatus: true,
          },
        });

        if (!rootSaleIncome) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Refund uchun asosiy sotuv topilmadi.",
          });
        }

        sourceIncome = rootSaleIncome;
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

        try {
          await notifyFinanceUsersRefundRequested({
            tenantId: ctx.tenantId,
            requestId: createdRequest.id,
            requestedByUserId: ctx.user.userId,
          });
        } catch (error) {
          console.error('[Income][Telegram] Finance direct notification for refund request failed (non-blocking)', {
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

        try {
          await notifyRefundRequesterReviewResult({
            tenantId: ctx.tenantId,
            requestId: request.id,
            status: 'approved',
          });
        } catch (error) {
          console.error('[Income][Telegram] Requester approved-refund notification failed (non-blocking)', {
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
              managerUserId: true,
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

      if (request.type === ADJUSTMENT_TYPE_REFUND) {
        try {
          await notifyRefundRequesterReviewResult({
            tenantId: ctx.tenantId,
            requestId: request.id,
            status: 'rejected',
          });
        } catch (error) {
          console.error('[Income][Telegram] Requester rejected-refund notification failed (non-blocking)', {
            tenantId: ctx.tenantId,
            requestId: request.id,
            error: String((error as any)?.message || error),
          });
        }
      }

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

  updateCustomerIdentity: adminProcedure
    .input(
      z.object({
        customerId: z.string().uuid(),
        customerNumber: z.string().min(1).max(64),
        name: z.string().min(1).max(160),
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

      const current = await prisma.customer.findFirst({
        where: {
          tenantId: ctx.tenantId,
          id: input.customerId,
        },
        select: {
          id: true,
          customerNumber: true,
          name: true,
        },
      });

      if (!current) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Customer not found.',
        });
      }

      const duplicate = await prisma.customer.findFirst({
        where: {
          tenantId: ctx.tenantId,
          customerNumber,
          id: { not: current.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Another customer with this number already exists.',
        });
      }

      const updated = await prisma.customer.update({
        where: { id: current.id },
        data: {
          customerNumber,
          name,
        },
        select: {
          id: true,
          customerNumber: true,
          name: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'customer_identity_update',
          resource: 'customer',
          resourceId: updated.id,
          metadata: {
            previousCustomerNumber: current.customerNumber,
            previousName: current.name,
            customerNumber: updated.customerNumber,
            name: updated.name,
          },
        },
      });

      return updated;
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

      const updateResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const customerUpdate = await tx.customer.updateMany({
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

        let updatedSalesCount = 0;
        let updatedRepaymentsCount = 0;

        // Kurs/tarif tanlanganda mos aktiv income zanjiri metadata ham yangilanadi.
        // Bu yerda payment/course price/debt summalari o'zgarmaydi.
        if (courseId) {
          const activeSales = await tx.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              customerId: { in: customerIds },
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            },
            select: { id: true },
          });

          const saleIds = activeSales.map((sale) => sale.id);
          if (saleIds.length > 0) {
            const salesUpdate = await tx.income.updateMany({
              where: {
                tenantId: ctx.tenantId,
                id: { in: saleIds },
              },
              data: {
                courseId,
                tariffId,
              },
            });
            updatedSalesCount = salesUpdate.count;

            const repaymentsUpdate = await tx.income.updateMany({
              where: {
                tenantId: ctx.tenantId,
                type: 'repayment',
                relatedDebtIncomeId: { in: saleIds },
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              },
              data: {
                courseId,
                tariffId,
              },
            });
            updatedRepaymentsCount = repaymentsUpdate.count;
          }
        }

        return {
          customerUpdatedCount: customerUpdate.count,
          updatedSalesCount,
          updatedRepaymentsCount,
        };
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'customer_bulk_course_assignment_update',
          resource: 'customer',
          metadata: {
            customerCount: customerIds.length,
            updatedCount: updateResult.customerUpdatedCount,
            courseId,
            tariffId,
            subTariffId,
            updatedSalesCount: updateResult.updatedSalesCount,
            updatedRepaymentsCount: updateResult.updatedRepaymentsCount,
          },
        },
      });

      return {
        updatedCount: updateResult.customerUpdatedCount,
        updatedSalesCount: updateResult.updatedSalesCount,
        updatedRepaymentsCount: updateResult.updatedRepaymentsCount,
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

  deleteCustomerCourse: adminProcedure
    .input(
      z.object({
        saleIncomeId: z.string().uuid(),
        action: z.enum(['delete', 'refund', 'relink']).default('delete'),
        targetSaleIncomeId: z.string().uuid().optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const saleIncome = await prisma.income.findFirst({
        where: {
          id: input.saleIncomeId,
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        },
        select: {
          id: true,
          customerId: true,
          managerUserId: true,
          courseId: true,
          tariffId: true,
          entryDate: true,
        },
      });

      if (!saleIncome) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: "O'chiriladigan aktiv kurs topilmadi.",
        });
      }

      const saleChain = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          OR: [
            { id: saleIncome.id },
            { relatedDebtIncomeId: saleIncome.id },
          ],
        },
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          paymentAmount: true,
          entryDate: true,
          createdAt: true,
        },
      });
      const saleChainIds = saleChain.map((item) => item.id);
      if (!saleChainIds.length) {
        return {
          success: true,
          deletedCount: 0,
          mode: input.action,
        };
      }

      const pendingAdjustmentCount = await prisma.incomeAdjustmentRequest.count({
        where: {
          tenantId: ctx.tenantId,
          incomeId: { in: saleChainIds },
          status: ADJUSTMENT_STATUS_PENDING,
        },
      });

      if (pendingAdjustmentCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Bu kurs bo'yicha kutilayotgan so'rovlar bor. Avval so'rovlarni yakunlang.",
        });
      }

      const transferAmount = saleChain.reduce((sum, item) => sum + (item.paymentAmount || 0), 0);
      const relinkedCount = saleChainIds.length;
      let targetSaleIncomeId: string | null = null;
      let createdRefundRequestId: string | null = null;
      let relinkedPaymentDates: string[] = [];
      let relinkedRepaymentIds: string[] = [];

      if (input.action === 'relink') {
        if (!input.targetSaleIncomeId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Daromadni o'tkazish uchun maqsad kurs tanlanishi shart.",
          });
        }
        if (input.targetSaleIncomeId === saleIncome.id) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Daromadni aynan shu kursga o'tkazib bo'lmaydi.",
          });
        }
      }

      const resultPayload = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (input.action === 'refund') {
          const existingPending = await tx.incomeAdjustmentRequest.findFirst({
            where: {
              tenantId: ctx.tenantId,
              incomeId: saleIncome.id,
              status: ADJUSTMENT_STATUS_PENDING,
            },
            select: { id: true },
          });
          if (existingPending) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: "Bu kurs uchun allaqachon refund so'rovi mavjud.",
            });
          }

          await tx.income.updateMany({
            where: {
              tenantId: ctx.tenantId,
              id: { in: saleChainIds },
            },
            data: {
              lifecycleStatus: INCOME_LIFECYCLE_PENDING_REFUND,
            },
          });

          const request = await tx.incomeAdjustmentRequest.create({
            data: {
              tenantId: ctx.tenantId,
              type: ADJUSTMENT_TYPE_REFUND,
              status: ADJUSTMENT_STATUS_PENDING,
              incomeId: saleIncome.id,
              customerId: saleIncome.customerId,
              requestedByUserId: ctx.user.userId,
              reason: input.note?.trim() || "Mijoz kursini o'chirish oynasidan refund yaratildi.",
              requestedAmount: transferAmount,
            },
            select: { id: true },
          });
          createdRefundRequestId = request.id;

          await refreshCustomerProfileFromLatestActiveSale(tx, {
            tenantId: ctx.tenantId,
            customerId: saleIncome.customerId,
          });

          return {
            deletedCount: 0,
            mode: 'refund' as const,
          };
        }

        if (input.action === 'relink') {
          const targetSale = await tx.income.findFirst({
            where: {
              id: input.targetSaleIncomeId!,
              tenantId: ctx.tenantId,
              customerId: saleIncome.customerId,
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            },
            select: {
              id: true,
              courseId: true,
              tariffId: true,
              coursePriceAmount: true,
              debtAmount: true,
              paymentAmount: true,
              legacyImportMeta: true,
              customer: {
                select: {
                  profileCourseId: true,
                  profileTariffId: true,
                  profileSubTariffId: true,
                },
              },
            },
          });

          if (!targetSale) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: "Daromadni ulash uchun tanlangan kurs topilmadi.",
            });
          }

          const targetSaleSubTariffId = extractSaleSubTariffId(targetSale.legacyImportMeta);
          const profileMatchedTargetSubTariffId = (
            targetSale.customer.profileCourseId === targetSale.courseId
            && targetSale.customer.profileTariffId === targetSale.tariffId
          )
            ? targetSale.customer.profileSubTariffId || null
            : null;
          const effectiveTargetSubTariffId = targetSaleSubTariffId || profileMatchedTargetSubTariffId || null;

          const targetChainRows = await tx.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              OR: [
                { id: targetSale.id },
                { relatedDebtIncomeId: targetSale.id },
              ],
            },
            select: {
              id: true,
              paymentAmount: true,
            },
          });
          const targetAgreementAmount = getSaleAgreementAmount(targetSale);
          const targetPaidAmount = targetChainRows.reduce((sum, row) => sum + Math.max(Number(row.paymentAmount || 0), 0), 0);
          const targetCurrentDebtAmount = Math.max(targetAgreementAmount - targetPaidAmount, 0);

          if (transferAmount > targetCurrentDebtAmount) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: `Summalar juda katta: o'tkaziladigan to'lov (${transferAmount.toLocaleString('uz-UZ')}) maqsad kurs qarzidan (${targetCurrentDebtAmount.toLocaleString('uz-UZ')}) katta.`,
            });
          }

          await tx.income.updateMany({
            where: {
              tenantId: ctx.tenantId,
              id: { in: saleChainIds },
            },
            data: {
              type: 'repayment',
              relatedDebtIncomeId: targetSale.id,
              courseId: targetSale.courseId,
              tariffId: targetSale.tariffId,
              coursePriceAmount: null,
              debtAmount: 0,
              remainingDebtAmount: 0,
              legacyImportMeta: Prisma.JsonNull,
            },
          });

          const normalized = await normalizeSaleChainChronology(tx, {
            tenantId: ctx.tenantId,
            saleId: targetSale.id,
          });
          if (normalized.didReorder) {
            relinkedRepaymentIds = normalized.reorderedIncomeIds.filter((id) => id !== normalized.canonicalSaleId);
          }
          await assertSaleChainDebtInvariant(tx, {
            tenantId: ctx.tenantId,
            saleId: normalized.canonicalSaleId,
          });

          targetSaleIncomeId = targetSale.id;
          relinkedPaymentDates = saleChain
            .map((row) => row.entryDate?.toISOString?.() || String(row.entryDate))
            .filter(Boolean);

          await refreshCustomerProfileFromLatestActiveSale(tx, {
            tenantId: ctx.tenantId,
            customerId: saleIncome.customerId,
          });

          return {
            deletedCount: 0,
            mode: 'relink' as const,
          };
        }

        const deleted = await tx.income.deleteMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: saleChainIds },
          },
        });

        await refreshCustomerProfileFromLatestActiveSale(tx, {
          tenantId: ctx.tenantId,
          customerId: saleIncome.customerId,
        });

        return {
          deletedCount: deleted.count,
          mode: 'delete' as const,
        };
      }, {
        // Relink/delete course actions can touch long payment chains.
        // Increase interactive transaction window to avoid premature close.
        maxWait: 15000,
        timeout: 60000,
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: input.action === 'refund'
            ? 'customer_course_refund_request_create'
            : (input.action === 'relink' ? 'customer_course_relink' : 'customer_course_delete'),
          resource: 'income',
          resourceId: saleIncome.id,
          metadata: {
            customerId: saleIncome.customerId,
            saleIncomeId: saleIncome.id,
            sourceCourseId: saleIncome.courseId,
            sourceTariffId: saleIncome.tariffId,
            sourceEntryDate: saleIncome.entryDate,
            transferAmount,
            targetSaleIncomeId,
            refundRequestId: createdRefundRequestId,
            action: input.action,
            managerUserId: saleIncome.managerUserId,
            deletedCount: resultPayload.deletedCount,
            relinkedRepaymentIds,
            relinkedPaymentDates,
          },
        },
      });

      if (createdRefundRequestId) {
        try {
          await sendRefundRequestedTelegram({
            tenantId: ctx.tenantId,
            requestId: createdRefundRequestId,
            requestedByUserId: ctx.user.userId,
          });
        } catch (error) {
          console.error('[Income][Telegram] Refund request notification failed (non-blocking)', {
            tenantId: ctx.tenantId,
            requestId: createdRefundRequestId,
            error: String((error as any)?.message || error),
          });
        }

        try {
          await notifyFinanceUsersRefundRequested({
            tenantId: ctx.tenantId,
            requestId: createdRefundRequestId,
            requestedByUserId: ctx.user.userId,
          });
        } catch (error) {
          console.error('[Income][Telegram] Finance direct notification for refund request failed (non-blocking)', {
            tenantId: ctx.tenantId,
            requestId: createdRefundRequestId,
            error: String((error as any)?.message || error),
          });
        }
      }

      return {
        success: true,
        deletedCount: resultPayload.deletedCount,
        relinkedCount: resultPayload.mode === 'relink' ? relinkedCount : 0,
        mode: resultPayload.mode,
        targetSaleIncomeId,
        refundRequestId: createdRefundRequestId,
      };
    }),

  updateCustomerCourseSale: adminProcedure
    .input(
      z.object({
        saleIncomeId: z.string().uuid(),
        newCourseId: z.string().uuid(),
        newTariffId: z.string().uuid().optional(),
        newSubTariffId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.newTariffId && input.newSubTariffId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tarif tanlanmasdan subtarif tanlab bo\'lmaydi.',
        });
      }

      const saleIncome = await prisma.income.findFirst({
        where: {
          id: input.saleIncomeId,
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        },
        select: {
          id: true,
          customerId: true,
          legacyImportMeta: true,
        },
      });

      if (!saleIncome) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: "Tahrirlanadigan aktiv kurs topilmadi.",
        });
      }

      const [course, tariff, activeSubTariffs] = await Promise.all([
        prisma.course.findFirst({
          where: {
            id: input.newCourseId,
            tenantId: ctx.tenantId,
            isActive: true,
          },
          select: { id: true },
        }),
        input.newTariffId
          ? prisma.tariff.findFirst({
              where: {
                id: input.newTariffId,
                tenantId: ctx.tenantId,
                courseId: input.newCourseId,
                isActive: true,
              },
              select: { id: true },
            })
          : Promise.resolve(null),
        input.newTariffId
          ? prisma.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                tariffId: input.newTariffId,
                isActive: true,
              },
              orderBy: [{ name: 'asc' }],
              select: { id: true },
            })
          : Promise.resolve([]),
      ]);

      if (!course) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Yangi kurs topilmadi yoki faol emas.",
        });
      }
      if (input.newTariffId && !tariff) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Yangi tarif tanlangan kursga tegishli emas yoki faol emas.",
        });
      }
      let nextSubTariffId: string | null = input.newSubTariffId || null;
      if (input.newTariffId) {
        const subTariffIdSet = new Set(activeSubTariffs.map((item) => item.id));
        if (nextSubTariffId && !subTariffIdSet.has(nextSubTariffId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Yangi subtarif tanlangan tarifga tegishli emas yoki faol emas.",
          });
        }
        const firstActiveSubTariff = activeSubTariffs[0];
        if (!nextSubTariffId && firstActiveSubTariff) {
          nextSubTariffId = firstActiveSubTariff.id;
        }
      }

      const saleChain = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          OR: [{ id: saleIncome.id }, { relatedDebtIncomeId: saleIncome.id }],
        },
        select: { id: true },
      });
      const saleChainIds = saleChain.map((row) => row.id);

      const pendingAdjustmentCount = await prisma.incomeAdjustmentRequest.count({
        where: {
          tenantId: ctx.tenantId,
          incomeId: { in: saleChainIds },
          status: ADJUSTMENT_STATUS_PENDING,
        },
      });
      if (pendingAdjustmentCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Bu kurs bo'yicha kutilayotgan so'rovlar bor. Avval so'rovlarni yakunlang.",
        });
      }

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.income.update({
          where: { id: saleIncome.id },
          data: {
            courseId: input.newCourseId,
            tariffId: input.newTariffId || null,
            legacyImportMeta: withSaleSubTariffMeta(
              saleIncome.legacyImportMeta,
              nextSubTariffId,
            ),
          },
        });

        await tx.income.updateMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'repayment',
            relatedDebtIncomeId: saleIncome.id,
          },
          data: {
            courseId: input.newCourseId,
            tariffId: input.newTariffId || null,
          },
        });

        await tx.customer.update({
          where: { id: saleIncome.customerId },
          data: {
            profileSubTariffId: nextSubTariffId,
          },
        });

        await refreshCustomerProfileFromLatestActiveSale(tx, {
          tenantId: ctx.tenantId,
          customerId: saleIncome.customerId,
        });

        await assertSaleChainDebtInvariant(tx, {
          tenantId: ctx.tenantId,
          saleId: saleIncome.id,
        });
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'customer_course_sale_update',
          resource: 'income',
          resourceId: saleIncome.id,
          metadata: {
            newCourseId: input.newCourseId,
            newTariffId: input.newTariffId || null,
            newSubTariffId: nextSubTariffId,
          },
        },
      });

      return {
        success: true,
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

      if (input?.courseId || input?.tariffId) {
        andConditions.push({
          incomes: {
            some: {
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              ...(scopedManagerUserId
                ? {
                    managerUserId: scopedManagerUserId,
                  }
                : {}),
              ...(input?.courseId
                ? {
                    courseId: input.courseId,
                  }
                : {}),
              ...(input?.tariffId
                ? {
                    tariffId: input.tariffId,
                  }
                : {}),
            },
          },
        });
      }

      const where: Prisma.CustomerWhereInput = {
        tenantId: ctx.tenantId,
        ...(andConditions.length ? { AND: andConditions } : {}),
      };

      const [allMatchedCustomersLite, customers, courseOptions, catalogCourses] = await Promise.all([
        prisma.customer.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            profileCourseId: true,
            profileTariffId: true,
            profileSubTariffId: true,
          },
        }),
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

      if (!allMatchedCustomersLite.length) {
        return {
          customers: [],
          summaryCounts: {
            totalCustomers: 0,
            withDebtCustomers: 0,
            withoutDebtCustomers: 0,
          },
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

      const customerIds = allMatchedCustomersLite.map((customer) => customer.id);
      const profileCourseIds = Array.from(new Set(allMatchedCustomersLite.map((customer) => customer.profileCourseId).filter(Boolean))) as string[];
      const profileTariffIds = Array.from(new Set(allMatchedCustomersLite.map((customer) => customer.profileTariffId).filter(Boolean))) as string[];
      const profileSubTariffIds = Array.from(new Set(allMatchedCustomersLite.map((customer) => customer.profileSubTariffId).filter(Boolean))) as string[];
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
      const customerProfileById = new Map(
        allMatchedCustomersLite.map((customer) => [
          customer.id,
          {
            profileCourseId: customer.profileCourseId || null,
            profileTariffId: customer.profileTariffId || null,
            profileSubTariffId: customer.profileSubTariffId || null,
          },
        ]),
      );
      const [relatedIncomes, activeSales] = await Promise.all([
        prisma.income.findMany({
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
        }),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            customerId: { in: customerIds },
            type: 'new_sale',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            ...(scopedManagerUserId
              ? {
                  managerUserId: scopedManagerUserId,
                }
              : {}),
          },
          orderBy: [{ entryDate: 'desc' }],
          select: {
            id: true,
            customerId: true,
            entryDate: true,
            remainingDebtAmount: true,
            coursePriceAmount: true,
            debtAmount: true,
            paymentAmount: true,
            legacyImportMeta: true,
            course: {
              select: {
                id: true,
                name: true,
              },
            },
            tariff: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        }),
      ]);

      const saleSubTariffIds = Array.from(
        new Set(
          (activeSales as Array<{ legacyImportMeta: Prisma.JsonValue | null }>)
            .map((sale) => extractSaleSubTariffId(sale.legacyImportMeta))
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const missingSaleSubTariffIds = saleSubTariffIds.filter((id) => !profileSubTariffNameById.has(id));
      if (missingSaleSubTariffIds.length > 0) {
        const additionalSubTariffs = await prisma.subTariff.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: missingSaleSubTariffIds },
          },
          select: { id: true, name: true },
        });
        for (const subTariff of additionalSubTariffs) {
          profileSubTariffNameById.set(subTariff.id, subTariff.name);
        }
      }

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
      const courseEntriesByCustomer = new Map<
        string,
        Array<{
          saleIncomeId: string;
          courseId: string | null;
          tariffId: string | null;
          subTariffId: string | null;
          courseName: string | null;
          tariffName: string | null;
          subTariffName: string | null;
          label: string;
          entryDate: string;
          remainingDebtAmount: number;
        }>
      >();
      const activeSaleChainMetricsBySaleId = await buildActiveSaleChainMetrics({
        tenantId: ctx.tenantId,
        sales: activeSales as SaleChainSaleRow[],
      });

      for (const sale of activeSales as Array<{
        id: string;
        customerId: string;
        entryDate: Date;
        remainingDebtAmount: number;
        coursePriceAmount: number | null;
        debtAmount: number | null;
        paymentAmount: number;
        legacyImportMeta: Prisma.JsonValue | null;
        course: { id: string; name: string } | null;
        tariff: { id: string; name: string } | null;
      }>) {
        const profile = customerProfileById.get(sale.customerId);
        const saleSubTariffId = extractSaleSubTariffId(sale.legacyImportMeta);
        const profileMatchedSubTariffId = profile
          && profile.profileCourseId === sale.course?.id
          && profile.profileTariffId === sale.tariff?.id
          ? profile.profileSubTariffId || null
          : null;
        const effectiveSubTariffId = saleSubTariffId || profileMatchedSubTariffId || null;
        const subTariffName = effectiveSubTariffId
          ? profileSubTariffNameById.get(effectiveSubTariffId) || null
          : null;
        const labelParts = [sale.course?.name || null, sale.tariff?.name || null, subTariffName].filter(Boolean);
        const label = labelParts.length ? labelParts.join(' / ') : "Noma'lum kurs";
        const list = courseEntriesByCustomer.get(sale.customerId) || [];
        list.push({
          saleIncomeId: sale.id,
          courseId: sale.course?.id || null,
          tariffId: sale.tariff?.id || null,
          subTariffId: effectiveSubTariffId,
          courseName: sale.course?.name || null,
          tariffName: sale.tariff?.name || null,
          subTariffName,
          label,
          entryDate: sale.entryDate.toISOString(),
          remainingDebtAmount: activeSaleChainMetricsBySaleId.get(sale.id)?.currentDebtAmount ?? (sale.remainingDebtAmount || 0),
        });
        courseEntriesByCustomer.set(sale.customerId, list);

        const current = aggregatesByCustomer.get(sale.customerId) || {
          totalDebtAmount: 0,
          totalPaidAmount: 0,
          hasDebt: false,
          lastActivityAt: null as Date | null,
          courses: new Set<string>(),
          responsibleManagerUserId: null as string | null,
          responsibleManagerLabel: null as string | null,
        };
        const saleMetric = activeSaleChainMetricsBySaleId.get(sale.id);
        const saleDebt = saleMetric?.currentDebtAmount ?? (sale.remainingDebtAmount || 0);
        const salePaid = saleMetric?.paidAmount ?? Number(sale.paymentAmount || 0);
        current.totalDebtAmount += saleDebt;
        current.totalPaidAmount += salePaid;
        current.hasDebt = current.hasDebt || saleDebt > 0;
        if (sale.course?.name) {
          current.courses.add(sale.course.name);
        }
        aggregatesByCustomer.set(sale.customerId, current);
      }

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

      const allMatchedCustomerIds = new Set(customerIds);
      const customersAfterSubTariffFilterIds = input?.subTariffId
        ? new Set(
            customerIds.filter((customerId) => {
              const entries = courseEntriesByCustomer.get(customerId) || [];
              return entries.some((entry) =>
                entry.subTariffId === input.subTariffId
                && (!input.courseId || entry.courseId === input.courseId)
                && (!input.tariffId || entry.tariffId === input.tariffId));
            }),
          )
        : allMatchedCustomerIds;
      const customersAfterDebtFilterIds = new Set(
        Array.from(customersAfterSubTariffFilterIds).filter((customerId) => {
          if (!input?.debtFilter) {
            return true;
          }
          const aggregate = aggregatesByCustomer.get(customerId);
          const hasDebt = Boolean(aggregate?.hasDebt);
          if (input.debtFilter === 'with_debt') {
            return hasDebt;
          }
          if (input.debtFilter === 'without_debt') {
            return !hasDebt;
          }
          return true;
        }),
      );

      const customersAfterSubTariffFilter = input?.subTariffId
        ? customers.filter((customer) => {
            const entries = courseEntriesByCustomer.get(customer.id) || [];
            return entries.some((entry) =>
              entry.subTariffId === input.subTariffId
              && (!input.courseId || entry.courseId === input.courseId)
              && (!input.tariffId || entry.tariffId === input.tariffId));
          })
        : customers;
      const customersAfterDebtFilter = customersAfterSubTariffFilter.filter((customer) => {
        if (!input?.debtFilter) {
          return true;
        }
        const aggregate = aggregatesByCustomer.get(customer.id);
        const hasDebt = Boolean(aggregate?.hasDebt);
        if (input.debtFilter === 'with_debt') {
          return hasDebt;
        }
        if (input.debtFilter === 'without_debt') {
          return !hasDebt;
        }
        return true;
      });

      return {
        customers: customersAfterDebtFilter.map((customer) => {
          const aggregate = aggregatesByCustomer.get(customer.id);
          const courseEntries = courseEntriesByCustomer.get(customer.id) || [];
          const profileCourseName = customer.profileCourseId ? profileCourseNameById.get(customer.profileCourseId) || null : null;
          const profileTariffName = customer.profileTariffId ? profileTariffNameById.get(customer.profileTariffId) || null : null;
          const profileSubTariffName = customer.profileSubTariffId ? profileSubTariffNameById.get(customer.profileSubTariffId) || null : null;
          const profileCourseLabel = [profileCourseName, profileTariffName, profileSubTariffName].filter(Boolean).join(' / ');
          const aggregateCoursesFromEntries = courseEntries.map((entry) => entry.label);
          const aggregateCourses = aggregateCoursesFromEntries.length
            ? aggregateCoursesFromEntries
            : (aggregate ? Array.from(aggregate.courses) : []);
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
            courseEntries,
            responsibleManagerUserId: aggregate?.responsibleManagerUserId ?? null,
            responsibleManagerLabel: aggregate?.responsibleManagerLabel ?? null,
            profileCourseName,
            profileTariffName,
            profileSubTariffName,
          };
        }),
        summaryCounts: {
          totalCustomers: customersAfterDebtFilterIds.size,
          withDebtCustomers: Array.from(customersAfterDebtFilterIds).reduce((count, customerId) => {
            return count + (aggregatesByCustomer.get(customerId)?.hasDebt ? 1 : 0);
          }, 0),
          withoutDebtCustomers: Array.from(customersAfterDebtFilterIds).reduce((count, customerId) => {
            return count + (aggregatesByCustomer.get(customerId)?.hasDebt ? 0 : 1);
          }, 0),
        },
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

