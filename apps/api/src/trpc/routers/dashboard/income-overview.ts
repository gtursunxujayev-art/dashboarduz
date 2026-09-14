import {
  classifyCourseCategoryFromField,
  getAgentResponsibleScope,
  getRangeStart,
  INCOME_LIFECYCLE_ACTIVE,
  prisma,
  protectedProcedure,
} from './helpers';
import { buildTechnicalSaleIdSet, isRowLinkedToTechnicalSale } from '../../../services/technical-income';
import { loadSelectedReportCourses, type SelectedCourseCategory } from './selected-report-courses';

type IncomeSplit = { online: number; offline: number };

async function sumIncomeSplit(params: {
  tenantId: string;
  rangeStart: Date;
  rangeEnd: Date;
  managerUserId: string | null;
  technicalSaleIds: Set<string>;
}): Promise<IncomeSplit> {
  const rows = await prisma.income.findMany({
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

  const split: IncomeSplit = { online: 0, offline: 0 };
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
    const amount = row.paymentAmount ?? 0;
    if (category === 'online') {
      split.online += amount;
    } else if (category === 'offline') {
      split.offline += amount;
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
    const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
    const managerUserId = scope.isScoped ? ctx.user.userId : null;

    const technicalSales = await prisma.income.findMany({
      where: {
        tenantId: ctx.tenantId,
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
    const technicalSaleIds = buildTechnicalSaleIdSet(technicalSales);

    const [daily, weekly, monthly] = await Promise.all([
      sumIncomeSplit({ tenantId: ctx.tenantId, rangeStart: getRangeStart('today', now), rangeEnd: now, managerUserId, technicalSaleIds }),
      sumIncomeSplit({ tenantId: ctx.tenantId, rangeStart: getRangeStart('week', now), rangeEnd: now, managerUserId, technicalSaleIds }),
      sumIncomeSplit({ tenantId: ctx.tenantId, rangeStart: getRangeStart('month', now), rangeEnd: now, managerUserId, technicalSaleIds }),
    ]);

    return { daily, weekly, monthly };
  }),

  selectedCourseOverview: protectedProcedure.query(async ({ ctx }) => {
    const result: Record<SelectedCourseGroup, SelectedCourse | null> = {
      online: null,
      offline: null,
      intensive: null,
    };

    const selectedCourses = await loadSelectedReportCourses(ctx.tenantId);
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
