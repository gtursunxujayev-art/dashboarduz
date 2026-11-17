'use client';

import { CustomerCoursesSheet } from '@/components/dashboard/course-sales/course-sales-kit';
import type { CourseSalesPageModel } from './use-course-sales-page';

/** Admin-only right sheet for changing or deleting a customer's courses. */
export function CourseEditorModal({ vm }: { vm: CourseSalesPageModel }) {
  return <CustomerCoursesSheet vm={vm} />;
}
