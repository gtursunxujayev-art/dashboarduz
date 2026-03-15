'use client';

import { useEffect, useMemo, useState } from 'react';
import AnalyticsCharts from '@/components/dashboard/analytics-charts';
import { trpc } from '@/lib/trpc';
import MultiSelectDropdown from '@/components/dashboard/multi-select-dropdown';

type DashboardRange = 'today' | 'week' | 'month';

export default function AnalyticsPage() {
  const [range, setRange] = useState<DashboardRange>('month');
  const [pipelineIds, setPipelineIds] = useState<string[]>([]);
  const amoPipelinesQuery = trpc.integrations.getAmoCRMPipelines.useQuery(undefined, {
    retry: false,
  });
  const pipelineOptions = useMemo(() => {
    const pipelines = amoPipelinesQuery.data?.pipelines || [];
    return pipelines.map((pipeline: any) => ({
      id: pipeline.id,
      label: pipeline.name,
    }));
  }, [amoPipelinesQuery.data]);

  useEffect(() => {
    if (!amoPipelinesQuery.data) {
      return;
    }

    if (amoPipelinesQuery.data.hasExplicitSelection) {
      setPipelineIds(amoPipelinesQuery.data.selectedPipelineIds);
      return;
    }

    setPipelineIds((amoPipelinesQuery.data.pipelines || []).map((pipeline: any) => pipeline.id));
  }, [amoPipelinesQuery.data]);

  const summaryQuery = trpc.dashboard.summary.useQuery(
    { range, pipelineIds },
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
          Non-qualified reasons and lead-source distribution from live AmoCRM data.
        </p>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="px-4 py-5 sm:p-6">
          <div className="mb-4 max-w-md">
            <MultiSelectDropdown
              label="Pipelines Filter"
              options={pipelineOptions}
              selectedIds={pipelineIds}
              onChange={setPipelineIds}
              placeholder="Select pipelines"
              disabled={amoPipelinesQuery.isLoading}
            />
          </div>
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
