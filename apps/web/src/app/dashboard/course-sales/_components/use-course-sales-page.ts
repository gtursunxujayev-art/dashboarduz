'use client';

import { useCourseSalesActions } from './use-course-sales-actions';
import { useCourseSalesState } from './use-course-sales-state';

// All filters, queries and handlers of the course sales page, built by the hooks above in their original order.
export function useCourseSalesPage() {
  return useCourseSalesActions(useCourseSalesState());
}

export type CourseSalesPageModel = ReturnType<typeof useCourseSalesPage>;
