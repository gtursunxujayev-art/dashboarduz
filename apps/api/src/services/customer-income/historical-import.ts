import type { DbClient } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { normalizeKey } from '../../lib/text';
import type { HistoricalCatalogItemPreview, HistoricalPreparedIncomeRow } from '../historical-import';

import { buildRowLookupContext } from './bulk-import-rows';
import { fetchCoursesWithTariffsSafe } from './catalog';

function throwHistoricalImportMigrationError(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: "Tarixiy import ishlashi uchun yangi migratsiyalar hali qo'llanmagan. Avval database migration ni ishga tushiring.",
  });
}

export function throwIncomeImportDisabledByPolicy(): never {
  throw new TRPCError({
    code: 'PRECONDITION_FAILED',
    message: "Import moduli vaqtincha o'chirilgan. Qo'lda tushum kiritish rejimidan foydalaning.",
  });
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

const HISTORICAL_IMPORT_STATUS_PREPARED = 'prepared';

const HISTORICAL_IMPORT_STATUS_RUNNING = 'running';

const HISTORICAL_IMPORT_STATUS_CANCELLING = 'cancelling';

const HISTORICAL_IMPORT_STATUS_CANCELLED = 'cancelled';

const HISTORICAL_IMPORT_STATUS_FAILED = 'failed';

const HISTORICAL_IMPORT_STATUS_COMPLETED = 'completed';

const HISTORICAL_IMPORT_STALE_MS = 2 * 60 * 1000;

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

async function buildHistoricalCatalogContext(tenantId: string, db: DbClient) {
  const [lookupContext, courses, existingCustomers] = await Promise.all([
    buildRowLookupContext(tenantId, db),
    fetchCoursesWithTariffsSafe({ tenantId, onlyActive: false, db }),
    db.customer.findMany({
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
  db: DbClient;
}) {
  const { db } = params;

  const ensuredCourses = new Map<string, { id: string; name: string; tariffsByKey: Map<string, string> }>();

  for (const item of params.items) {
    // Temporary production-safe guard:
    // If DB constraint for courses.category does not yet allow "additional_service",
    // never attempt to create/update those catalog items during historical import.
    if (item.category === 'additional_service') {
      continue;
    }

    const course = await db.course.upsert({
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
      const tariff = await db.tariff.upsert({
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
    db,
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
  db: DbClient;
}) {
  const { db } = params;

  await db.income.update({
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
