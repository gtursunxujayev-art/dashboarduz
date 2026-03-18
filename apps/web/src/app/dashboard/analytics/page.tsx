'use client';

import { useEffect, useMemo, useState } from 'react';
import AnalyticsCharts from '@/components/dashboard/analytics-charts';
import { trpc } from '@/lib/trpc';
import MultiSelectDropdown from '@/components/dashboard/multi-select-dropdown';
import { useAuth } from '@/contexts/auth-context';

type DashboardRange = 'today' | 'week' | 'month' | 'custom';

function getTashkentToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.roles.includes('Admin'));
  const [range, setRange] = useState<DashboardRange>('month');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [pipelineIds, setPipelineIds] = useState<string[]>([]);
  const amoPipelinesQuery = trpc.integrations.getAmoCRMPipelines.useQuery(undefined, {
    retry: false,
    enabled: isAdmin,
  });
  const pipelineOptions = useMemo(() => {
    const pipelines = amoPipelinesQuery.data?.pipelines || [];
    return pipelines.map((pipeline: any) => ({
      id: pipeline.id,
      label: pipeline.name,
    }));
  }, [amoPipelinesQuery.data]);

  useEffect(() => {
    if (!amoPipelinesQuery.data || !isAdmin) {
      return;
    }

    if (amoPipelinesQuery.data.hasExplicitSelection) {
      setPipelineIds(amoPipelinesQuery.data.selectedPipelineIds);
      return;
    }

    setPipelineIds((amoPipelinesQuery.data.pipelines || []).map((pipeline: any) => pipeline.id));
  }, [amoPipelinesQuery.data, isAdmin]);

  const summaryQuery = trpc.dashboard.summary.useQuery(
    {
      range,
      pipelineIds: isAdmin ? pipelineIds : undefined,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
    },
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
          <div className={`mb-4 grid grid-cols-1 gap-3 ${isAdmin ? 'md:grid-cols-[180px_180px_180px_1fr]' : 'md:grid-cols-[180px_180px_180px]'}`}>
            <select
              value={range}
              onChange={(event) => setRange(event.target.value as DashboardRange)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="custom">Custom</option>
            </select>
            <input
              type="date"
              value={dateFrom}
              disabled={range !== 'custom'}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
            />
            <input
              type="date"
              value={dateTo}
              disabled={range !== 'custom'}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
            />
            {isAdmin && (
              <MultiSelectDropdown
                label="Pipelines Filter"
                options={pipelineOptions}
                selectedIds={pipelineIds}
                onChange={setPipelineIds}
                placeholder="Select pipelines"
                disabled={amoPipelinesQuery.isLoading}
              />
            )}
          </div>
          <AnalyticsCharts
            data={summaryQuery.data}
            isLoading={summaryQuery.isLoading}
            isError={summaryQuery.isError}
          />
        </div>
      </div>
    </div>
  );
}
