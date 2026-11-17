'use client';

import { CustomerCoursesSheet } from '../course-sales-kit';
import type { CategorySalesViewModel } from './use-category-sales-view';

/** Admin-only right sheet for changing or deleting a customer's courses. */
export function CategoryCourseEditorModal({ vm }: { vm: CategorySalesViewModel }) {
  return <CustomerCoursesSheet vm={vm} />;
}
