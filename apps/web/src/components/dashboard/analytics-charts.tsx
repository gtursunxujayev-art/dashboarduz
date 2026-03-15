'use client';

import { trpc } from '@/lib/trpc';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

type LeadStatusDatum = {
  name: string;
  value: number;
  color: string;
};

type MonthlyLeadsDatum = {
  month: string;
  leads: number;
};

type CallMetricDatum = {
  name: string;
  value: number;
};

type IntegrationActivityDatum = {
  name: string;
  active: number;
  errors: number;
};

type DashboardSummaryData = {
  leadStatusData: LeadStatusDatum[];
  monthlyLeadsData: MonthlyLeadsDatum[];
  callMetricsData: CallMetricDatum[];
  integrationActivityData: IntegrationActivityDatum[];
  summary: {
    totalLeads: number;
    conversionRate: number;
    avgCallDurationSeconds: number;
    pendingNotifications: number;
  };
  updatedAt: string;
};

const EMPTY_DASHBOARD_SUMMARY: DashboardSummaryData = {
  leadStatusData: [],
  monthlyLeadsData: [],
  callMetricsData: [],
  integrationActivityData: [],
  summary: {
    totalLeads: 0,
    conversionRate: 0,
    avgCallDurationSeconds: 0,
    pendingNotifications: 0,
  },
  updatedAt: '',
};

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) {
    return '0s';
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

function NoChartData({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center rounded-md border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-500">
      {label}
    </div>
  );
}

export default function AnalyticsCharts() {
  const summaryQuery = trpc.dashboard.summary.useQuery(undefined, {
    retry: 1,
    refetchInterval: 5 * 60 * 1000,
  });

  const summaryData: DashboardSummaryData = summaryQuery.data ?? EMPTY_DASHBOARD_SUMMARY;
  const leadStatusData = summaryData.leadStatusData;
  const monthlyLeadsData = summaryData.monthlyLeadsData;
  const callMetricsData = summaryData.callMetricsData;
  const integrationActivityData = summaryData.integrationActivityData;

  const hasLeadStatusData = leadStatusData.some((item) => item.value > 0);
  const hasMonthlyLeadsData = monthlyLeadsData.some((item) => item.leads > 0);
  const hasCallMetricsData = callMetricsData.some((item) => item.value > 0);
  const hasIntegrationData = integrationActivityData.some((item) => item.active > 0 || item.errors > 0);
  const updatedAtText = summaryData.updatedAt ? new Date(summaryData.updatedAt).toLocaleString() : 'Not available';

  return (
    <div className="space-y-6">
      {summaryQuery.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load analytics data.
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lead Status Distribution */}
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Lead Status Distribution</h4>
          <div className="h-64">
            {hasLeadStatusData ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={leadStatusData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }: { name: string; percent?: number }) => `${name}: ${(((percent ?? 0) * 100).toFixed(0))}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {leadStatusData.map((entry, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => [`${value} leads`, 'Count']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <NoChartData label="No lead status data yet" />
            )}
          </div>
        </div>

        {/* Leads Trend */}
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Leads Trend (Last 6 Months)</h4>
          <div className="h-64">
            {hasMonthlyLeadsData ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyLeadsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" stroke="#666" />
                  <YAxis stroke="#666" />
                  <Tooltip
                    formatter={(value: number) => [`${value} leads`, 'Count']}
                    labelFormatter={(label: string) => `Month: ${label}`}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="leads"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    dot={{ stroke: '#3B82F6', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <NoChartData label="No lead trend data yet" />
            )}
          </div>
        </div>

        {/* Call Metrics */}
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Call Metrics</h4>
          <div className="h-64">
            {hasCallMetricsData ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={callMetricsData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" stroke="#666" />
                  <YAxis stroke="#666" />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <NoChartData label="No call metrics data yet" />
            )}
          </div>
        </div>

        {/* Integration Activity */}
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <h4 className="text-sm font-medium text-gray-900 mb-4">Integration Activity</h4>
          <div className="h-64">
            {hasIntegrationData ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={integrationActivityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" stroke="#666" />
                  <YAxis stroke="#666" />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="active" name="Active" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="errors" name="Errors" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <NoChartData label="No integration activity data yet" />
            )}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-blue-100 rounded-md p-2">
              <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-blue-900">Total Leads</p>
              <p className="text-2xl font-semibold text-blue-700">{summaryData.summary.totalLeads}</p>
            </div>
          </div>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-green-100 rounded-md p-2">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-green-900">Conversion Rate</p>
              <p className="text-2xl font-semibold text-green-700">{summaryData.summary.conversionRate.toFixed(2)}%</p>
            </div>
          </div>
        </div>

        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-purple-100 rounded-md p-2">
              <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-purple-900">Avg Call Duration</p>
              <p className="text-2xl font-semibold text-purple-700">
                {formatDuration(summaryData.summary.avgCallDurationSeconds)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 bg-yellow-100 rounded-md p-2">
              <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-yellow-900">Pending Notifications</p>
              <p className="text-2xl font-semibold text-yellow-700">{summaryData.summary.pendingNotifications}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Data Last Updated */}
      <div className="text-xs text-gray-500 text-center">
        <p>Data updated: {updatedAtText}</p>
        <p className="mt-1">Charts refresh automatically every 5 minutes</p>
      </div>
    </div>
  );
}
