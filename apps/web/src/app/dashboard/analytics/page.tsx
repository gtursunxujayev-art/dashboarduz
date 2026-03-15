'use client';

import { useState } from 'react';
import AnalyticsCharts from '@/components/dashboard/analytics-charts';
import { trpc } from '@/lib/trpc';

type DashboardRange = 'today' | 'week' | 'month';

export default function AnalyticsPage() {
  const [range, setRange] = useState<DashboardRange>('month');
  const summaryQuery = trpc.dashboard.summary.useQuery(
    { range },
    {
      retry: 1,
      refetchInterval: 5 * 60 * 1000,
    },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Non-qualified reasons and lead-source distribution from AmoCRM ingestion data.
        </p>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="px-4 py-5 sm:p-6">
          <AnalyticsCharts
            range={range}
            onRangeChange={setRange}
            data={summaryQuery.data}
            isLoading={summaryQuery.isLoading}
            isError={summaryQuery.isError}
          />
        </div>
      </div>
    </div>
  );
}
