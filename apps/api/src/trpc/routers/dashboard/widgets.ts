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

      const incomes = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: {
            gte: rangeStart,
            lte: rangeEnd,
          },
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
      });

      const widgets = input.widgets.map((widget) => {
        let salesCount = 0;
        let agreementAmount = 0;
        for (const income of incomes) {
          if (income.courseId !== widget.courseId) {
            continue;
          }
          if (widget.tariffId && income.tariffId !== widget.tariffId) {
            continue;
          }
          if (widget.subTariffId && income.customer?.profileSubTariffId !== widget.subTariffId) {
            continue;
          }

          salesCount += 1;
          agreementAmount += income.coursePriceAmount ?? income.paymentAmount ?? 0;
        }

        return {
          id: widget.id,
          salesCount,
          agreementAmount,
        };
      });

      return { widgets };
    }),
};
