'use client';

import { useAttendancePageState } from './use-attendance-page-state';

// All filters, queries and handlers of the attendance page.
export function useAttendancePage() {
  return useAttendancePageState();
}

export type AttendancePageModel = ReturnType<typeof useAttendancePage>;
