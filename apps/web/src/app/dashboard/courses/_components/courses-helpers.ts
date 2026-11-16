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
