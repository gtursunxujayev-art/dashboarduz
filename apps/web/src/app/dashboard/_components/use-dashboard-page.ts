'use client';

import { useDashboardData } from './use-dashboard-data';
import { useDashboardLayout } from './use-dashboard-layout';

// All state, queries, cards and layout handlers of the dashboard home page, built by the hooks above in their original order.
export function useDashboardPage() {
  return useDashboardLayout(useDashboardData());
}

export type DashboardPageModel = ReturnType<typeof useDashboardPage>;
