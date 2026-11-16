'use client';

import { useCoursesPageState } from './use-courses-page-state';

// All catalog state, queries and handlers of the courses page.
export function useCoursesPage() {
  return useCoursesPageState();
}

export type CoursesPageModel = ReturnType<typeof useCoursesPage>;
