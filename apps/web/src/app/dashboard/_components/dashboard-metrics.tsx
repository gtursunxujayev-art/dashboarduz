'use client';

import DashboardMetricCards from '@/components/dashboard/dashboard-metric-cards';
import DashboardSellerTable from '@/components/dashboard/dashboard-seller-table';
import DashboardIncomeOverview from '@/components/dashboard/income-overview';
import DashboardLeadOverview from '@/components/dashboard/lead-overview';
import LoadingBlock from '@/components/dashboard/loading-block';
import DashboardSelectedCourses from '@/components/dashboard/selected-courses';
import DashboardTopSellers from '@/components/dashboard/top-sellers';
import DashboardIncomeDynamics from '@/components/dashboard/income-dynamics-chart';
import DashboardFunnelOverview from '@/components/dashboard/funnel-overview';
import { formatDurationLongWords, formatSom } from '@/lib/format';
import { getPeriodFollowUpLabel, renderMetricValue } from './dashboard-helpers';
import type { DashboardPageModel } from './use-dashboard-page';

export function DashboardMetrics({ vm }: { vm: DashboardPageModel }) {
  const { dateFrom, dateTo, financeSummaryQuery, incomeByCourse, isAgentOnly, isFinanceOnly, isTashkiliyOnly, range, salarySection, sellerPerformance, setSummaryRefreshKey, summaryQuery, visibleDashboardCards } = vm;
  // Same audience as the Voronka page in the sidebar: everyone except agent-only and Tashkiliy-only users.
  const showFunnel = !isAgentOnly && !isTashkiliyOnly;

  return (
    <>
      {isFinanceOnly ? (
        <div className="space-y-6">
          {financeSummaryQuery.error && (
            <div className="alert alert-error">
              {financeSummaryQuery.error.message || 'Moliya paneli ma\'lumotlarini yuklashda xatolik.'}
            </div>
          )}

          <DashboardMetricCards cards={visibleDashboardCards} columns={5} />

          <DashboardFunnelOverview range={range} dateFrom={dateFrom} dateTo={dateTo} />

          {salarySection}

          <div className="panel">
            <div className="p-5 sm:p-6">
              <h3 className="section-title mb-4">Kurslar bo'yicha tushum</h3>
              {financeSummaryQuery.isLoading ? (
                <LoadingBlock message="Yuklanmoqda..." />
              ) : incomeByCourse.length ? (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="text-left">Kurs</th>
                        <th className="text-left">Sotuvlar</th>
                        <th className="text-left">Tushum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incomeByCourse.map((row: any) => (
                        <tr key={row.courseName}>
                          <td className="text-gray-900">{row.courseName}</td>
                          <td>{row.count}</td>
                          <td>{formatSom(row.amount)}</td>
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
          <div className="space-y-4">
            <DashboardIncomeOverview />
            <div className={isTashkiliyOnly ? '' : 'grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]'}>
              <DashboardIncomeDynamics range={range} dateFrom={dateFrom} dateTo={dateTo} />
              {!isTashkiliyOnly && (
                <DashboardTopSellers sellers={sellerPerformance} isLoading={summaryQuery.isLoading} />
              )}
            </div>
            {showFunnel ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <DashboardLeadOverview />
                <DashboardFunnelOverview range={range} dateFrom={dateFrom} dateTo={dateTo} />
              </div>
            ) : (
              <DashboardLeadOverview />
            )}
          </div>

          <DashboardSelectedCourses />

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
