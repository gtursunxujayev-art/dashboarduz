'use client';

import { CustomerCoursesSheet } from '@/components/dashboard/course-sales/course-sales-kit';
import type { CourseDetailPageModel } from './use-course-detail-page';

/** Admin-only right sheet for changing or deleting a customer's courses. */
export function DetailCourseEditorModal({ vm }: { vm: CourseDetailPageModel }) {
  return <CustomerCoursesSheet vm={vm} />;
}
