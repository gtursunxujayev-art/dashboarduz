import type { DbClient } from '@dashboarduz/db';

import { buildTechnicalSaleIdSet, isRowLinkedToTechnicalSale } from '../../../services/technical-income';
import { resolveSaleAgreementAmount } from '../../../services/income-facts';
import {
  classifyCourseCategoryFromField,
  INCOME_LIFECYCLE_ACTIVE,
} from './helpers';

export type SelectedCourseCategory = 'online' | 'offline' | 'intensive';

export type SelectedReportCourse = {
  courseId: string;
  name: string;
  category: string;
  dashboardCategory: SelectedCourseCategory;
  group: 'online' | 'offline';
  salesCount: number;
  agreementAmount: number;
  /** Customers of the course whose agreement is not yet fully paid (first payment plus every repayment). */
  debtorsCount: number;
  tariffs: Array<{ tariffId: string | null; name: string; salesCount: number }>;
};

export function parseTelegramDailyReportCourseIds(config: unknown): string[] {
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

function resolveSelectedCourseCategory(
  category: string | null | undefined,
  name: string | null | undefined,
): SelectedCourseCategory | null {
  const classified = classifyCourseCategoryFromField(category || name);
  return classified === 'online' || classified === 'offline' || classified === 'intensive'
    ? classified
    : null;
}

export async function loadSelectedReportCourses(tenantId: string, db: DbClient): Promise<SelectedReportCourse[]> {
  const telegramIntegration = await db.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'telegram',
      },
    },
    select: {
      status: true,
      config: true,
    },
  });
  const selectedCourseIds = telegramIntegration?.status === 'active'
    ? parseTelegramDailyReportCourseIds(telegramIntegration.config)
    : [];

  if (!selectedCourseIds.length) {
    return [];
  }

  const [selectedCourses, selectedCourseSalesRaw, technicalSales] = await Promise.all([
    db.course.findMany({
      where: {
        tenantId,
        id: { in: selectedCourseIds },
      },
      select: {
        id: true,
        name: true,
        category: true,
        tariffs: {
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        },
      },
    }),
    db.income.findMany({
      where: {
        tenantId,
        type: 'new_sale',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        courseId: { in: selectedCourseIds },
      },
      select: {
        id: true,
        type: true,
        relatedDebtIncomeId: true,
        courseId: true,
        tariffId: true,
        coursePriceAmount: true,
        debtAmount: true,
        paymentAmount: true,
      },
    }),
    db.income.findMany({
      where: {
        tenantId,
        type: 'new_sale',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      },
      select: {
        id: true,
        type: true,
        coursePriceAmount: true,
        debtAmount: true,
        paymentAmount: true,
      },
    }),
  ]);

  const technicalSaleIds = buildTechnicalSaleIdSet(technicalSales);
  const selectedCourseSales = selectedCourseSalesRaw.filter((row) => !isRowLinkedToTechnicalSale({
    rowType: row.type,
    rowId: row.id,
    relatedDebtIncomeId: row.relatedDebtIncomeId,
    technicalSaleIds,
  }));

  const repayments = selectedCourseSales.length
    ? await prisma.income.findMany({
        where: {
          tenantId,
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          relatedDebtIncomeId: { in: selectedCourseSales.map((sale) => sale.id) },
        },
        select: { relatedDebtIncomeId: true, paymentAmount: true },
      })
    : [];
  const paidBySaleId = new Map(selectedCourseSales.map((sale) => [sale.id, sale.paymentAmount || 0]));
  for (const row of repayments) {
    if (!row.relatedDebtIncomeId) continue;
    paidBySaleId.set(row.relatedDebtIncomeId, (paidBySaleId.get(row.relatedDebtIncomeId) || 0) + (row.paymentAmount || 0));
  }

  const salesCountById = new Map<string, number>();
  const debtorsCountById = new Map<string, number>();
  const agreementAmountById = new Map<string, number>();
  const tariffSalesCountByKey = new Map<string, number>();
  for (const sale of selectedCourseSales) {
    if (!sale.courseId) continue;
    salesCountById.set(sale.courseId, (salesCountById.get(sale.courseId) || 0) + 1);
    agreementAmountById.set(
      sale.courseId,
      (agreementAmountById.get(sale.courseId) || 0) + resolveSaleAgreementAmount(sale),
    );
    if (resolveSaleAgreementAmount(sale) - (paidBySaleId.get(sale.id) || 0) > 0) {
      debtorsCountById.set(sale.courseId, (debtorsCountById.get(sale.courseId) || 0) + 1);
    }
    const tariffKey = `${sale.courseId}:${sale.tariffId || 'none'}`;
    tariffSalesCountByKey.set(tariffKey, (tariffSalesCountByKey.get(tariffKey) || 0) + 1);
  }

  const selectedCoursesById = new Map(selectedCourses.map((course) => [course.id, course]));
  return selectedCourseIds.flatMap((courseId) => {
    const course = selectedCoursesById.get(courseId);
    if (!course) return [];
    const dashboardCategory = resolveSelectedCourseCategory(course.category, course.name);
    if (!dashboardCategory) return [];
    const category = String(course.category || '').trim();
    return [{
      courseId: course.id,
      name: course.name,
      category,
      dashboardCategory,
      group: dashboardCategory === 'online' ? 'online' as const : 'offline' as const,
      salesCount: salesCountById.get(course.id) || 0,
      agreementAmount: agreementAmountById.get(course.id) || 0,
      debtorsCount: debtorsCountById.get(course.id) || 0,
      tariffs: [
        ...course.tariffs.map((tariff) => ({
          tariffId: tariff.id,
          name: tariff.name,
          salesCount: tariffSalesCountByKey.get(`${course.id}:${tariff.id}`) || 0,
        })),
        ...(tariffSalesCountByKey.get(`${course.id}:none`)
          ? [{
              tariffId: null,
              name: 'Tarifsiz',
              salesCount: tariffSalesCountByKey.get(`${course.id}:none`) || 0,
            }]
          : []),
      ],
    }];
  });
}
