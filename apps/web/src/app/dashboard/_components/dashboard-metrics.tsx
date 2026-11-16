'use client';

import DashboardMetricCards from '@/components/dashboard/dashboard-metric-cards';
import DashboardSellerTable from '@/components/dashboard/dashboard-seller-table';
import DashboardIncomeOverview from '@/components/dashboard/income-overview';
import DashboardLeadOverview from '@/components/dashboard/lead-overview';
import LoadingBlock from '@/components/dashboard/loading-block';
import DashboardSelectedCourses from '@/components/dashboard/selected-courses';
import { formatDurationLongWords, formatSom } from '@/lib/format';
import { getPeriodFollowUpLabel, renderMetricValue } from './dashboard-helpers';
import type { DashboardPageModel } from './use-dashboard-page';

export function DashboardMetrics({ vm }: { vm: DashboardPageModel }) {
  const { financeSummaryQuery, incomeByCourse, isFinanceOnly, isTashkiliyOnly, range, salarySection, sellerPerformance, setSummaryRefreshKey, summaryQuery, visibleDashboardCards } = vm;

  return (
    <>
      {isFinanceOnly ? (
        <div className="space-y-6">
          {financeSummaryQuery.error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {financeSummaryQuery.error.message || 'Moliya paneli ma\'lumotlarini yuklashda xatolik.'}
            </div>
          )}

          <DashboardMetricCards cards={visibleDashboardCards} columns={5} />

          {salarySection}

          <div className="rounded-lg bg-white shadow">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="mb-4 text-lg font-medium leading-6 text-gray-900">Kurslar bo'yicha tushum</h3>
              {financeSummaryQuery.isLoading ? (
                <LoadingBlock message="Yuklanmoqda..." />
              ) : incomeByCourse.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kurs</th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Sotuvlar</th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {incomeByCourse.map((row: any) => (
                        <tr key={row.courseName}>
                          <td className="px-3 py-2 text-sm text-gray-900">{row.courseName}</td>
                          <td className="px-3 py-2 text-sm text-gray-700">{row.count}</td>
                          <td className="px-3 py-2 text-sm text-gray-700">{formatSom(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-600">Tanlangan davr uchun tushum ma'lumoti topilmadi.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-6">
            <DashboardIncomeOverview />
            <DashboardLeadOverview />
            <DashboardSelectedCourses />
          </div>

          {salarySection}

          <DashboardSellerTable
            isLoading={summaryQuery.isLoading}
            sellerPerformance={sellerPerformance}
            isTashkiliyOnly={isTashkiliyOnly}
            range={range}
            formatAmount={formatSom}
            formatDuration={formatDurationLongWords}
            renderMetricValue={renderMetricValue}
            getPeriodFollowUpLabel={getPeriodFollowUpLabel}
            crmSourceStatus={summaryQuery.data?.sourceStatus?.activity}
            unmappedSellerNames={summaryQuery.data?.unmappedSellerNames ?? []}
            onRetry={() => setSummaryRefreshKey((value) => value + 1)}
            isRetrying={summaryQuery.isFetching}
          />
        </>
      )}
    </>
  );
}
