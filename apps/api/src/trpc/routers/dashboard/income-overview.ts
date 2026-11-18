import type { DbClient } from '@dashboarduz/db';

import { getAgentResponsibleScope } from '../../../lib/access';
import { getRangeStart } from '../../../lib/dates';
import { INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { buildTechnicalSaleIdSet, isRowLinkedToTechnicalSale } from '../../../services/technical-income';

import { classifyCourseCategoryFromField, protectedProcedure } from './helpers';
import { loadSelectedReportCourses, type SelectedCourseCategory } from './selected-report-courses';

type IncomeSplit = { online: number; offline: number };

type IncomeRowQuery = {
  tenantId: string;
  rangeStart: Date;
  rangeEnd: Date;
  managerUserId: string | null;
  technicalSaleIds: Set<string>;
  db: DbClient;
};

export type CountedIncomeRow = {
  entryDate: Date;
  /** When the row was recorded; gives the time of day for date-only entries. */
  createdAt?: Date;
  amount: number;
  category: ReturnType<typeof classifyCourseCategoryFromField>;
};

/** Ids of technical sales, whose payments the dashboard income figures leave out. */
export async function loadTechnicalSaleIds(tenantId: string, managerUserId: string | null, db: DbClient): Promise<Set<string>> {
  const technicalSales = await db.income.findMany({
    where: {
      tenantId,
      type: 'new_sale',
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      ...(managerUserId ? { managerUserId } : {}),
    },
    select: {
      id: true,
      type: true,
      coursePriceAmount: true,
      debtAmount: true,
      paymentAmount: true,
    },
  });

  return buildTechnicalSaleIdSet(technicalSales);
}

/** Active income rows of a period with their amount and course category, technical sales excluded. */
export async function loadCountedIncomeRows(params: IncomeRowQuery): Promise<CountedIncomeRow[]> {
  const { db } = params;

  const rows = await db.income.findMany({
    where: {
      tenantId: params.tenantId,
      lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      entryDate: {
        gte: params.rangeStart,
        lte: params.rangeEnd,
      },
      ...(params.managerUserId ? { managerUserId: params.managerUserId } : {}),
    },
    select: {
      id: true,
      entryDate: true,
      createdAt: true,
      type: true,
      relatedDebtIncomeId: true,
      paymentAmount: true,
      course: {
        select: {
          name: true,
          category: true,
        },
      },
      relatedDebtIncome: {
        select: {
          course: {
            select: {
              name: true,
              category: true,
            },
          },
        },
      },
    },
  });

  const counted: CountedIncomeRow[] = [];

  for (const row of rows) {
    if (isRowLinkedToTechnicalSale({
      rowType: row.type,
      rowId: row.id,
      relatedDebtIncomeId: row.relatedDebtIncomeId,
      technicalSaleIds: params.technicalSaleIds,
    })) {
      continue;
    }
    const course = row.course || row.relatedDebtIncome?.course;
    const category = course?.category
      ? classifyCourseCategoryFromField(course.category)
      : classifyCourseCategoryFromField(course?.name);

    counted.push({ entryDate: row.entryDate, createdAt: row.createdAt, amount: row.paymentAmount ?? 0, category });
  }

  return counted;
}

async function sumIncomeSplit(params: IncomeRowQuery): Promise<IncomeSplit> {
  const split: IncomeSplit = { online: 0, offline: 0 };

  for (const row of await loadCountedIncomeRows(params)) {
    if (row.category === 'online') {
      split.online += row.amount;
    } else if (row.category === 'offline') {
      split.offline += row.amount;
    }
  }

  return split;
}

type SelectedCourseGroup = 'online' | 'offline' | 'intensive';

type SelectedCourse = {
  courseId: string;
  name: string;
  salesCount: number;
  agreementAmount: number;
  tariffs: Array<{ tariffId: string | null; name: string; salesCount: number }>;
};

export const incomeOverviewProcedures = {
  incomeOverview: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
    const managerUserId = scope.isScoped ? ctx.user.userId : null;

    const technicalSaleIds = await loadTechnicalSaleIds(ctx.tenantId, managerUserId, ctx.db);

    const [daily, weekly, monthly] = await Promise.all([
      sumIncomeSplit({ tenantId: ctx.tenantId, rangeStart: getRangeStart('today', now), rangeEnd: now, managerUserId, technicalSaleIds, db: ctx.db }),
      sumIncomeSplit({ tenantId: ctx.tenantId, rangeStart: getRangeStart('week', now), rangeEnd: now, managerUserId, technicalSaleIds, db: ctx.db }),
      sumIncomeSplit({ tenantId: ctx.tenantId, rangeStart: getRangeStart('month', now), rangeEnd: now, managerUserId, technicalSaleIds, db: ctx.db }),
    ]);

    return { daily, weekly, monthly };
  }),

  selectedCourseOverview: protectedProcedure.query(async ({ ctx }) => {
    const result: Record<SelectedCourseGroup, SelectedCourse | null> = {
      online: null,
      offline: null,
      intensive: null,
    };

    const selectedCourses = await loadSelectedReportCourses(ctx.tenantId, ctx.db);

    for (const course of selectedCourses) {
      const category: SelectedCourseCategory = course.dashboardCategory;

      if (result[category]) continue;
      result[category] = {
        courseId: course.courseId,
        name: course.name,
        salesCount: course.salesCount,
        agreementAmount: course.agreementAmount,
        tariffs: course.tariffs,
      };
    }

    return result;
  }),
};
