'use client';

import AnalyticsCharts from '@/components/dashboard/analytics-charts';

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          View detailed analytics and insights for your CRM data
        </p>
      </div>

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <AnalyticsCharts />
        </div>
      </div>
    </div>
  );
}
