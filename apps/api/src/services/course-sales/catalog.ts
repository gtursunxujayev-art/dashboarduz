import type { DbClient } from '@dashboarduz/db';

import { buildCategoryLabel } from './helpers';

/** Active tariffs of a course with their active sub-tariffs, by name. */
export const ACTIVE_TARIFFS_WITH_SUB_TARIFFS_SELECT = {
  where: { isActive: true },
  orderBy: [{ name: 'asc' as const }],
  select: {
    id: true,
    name: true,
    subTariffs: {
      where: { isActive: true },
      orderBy: [{ name: 'asc' as const }],
      select: {
        id: true,
        name: true,
      },
    },
  },
};

export type CatalogCourse = {
  id: string;
  name: string;
  /** Lower-cased, trimmed course category (`online`, `offline`, ...). */
  category: string;
  tariffs: Array<{
    id: string;
    name: string;
    subTariffs: Array<{ id: string; name: string }>;
  }>;
};

/** `{ id, name, category, categoryLabel }` of a course, as the course-sales screens show it. */
export function describeCourse(course: { id: string; name: string; category: string | null }) {
  return {
    id: course.id,
    name: course.name,
    category: String(course.category || '').trim().toLowerCase(),
    categoryLabel: buildCategoryLabel(String(course.category || '')),
  };
}

/**
 * The tenant's active courses (optionally of one category) with active tariffs and sub-tariffs,
 * sorted by name. Shared by the course-sales filters, dashboard widgets and bonus-plan pickers.
 */
export async function loadActiveCourseCatalog(params: {
  db: DbClient;
  tenantId: string;
  category?: string;
}): Promise<CatalogCourse[]> {
  const courses = await params.db.course.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
      ...(params.category ? { category: params.category } : {}),
    },
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      name: true,
      category: true,
      tariffs: ACTIVE_TARIFFS_WITH_SUB_TARIFFS_SELECT,
    },
  });

  return courses.map((course) => ({
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
  }));
}
