'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import AnalyticsCharts from '@/components/dashboard/analytics-charts';

type DashboardRange = 'today' | 'week' | 'month' | 'custom';
const RANGE_OPTIONS: DashboardRange[] = ['today', 'week', 'month', 'custom'];

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

function getRangeLabel(range: DashboardRange): string {
  if (range === 'week') return 'Hafta';
  if (range === 'month') return 'Oy';
  if (range === 'custom') return 'Ixtiyoriy';
  return 'Bugun';
}

export default function AnalyticsPage() {
  const [range, setRange] = useState<DashboardRange>('today');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());

  const summaryQuery = trpc.dashboard.summary.useQuery(
    {
      range,
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
        <h1 className="text-2xl font-semibold text-gray-900">Tahlil</h1>
        <p className="mt-1 text-sm text-gray-500">Lid va manba bo&apos;yicha tahlillar.</p>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="px-4 py-5 sm:p-6">
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <div className="inline-flex min-w-max rounded-md shadow-sm">
                {RANGE_OPTIONS.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRange(option)}
                    className={`border border-gray-300 px-4 py-2 text-sm font-medium ${
                      range === option ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    } ${index === 0 ? 'rounded-l-md' : ''} ${
                      index === RANGE_OPTIONS.length - 1 ? 'rounded-r-md' : ''
                    } ${index !== 0 ? 'border-l-0' : ''}`}
                  >
                    {getRangeLabel(option)}
                  </button>
                ))}
              </div>
            </div>

            {range === 'custom' && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <AnalyticsCharts
        data={summaryQuery.data as any}
        isLoading={summaryQuery.isLoading}
        isError={Boolean(summaryQuery.error)}
      />
    </div>
  );
}
