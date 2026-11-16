'use client';

import { useCourseDetailActions } from './use-course-detail-actions';
import { useCourseDetailState } from './use-course-detail-state';

// All filters, queries and handlers of the course sales detail page, built by the hooks above in their original order.
export function useCourseDetailPage() {
  return useCourseDetailActions(useCourseDetailState());
}

export type CourseDetailPageModel = ReturnType<typeof useCourseDetailPage>;
