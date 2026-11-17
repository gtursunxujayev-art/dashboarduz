import {
  adjustmentStatusSchema,
  adjustmentTypeSchema,
  COURSE_CATEGORIES,
  COURSE_CATEGORY_LABELS,
  courseCategoryLabel,
  courseCategorySchema,
  courseTypeCategorySchema,
  createCourseSchema,
  debtFilterSchema,
  funnelGroupSchema,
  managerGroupSchema,
  reportRangeSchema,
  sellerRangeSchema,
} from '@dashboarduz/shared';

import { PLAN_BONUS_CATEGORIES, SALARY_CATEGORIES } from '../../trpc/routers/dashboard/helpers';

describe('shared input enums', () => {
  it('report ranges: the sellers report alone accepts last30days', () => {
    expect(reportRangeSchema.options).toEqual(['today', 'week', 'month', 'custom']);
    expect(sellerRangeSchema.options).toEqual(['today', 'week', 'month', 'last30days', 'custom']);
    expect(reportRangeSchema.safeParse('last30days').success).toBe(false);
  });

  it('course categories back the course form and the salary/plan bonus settings', () => {
    expect(courseCategorySchema.options).toEqual(['online', 'offline', 'intensive', 'additional_service']);
    expect(courseTypeCategorySchema.options).toEqual(['online', 'offline', 'intensive']);
    expect(SALARY_CATEGORIES).toBe(COURSE_CATEGORIES);
    expect(PLAN_BONUS_CATEGORIES).toBe(COURSE_CATEGORIES);
    expect(createCourseSchema.safeParse({ name: 'X', category: 'webinar' }).success).toBe(false);
  });

  it('keeps the other filter values', () => {
    expect(adjustmentTypeSchema.options).toEqual(['refund', 'tariff_change']);
    expect(adjustmentStatusSchema.options).toEqual(['pending', 'approved', 'rejected']);
    expect(debtFilterSchema.options).toEqual(['all', 'with_debt', 'without_debt']);
    expect(managerGroupSchema.options).toEqual(['online', 'offline']);
    expect(funnelGroupSchema.options).toEqual(['all', 'online', 'offline']);
  });
});

describe('courseCategoryLabel (one set of category labels in API output)', () => {
  it('uses Onlayn/Oflayn and the Uzbek names', () => {
    expect(courseCategoryLabel('online')).toBe('Onlayn');
    expect(courseCategoryLabel(' Offline ')).toBe('Oflayn');
    expect(courseCategoryLabel('intensive')).toBe('Intensiv');
    expect(courseCategoryLabel('additional_service')).toBe("Qo'shimcha xizmat");
    expect(courseCategoryLabel('vip')).toBe("Noma'lum");
    expect(courseCategoryLabel(null)).toBe("Noma'lum");
    expect(COURSE_CATEGORY_LABELS.offline).toBe('Oflayn');
  });
});
