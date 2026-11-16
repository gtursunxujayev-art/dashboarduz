import { z } from 'zod';

import { asObject } from '../../lib/object';
import { asStringArray } from '../integrations/amocrm-live';

export const dashboardWidgetIdSchema = z.string().min(1).max(120);

export const dashboardCustomSalesWidgetSchema = z.object({
  id: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  courseId: z.string().uuid(),
  tariffId: z.string().uuid().nullable().optional(),
  subTariffId: z.string().uuid().nullable().optional(),
});

export const dashboardLayoutInputSchema = z.object({
  visibleWidgetIds: z.array(dashboardWidgetIdSchema).max(100),
  customSalesWidgets: z.array(dashboardCustomSalesWidgetSchema).max(30),
});

export type DashboardCustomSalesWidget = {
  id: string;
  title: string;
  courseId: string;
  tariffId: string | null;
  subTariffId: string | null;
};

export type DashboardUserLayout = {
  visibleWidgetIds: string[];
  customSalesWidgets: DashboardCustomSalesWidget[];
};

export function normalizeDashboardUserLayout(value: unknown): DashboardUserLayout {
  const row = asObject(value);
  const visibleWidgetIds = asStringArray(row?.visibleWidgetIds);
  const customSalesWidgets = Array.isArray(row?.customSalesWidgets)
    ? row.customSalesWidgets
        .map((item) => {
          const parsed = dashboardCustomSalesWidgetSchema.safeParse(item);

          if (!parsed.success) {
            return null;
          }

          return {
            id: parsed.data.id,
            title: parsed.data.title.trim(),
            courseId: parsed.data.courseId,
            tariffId: parsed.data.tariffId ?? null,
            subTariffId: parsed.data.subTariffId ?? null,
          };
        })
        .filter((item): item is DashboardCustomSalesWidget => Boolean(item))
    : [];

  return {
    visibleWidgetIds,
    customSalesWidgets,
  };
}
