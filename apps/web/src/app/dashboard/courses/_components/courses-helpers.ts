import type { CourseCategory } from '@dashboarduz/shared';

export type TariffItem = {
  id: string;
  name: string;
  isActive: boolean;
  courseId: string;
  subTariffs: SubTariffItem[];
};

export type SubTariffItem = {
  id: string;
  name: string;
  isActive: boolean;
  tariffId: string;
};

export type CourseItem = {
  id: string;
  name: string;
  category: CourseCategory;
  startDate: Date | string | null;
  endDate: Date | string | null;
  isActive: boolean;
  isHiddenFromIncomeForm: boolean;
  tariffs: TariffItem[];
};

export function toDateInputValue(value: Date | string | null | undefined): string {
  if (!value) {
    return '';
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return '';
    }
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

export type CourseGroup = { value: string; label: string; courses: CourseItem[] };

/**
 * Splits the catalog into active courses (every category, as before) and the archive: inactive
 * ("Faolsiz") courses, only in categories that have some.
 */
export function splitArchivedCourses<T extends CourseGroup>(groups: T[]): { active: T[]; archived: T[]; archivedCount: number } {
  const active = groups.map((group) => ({ ...group, courses: group.courses.filter((course) => course.isActive) }));
  const archived = groups
    .map((group) => ({ ...group, courses: group.courses.filter((course) => !course.isActive) }))
    .filter((group) => group.courses.length > 0);

  return { active, archived, archivedCount: archived.reduce((total, group) => total + group.courses.length, 0) };
}
