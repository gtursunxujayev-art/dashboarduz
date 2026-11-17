'use client';

import { PageHeader } from '@/components/ui/page-header';
import { DashboardLayoutEditor } from './_components/dashboard-layout-editor';
import { DashboardMetrics } from './_components/dashboard-metrics';
import { DashboardRangeHeader } from './_components/dashboard-range-header';
import { useDashboardPage } from './_components/use-dashboard-page';

export default function DashboardPage() {
  const vm = useDashboardPage();

  return (
    <div className="space-y-5">
      <PageHeader title="Boshqaruv" actions={<DashboardRangeHeader vm={vm} />} />

      <DashboardLayoutEditor vm={vm} />

      <DashboardMetrics vm={vm} />
    </div>
  );
}
