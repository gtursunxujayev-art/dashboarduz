'use client';

import { DashboardLayoutEditor } from './_components/dashboard-layout-editor';
import { DashboardMetrics } from './_components/dashboard-metrics';
import { DashboardRangeHeader } from './_components/dashboard-range-header';
import { useDashboardPage } from './_components/use-dashboard-page';

export default function DashboardPage() {
  const vm = useDashboardPage();

  return (
    <div className="space-y-6">
      <DashboardLayoutEditor vm={vm} />

      <DashboardRangeHeader vm={vm} />

      <DashboardMetrics vm={vm} />
    </div>
  );
}
