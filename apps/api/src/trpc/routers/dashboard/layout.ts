import { asObject } from '../../../lib/object';
import { loadTenantSettings, saveTenantSettings } from '../../../lib/tenant-settings';

import {
  protectedProcedure,
  dashboardLayoutInputSchema,
  normalizeDashboardUserLayout,
  type DashboardCustomSalesWidget,
} from './helpers';

export const layoutProcedures = {
  getUserLayout: protectedProcedure.query(async ({ ctx }) => {
    const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);

    const settings = asObject(tenantSettings) || {};
    const dashboardUserLayouts = asObject(settings?.dashboardUserLayouts) || {};
    const userLayout = normalizeDashboardUserLayout(dashboardUserLayouts?.[ctx.user.userId]);

    return userLayout;
  }),

  saveUserLayout: protectedProcedure
    .input(dashboardLayoutInputSchema)
    .mutation(async ({ ctx, input }) => {
      const tenantSettings = await loadTenantSettings(ctx.db, ctx.tenantId);

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

      const settings = asObject(tenantSettings) || {};
      const dashboardUserLayouts = asObject(settings?.dashboardUserLayouts) || {};

      dashboardUserLayouts[ctx.user.userId] = {
        visibleWidgetIds: uniqueVisibleWidgetIds,
        customSalesWidgets: Array.from(customWidgetById.values()),
        updatedAt: new Date().toISOString(),
      };

      await saveTenantSettings({
        db: ctx.db,
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.userId,
        settings: {
          ...settings,
          dashboardUserLayouts,
        },
        auditAction: 'dashboard_layout_update',
        auditMetadata: {
          visibleWidgetCount: uniqueVisibleWidgetIds.length,
          customWidgetCount: customWidgetById.size,
        },
      });

      return {
        visibleWidgetIds: uniqueVisibleWidgetIds,
        customSalesWidgets: Array.from(customWidgetById.values()),
      };
    }),
};
