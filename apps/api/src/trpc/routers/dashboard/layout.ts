import {
  prisma,
  TRPCError,
  asObject,
  protectedProcedure,
  dashboardLayoutInputSchema,
  normalizeDashboardUserLayout,
  type DashboardCustomSalesWidget,
} from './helpers';

export const layoutProcedures = {
  getUserLayout: protectedProcedure.query(async ({ ctx }) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });

    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const settings = asObject(tenant.settings) || {};
    const dashboardUserLayouts = asObject(settings?.dashboardUserLayouts) || {};
    const userLayout = normalizeDashboardUserLayout(dashboardUserLayouts?.[ctx.user.userId]);

    return userLayout;
  }),

  saveUserLayout: protectedProcedure
    .input(dashboardLayoutInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      });

      if (!tenant) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      }

      const uniqueVisibleWidgetIds = Array.from(
        new Set(input.visibleWidgetIds.map((item) => item.trim()).filter(Boolean)),
      );
      const customWidgetById = new Map<string, DashboardCustomSalesWidget>();
      for (const item of input.customSalesWidgets) {
        const id = item.id.trim();
        if (!id) {
          continue;
        }
        customWidgetById.set(id, {
          id,
          title: item.title.trim(),
          courseId: item.courseId,
          tariffId: item.tariffId ?? null,
          subTariffId: item.subTariffId ?? null,
        });
      }

      const settings = asObject(tenant.settings) || {};
      const dashboardUserLayouts = asObject(settings?.dashboardUserLayouts) || {};
      dashboardUserLayouts[ctx.user.userId] = {
        visibleWidgetIds: uniqueVisibleWidgetIds,
        customSalesWidgets: Array.from(customWidgetById.values()),
        updatedAt: new Date().toISOString(),
      };

      await prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          settings: JSON.parse(
            JSON.stringify({
              ...settings,
              dashboardUserLayouts,
            }),
          ),
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'dashboard_layout_update',
          resource: 'tenant_settings',
          resourceId: ctx.tenantId,
          metadata: {
            visibleWidgetCount: uniqueVisibleWidgetIds.length,
            customWidgetCount: customWidgetById.size,
          },
        },
      });

      return {
        visibleWidgetIds: uniqueVisibleWidgetIds,
        customSalesWidgets: Array.from(customWidgetById.values()),
      };
    }),
};
