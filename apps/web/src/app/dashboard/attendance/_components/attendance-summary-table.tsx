'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { formatDateTime, UZ_TASHKENT_DATE_TIME } from '@/lib/format';
import { formatSeconds, formatSecondsOrDash, getPresenceLabel } from './attendance-helpers';
import type { AttendancePageModel } from './use-attendance-page';

export function AttendanceSummaryTable({ vm }: { vm: AttendancePageModel }) {
  const { displayRows, presentCount, summariesQuery, totals } = vm;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
          <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Ishlangan vaqt</p>
          <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{formatSeconds(totals.workedSeconds)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
          <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Talab vaqt</p>
          <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{formatSeconds(totals.requiredSeconds)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
          <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Yetishmaydi</p>
          <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{formatSeconds(totals.missingSeconds)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700">
          <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Kelganlar soni</p>
          <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{presentCount}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700">
        <div className="max-h-[420px] overflow-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Sana</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Xodim</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Ishlangan</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Yetishmaydi</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Kechikish</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">IN</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">OUT</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Davomat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
              {displayRows.map((row: any) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{row.summaryDate}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{row.user?.name || row.user?.username || row.userId}</td>
                  <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-slate-100">{formatSecondsOrDash(row.workedSeconds)}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatSecondsOrDash(row.missingSeconds)}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{typeof row.lateMinutes === 'number' ? `${row.lateMinutes} daq` : '-'}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatDateTime(row.firstInAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-' })}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{formatDateTime(row.lastOutAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-' })}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{getPresenceLabel(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summariesQuery.isLoading ? (
          <LoadingBlock compact message="Yuklanmoqda..." />
        ) : summariesQuery.error ? (
          <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{summariesQuery.error.message}</p>
        ) : displayRows.length === 0 ? (
          <p className="px-3 py-3 text-sm text-gray-500 dark:text-slate-400">Bu filtr uchun davomat yo&apos;q.</p>
        ) : null}
      </div>
    </>
  );
}
