import type { DbClient } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';

import { CANONICAL_COURSE_CATEGORIES } from './constants';

function normalizeCourseCategoryValue(value: unknown): string {
  const normalized = String(value || '').trim().toLowerCase();

  if (!normalized) {
    return 'offline';
  }
  if (CANONICAL_COURSE_CATEGORIES.has(normalized)) {
    return normalized;
  }
  if (normalized === 'ofline' || normalized === 'offlayn' || normalized === 'offline_course') {
    return 'offline';
  }
  if (normalized === 'onlayn' || normalized === 'online_course') {
    return 'online';
  }
  if (normalized === 'intensiv') {
    return 'intensive';
  }
  if (normalized === "qo'shimcha_xizmat" || normalized === 'qoshimcha_xizmat' || normalized === 'additional') {
    return 'additional_service';
  }

  return 'offline';
}

type CourseWithTariffsSafe = {
  id: string;
  name: string;
  category: string;
  startDate: Date | null;
  endDate: Date | null;
  isActive: boolean;
  isHiddenFromIncomeForm: boolean;
  createdAt: Date;
  updatedAt: Date;
  tariffs: Array<{
    id: string;
    name: string;
    isActive: boolean;
    courseId: string;
    createdAt: Date;
    updatedAt: Date;
    subTariffs: Array<{
      id: string;
      name: string;
      isActive: boolean;
      tariffId: string;
      createdAt: Date;
      updatedAt: Date;
    }>;
  }>;
};

export async function fetchCoursesWithTariffsSafe(params: {
  tenantId: string;
  onlyActive: boolean;
  excludeHiddenFromIncomeForm?: boolean;
  db: DbClient;
}): Promise<CourseWithTariffsSafe[]> {
  const { db } = params;

  const baseWhere: Prisma.CourseWhereInput = params.onlyActive
    ? { tenantId: params.tenantId, isActive: true }
    : { tenantId: params.tenantId };
  const where: Prisma.CourseWhereInput = {
    ...baseWhere,
    ...(params.excludeHiddenFromIncomeForm ? { isHiddenFromIncomeForm: false } : {}),
  };

  const courses = await db.course.findMany({
    where,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      category: true,
      startDate: true,
      endDate: true,
      isActive: true,
      isHiddenFromIncomeForm: true,
      createdAt: true,
      updatedAt: true,
      tariffs: {
        where: params.onlyActive ? { isActive: true } : undefined,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          isActive: true,
          courseId: true,
          createdAt: true,
          updatedAt: true,
          subTariffs: {
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
              isActive: true,
              tariffId: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });

  return (courses as CourseWithTariffsSafe[]).map((course) => ({
    ...course,
    category: normalizeCourseCategoryValue(course.category),
  }));
}

export async function fetchCourseOptionsSafe(tenantId: string, db: DbClient): Promise<Array<{ id: string; name: string; category: string }>> {
  const courses = await db.course.findMany({
    where: { tenantId, isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      category: true,
    },
  });

  return (courses as Array<{ id: string; name: string; category: string }>).map((course) => ({
    ...course,
    category: normalizeCourseCategoryValue(course.category),
  }));
}
