import { describe, expect, it } from '@jest/globals';
import { COURSE_CATEGORY_OPTIONS, getCourseCategoryLabel, getPlanCategoryLabel } from './course-categories';

describe('course category labels', () => {
  it('courses page: Uzbek spelling, unknown shown as is', () => {
    expect(COURSE_CATEGORY_OPTIONS.map((option) => option.label)).toEqual(['Onlayn', 'Oflayn', 'Intensiv', "Qo'shimcha xizmat"]);
    expect(getCourseCategoryLabel('offline')).toBe('Oflayn');
    expect(getCourseCategoryLabel('webinar')).toBe('webinar');
  });

  it('bonus page: English spelling, unknown reads as additional service', () => {
    expect(getPlanCategoryLabel('online')).toBe('Online');
    expect(getPlanCategoryLabel('intensive')).toBe('Intensiv');
    expect(getPlanCategoryLabel('webinar')).toBe("Qo'shimcha xizmat");
  });
});
