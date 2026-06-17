import {
  prisma,
  z,
  protectedProcedure,
  dashboardRangeSchema,
  INCOME_LIFECYCLE_ACTIVE,
  getAgentResponsibleScope,
  resolveDateRange,
} from './helpers';

export const widgetProcedures = {
  widgetCatalogOptions: protectedProcedure.query(async ({ ctx }) => {
    const courses = await prisma.course.findMany({
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
      },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        category: true,
        tariffs: {
          where: { isActive: true },
          orderBy: [{ name: 'asc' }],
          select: {
            id: true,
            name: true,
            subTariffs: {
              where: { isActive: true },
              orderBy: [{ name: 'asc' }],
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return {
      courses: courses.map((course) => ({
        id: course.id,
        name: course.name,
        category: String(course.category || '').trim().toLowerCase(),
        tariffs: course.tariffs.map((tariff) => ({
          id: tariff.id,
          name: tariff.name,
          subTariffs: tariff.subTariffs.map((subTariff) => ({
            id: subTariff.id,
            name: subTariff.name,
          })),
        })),
      })),
    };
  }),

  customSalesWidgets: protectedProcedure
    .input(
      z.object({
        range: dashboardRangeSchema,
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        widgets: z
          .array(
            z.object({
              id: z.string().min(1).max(120),
              courseId: z.string().uuid(),
              tariffId: z.string().uuid().nullable().optional(),
              subTariffId: z.string().uuid().nullable().optional(),
            }),
          )
          .max(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!input.widgets.length) {
        return { widgets: [] as Array<{ id: string; salesCount: number; agreementAmount: number }> };
      }

      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);

      const widgetCourseIds = Array.from(new Set(input.widgets.map((widget) => widget.courseId)));
      const widgetTariffIds = Array.from(
        new Set(
          input.widgets
            .map((widget) => widget.tariffId)
            .filter((tariffId): tariffId is string => Boolean(tariffId)),
        ),
      );
      const subTariffWidgets = input.widgets.filter((widget) => Boolean(widget.subTariffId));

      const groupedIncomes = await prisma.income.groupBy({
        by: ['courseId', 'tariffId'],
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: {
            gte: rangeStart,
            lte: rangeEnd,
          },
          courseId: { in: widgetCourseIds },
          ...(widgetTariffIds.length > 0 ? { tariffId: { in: widgetTariffIds } } : {}),
          ...(scope.isScoped
            ? {
                managerUserId: ctx.user.userId,
              }
            : {}),
        },
        _count: {
          _all: true,
        },
        _sum: {
          paymentAmount: true,
          coursePriceAmount: true,
        },
      });

      const subTariffIncomeRows = subTariffWidgets.length > 0
        ? await prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              entryDate: {
                gte: rangeStart,
                lte: rangeEnd,
              },
              OR: subTariffWidgets.map((widget) => ({
                courseId: widget.courseId,
                ...(widget.tariffId ? { tariffId: widget.tariffId } : {}),
              })),
              ...(scope.isScoped
                ? {
                    managerUserId: ctx.user.userId,
                  }
                : {}),
            },
            select: {
              courseId: true,
              tariffId: true,
              paymentAmount: true,
              coursePriceAmount: true,
              customer: {
                select: {
                  profileSubTariffId: true,
                },
              },
            },
          })
        : [];

      const groupedIncomeMap = new Map<string, { salesCount: number; agreementAmount: number }>();
      for (const row of groupedIncomes) {
        groupedIncomeMap.set(
          `${row.courseId}::${row.tariffId || ''}`,
          {
            salesCount: row._count._all,
            agreementAmount: Number(row._sum.coursePriceAmount ?? row._sum.paymentAmount ?? 0),
          },
        );
      }

      const subTariffIncomeMap = new Map<string, { salesCount: number; agreementAmount: number }>();
      for (const income of subTariffIncomeRows) {
        const subTariffId = income.customer?.profileSubTariffId || '';
        if (!subTariffId) {
          continue;
        }
        const key = `${income.courseId}::${income.tariffId || ''}::${subTariffId}`;
        const current = subTariffIncomeMap.get(key) || { salesCount: 0, agreementAmount: 0 };
        current.salesCount += 1;
        current.agreementAmount += Number(income.coursePriceAmount ?? income.paymentAmount ?? 0);
        subTariffIncomeMap.set(key, current);
      }

      const widgets = input.widgets.map((widget) => {
        const tariffKey = widget.tariffId || '';
        const groupedKey = `${widget.courseId}::${tariffKey}`;
        const subTariffKey = `${widget.courseId}::${tariffKey}::${widget.subTariffId || ''}`;
        const baseAggregate = groupedIncomeMap.get(groupedKey) || { salesCount: 0, agreementAmount: 0 };
        const subTariffAggregate = subTariffIncomeMap.get(subTariffKey);

        return {
          id: widget.id,
          salesCount: widget.subTariffId ? (subTariffAggregate?.salesCount ?? 0) : baseAggregate.salesCount,
          agreementAmount: widget.subTariffId ? (subTariffAggregate?.agreementAmount ?? 0) : baseAggregate.agreementAmount,
        };
      });

      return { widgets };
    }),
};
