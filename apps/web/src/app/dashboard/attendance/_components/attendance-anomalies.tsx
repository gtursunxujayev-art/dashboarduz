'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { formatDateTime, UZ_TASHKENT_DATE_TIME } from '@/lib/format';
import type { AttendancePageModel } from './use-attendance-page';

export function AttendanceAnomalies({ vm }: { vm: AttendancePageModel }) {
  const { anomaliesQuery, canReadAnomalies, eventsQuery, presenceByUserDate } = vm;

  return (
    <>
      {canReadAnomalies && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Kunlik anomaliyalar</h3>
            <div className="max-h-52 space-y-2 overflow-auto">
              {(anomaliesQuery.data?.summaryAnomalies || []).map((row: any) => (
                <div key={row.id} className="rounded-md border border-amber-300/40 bg-amber-50/40 px-3 py-2 text-sm dark:border-amber-800/50 dark:bg-amber-950/20">
                  <p className="font-medium text-gray-900 dark:text-slate-100">{row.user?.name || row.user?.username || row.userId}</p>
                  <p className="text-gray-700 dark:text-slate-300">
                    {row.summaryDate} | anomaliya: {row.anomalyCount || 0} |{' '}
                    {presenceByUserDate.get(`${row.userId || ''}|${row.summaryDate || ''}`) ? 'Kelgan (IN bor)' : "Kelmagan (IN yo'q)"}
                  </p>
                </div>
              ))}
              {anomaliesQuery.isLoading && <LoadingBlock compact message="Yuklanmoqda..." />}
              {!anomaliesQuery.isLoading && (anomaliesQuery.data?.summaryAnomalies || []).length === 0 && (
                <p className="text-sm text-gray-500 dark:text-slate-400">Anomaliya topilmadi.</p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Bog&apos;lanmagan eventlar</h3>
            <div className="max-h-52 space-y-2 overflow-auto">
              {(anomaliesQuery.data?.unmatchedEvents || []).map((row: any) => (
                <div key={row.id} className="rounded-md border border-red-300/40 bg-red-50/40 px-3 py-2 text-sm dark:border-red-800/50 dark:bg-red-950/20">
                  <p className="font-medium text-gray-900 dark:text-slate-100">
                    {(row.firstName || '')} {(row.lastName || '')} ({row.externalPhone || '-'})
                  </p>
                  <p className="text-gray-700 dark:text-slate-300">
                    {row.localDate} | {row.action} | {formatDateTime(row.eventAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-' })}
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-300">
                    Sabab: {row.matchReason || 'unknown'} | Qadam: {row.matchStepTried || 'unknown'}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-slate-300">
                    Raw user: ID={row.rawUser?.id ?? '-'}, name={(row.rawUser?.first_name || '')} {(row.rawUser?.last_name || '')}, phone={row.rawUser?.phone_number || '-'}
                  </p>
                </div>
              ))}
              {anomaliesQuery.isLoading && <LoadingBlock compact message="Yuklanmoqda..." />}
              {!anomaliesQuery.isLoading && (anomaliesQuery.data?.unmatchedEvents || []).length === 0 && (
                <p className="text-sm text-gray-500 dark:text-slate-400">Bog&apos;lanmagan event yo&apos;q.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Oxirgi eventlar</h3>
        <div className="max-h-56 overflow-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Vaqt</th>
                <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Harakat</th>
                <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Xodim</th>
                <th className="px-2 py-2 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Branch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
              {(eventsQuery.data?.rows || []).map((row: any) => (
                <tr key={row.id}>
                  <td className="px-2 py-2 text-xs text-gray-700 dark:text-slate-300">{formatDateTime(row.eventAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-' })}</td>
                  <td className="px-2 py-2 text-xs text-gray-700 dark:text-slate-300">{row.action}</td>
                  <td className="px-2 py-2 text-xs text-gray-700 dark:text-slate-300">{row.user?.name || `${row.firstName || ''} ${row.lastName || ''}`.trim() || '-'}</td>
                  <td className="px-2 py-2 text-xs text-gray-700 dark:text-slate-300">{row.branchName || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {eventsQuery.isLoading ? (
          <LoadingBlock className="mt-2" compact message="Yuklanmoqda..." />
        ) : eventsQuery.error ? (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{eventsQuery.error.message}</p>
        ) : (eventsQuery.data?.rows || []).length === 0 ? (
          <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">Event topilmadi.</p>
        ) : null}
      </div>
    </>
  );
}
