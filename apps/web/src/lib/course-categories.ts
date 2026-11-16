import { COURSE_CATEGORIES, type CourseCategory } from '@dashboarduz/shared';

/**
 * Category labels. The courses page and the bonus page spell two of them differently
 * ("Onlayn"/"Oflayn" vs "Online"/"Offline"); both are kept until the product picks one.
 */
export const COURSE_CATEGORY_LABELS: Record<CourseCategory, string> = {
  online: 'Onlayn',
  offline: 'Oflayn',
  intensive: 'Intensiv',
  additional_service: "Qo'shimcha xizmat",
};

export const PLAN_CATEGORY_LABELS: Record<CourseCategory, string> = {
  online: 'Online',
  offline: 'Offline',
  intensive: 'Intensiv',
  additional_service: "Qo'shimcha xizmat",
};

/** Value/label pairs for category selects, in the canonical order. */
export const COURSE_CATEGORY_OPTIONS: Array<{ value: CourseCategory; label: string }> = COURSE_CATEGORIES.map((value) => ({
  value,
  label: COURSE_CATEGORY_LABELS[value],
}));

/** Courses page label; an unknown category is shown as it is. */
export function getCourseCategoryLabel(category: string): string {
  return COURSE_CATEGORY_LABELS[category as CourseCategory] || category;
}

/** Bonus plan label; anything other than online/offline/intensive reads as additional service. */
export function getPlanCategoryLabel(category: string): string {
  return category in PLAN_CATEGORY_LABELS && category !== 'additional_service'
    ? PLAN_CATEGORY_LABELS[category as CourseCategory]
    : PLAN_CATEGORY_LABELS.additional_service;
}
