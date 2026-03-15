'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import LeadsTable from '@/components/dashboard/leads-table';
import AnalyticsCharts from '@/components/dashboard/analytics-charts';
import { trpc } from '@/lib/trpc';

type DashboardRange = 'today' | 'week' | 'month';

export default function DashboardPage() {
  const { user } = useAuth();
  const [range, setRange] = useState<DashboardRange>('month');

  const summaryQuery = trpc.dashboard.summary.useQuery(
    { range },
    {
      retry: 1,
      refetchInterval: 5 * 60 * 1000,
    },
  );

  const stats = summaryQuery.data?.summary;

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="px-4 py-5 sm:p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0 rounded-md bg-blue-500 p-3">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="ml-5">
              <h3 className="text-lg font-medium leading-6 text-gray-900">
                Welcome back, {user?.email?.split('@')[0] || user?.phone || 'User'}!
              </h3>
              <p className="mt-1 text-sm text-gray-500">Your lead analytics now come live from AmoCRM, while webhooks continue tracking lead changes.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="overflow-hidden rounded-lg bg-white shadow">
          <div className="p-5">
            <p className="text-sm font-medium text-gray-500">Total Leads</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{stats?.totalLeads ?? 0}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg bg-white shadow">
          <div className="p-5">
            <p className="text-sm font-medium text-gray-500">Total Calls</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{stats?.totalCalls ?? 0}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg bg-white shadow">
          <div className="p-5">
            <p className="text-sm font-medium text-gray-500">Pending Notifications</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{stats?.pendingNotifications ?? 0}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg bg-white shadow">
          <div className="p-5">
            <p className="text-sm font-medium text-gray-500">Active Integrations</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{stats?.activeIntegrations ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div className="rounded-lg bg-white shadow">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="mb-4 text-lg font-medium leading-6 text-gray-900">Analytics Overview</h3>
            <AnalyticsCharts
              range={range}
              onRangeChange={setRange}
              data={summaryQuery.data}
              isLoading={summaryQuery.isLoading}
              isError={summaryQuery.isError}
            />
          </div>
        </div>

        <div className="rounded-lg bg-white shadow">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="mb-4 text-lg font-medium leading-6 text-gray-900">Recent Leads</h3>
            <LeadsTable />
          </div>
        </div>
      </div>
    </div>
  );
}
