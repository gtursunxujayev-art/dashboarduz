'use client';

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

type DashboardRange = 'today' | 'week' | 'month' | 'custom';

type PieDatum = {
  name: string;
  value: number;
  color: string;
};

type DashboardSummaryResponse = {
  range: DashboardRange;
  summary: {
    totalLeads: number;
    totalCalls: number;
    pendingNotifications: number;
    activeIntegrations: number;
  };
  pieCharts: {
    nonQualifiedByReason: {
      fieldKey: string | null;
      fieldLabel: string | null;
      data: PieDatum[];
    };
    newLeadsBySource: {
      fieldKey: string | null;
      fieldLabel: string | null;
      data: PieDatum[];
    };
  };
  updatedAt: string;
};

interface AnalyticsChartsProps {
  range: DashboardRange;
  onRangeChange: (range: DashboardRange) => void;
  data?: DashboardSummaryResponse;
  isLoading?: boolean;
  isError?: boolean;
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 text-center text-sm text-gray-500">
      {text}
    </div>
  );
}

function PieCard({
  title,
  subtitle,
  points,
  emptyText,
}: {
  title: string;
  subtitle: string;
  points: PieDatum[];
  emptyText: string;
}) {
  const hasData = points.length > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h4 className="text-base font-semibold text-gray-900">{title}</h4>
      <p className="mt-1 text-sm text-gray-500">{subtitle}</p>

      <div className="mt-4">
        {hasData ? (
          <>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={points}
                    cx="50%"
                    cy="50%"
                    dataKey="value"
                    nameKey="name"
                    outerRadius={100}
                    label={({ percent }: { percent?: number }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine
                  >
                    {points.map((point, index) => (
                      <Cell key={`cell-${index}`} fill={point.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [value, 'Count']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {points.map((point) => (
                <div key={point.name} className="flex items-start gap-2 text-sm text-gray-700">
                  <span
                    className="mt-1 inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: point.color }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="truncate">{point.name}</p>
                    <p className="font-semibold">{point.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyPanel text={emptyText} />
        )}
      </div>
    </div>
  );
}

export default function AnalyticsCharts({
  range,
  onRangeChange,
  data,
  isLoading = false,
  isError = false,
}: AnalyticsChartsProps) {
  const reasonChart = data?.pieCharts.nonQualifiedByReason;
  const sourceChart = data?.pieCharts.newLeadsBySource;

  const rangeOptions: DashboardRange[] = ['today', 'week', 'month', 'custom'];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div className="inline-flex rounded-md shadow-sm">
          {rangeOptions.map((option, index) => (
            <button
              key={option}
              type="button"
              onClick={() => onRangeChange(option)}
              className={`border border-gray-300 px-4 py-2 text-sm font-medium capitalize ${
                range === option ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              } ${index === 0 ? 'rounded-l-md' : ''} ${
                index === rangeOptions.length - 1 ? 'rounded-r-md' : ''
              } ${index !== 0 ? 'border-l-0' : ''}`}
            >
              {option === 'week'
                ? 'This week'
                : option === 'month'
                  ? 'This month'
                  : option === 'custom'
                    ? 'Custom'
                    : 'Today'}
            </button>
          ))}
        </div>
      </div>

      {isError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load dashboard analytics.
        </div>
      )}

      {isLoading && (
        <div className="rounded-md border border-gray-200 bg-white px-3 py-3 text-sm text-gray-600">
          Loading analytics...
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <PieCard
          title="Non-Qualified Leads by Reason"
          subtitle={
            reasonChart?.fieldLabel
              ? `Grouped by "${reasonChart.fieldLabel}" field in selected period.`
              : 'Choose a reason field in Settings to render this chart.'
          }
          points={reasonChart?.data ?? []}
          emptyText={
            reasonChart?.fieldKey
              ? 'No non-qualified lead reasons found for this period.'
              : 'Configure Reason Field in Settings first.'
          }
        />

        <PieCard
          title="New Leads by Source"
          subtitle={
            sourceChart?.fieldLabel
              ? `Grouped by "${sourceChart.fieldLabel}" field in selected period.`
              : 'Choose a source field in Settings to render this chart.'
          }
          points={sourceChart?.data ?? []}
          emptyText={
            sourceChart?.fieldKey
              ? 'No source data found for this period.'
              : 'Configure Source Field in Settings first.'
          }
        />
      </div>

      <p className="text-center text-xs text-gray-500">
        Data updated: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'Not available'}
      </p>
    </div>
  );
}
