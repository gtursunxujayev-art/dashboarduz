'use client';

import { IconClockCheck, IconClockExclamation, IconClockHour4, IconUserCheck } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatDateTime, UZ_TASHKENT_DATE_TIME } from '@/lib/format';
import { formatSeconds, formatSecondsOrDash, getPresenceLabel, hasInPresence } from './attendance-helpers';
import type { AttendancePageModel } from './use-attendance-page';

/** Period totals as a stat row. */
export function AttendanceStats({ vm }: { vm: AttendancePageModel }) {
  const { presentCount, totals } = vm;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="Ishlangan vaqt" value={formatSeconds(totals.workedSeconds)} icon={IconClockCheck} tone="blue" />
      <StatTile label="Talab vaqt" value={formatSeconds(totals.requiredSeconds)} icon={IconClockHour4} tone="neutral" />
      <StatTile
        label="Yetishmaydi"
        value={formatSeconds(totals.missingSeconds)}
        icon={IconClockExclamation}
        tone={totals.missingSeconds > 0 ? 'amber' : 'green'}
      />
      <StatTile label="Kelganlar soni" value={presentCount} icon={IconUserCheck} tone="green" />
    </div>
  );
}

export function AttendanceSummaryTable({ vm }: { vm: AttendancePageModel }) {
  const { displayRows, summariesQuery } = vm;

  return (
    <section className="panel">
      <div className="panel-header pb-1">
        <div className="flex items-center gap-2">
          <h2 className="section-title">Kunlik davomat</h2>
          {displayRows.length > 0 && <span className="badge badge-neutral tabular">{displayRows.length}</span>}
        </div>
      </div>
      <div className="p-2 sm:p-3">
        <div className="max-h-[640px] overflow-auto">
          <table className="data-table">
            <thead className="sticky top-0 z-[1] [&_th]:bg-white">
              <tr>
                <th className="text-left">Sana</th>
                <th className="text-left">Xodim</th>
                <th className="text-right">Ishlangan</th>
                <th className="text-right">Yetishmaydi</th>
                <th className="text-right">Kechikish</th>
                <th className="text-left">IN</th>
                <th className="text-left">OUT</th>
                <th className="text-left">Davomat</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row: any) => {
                const employeeName = row.user?.name || row.user?.username || row.userId;
                const isLate = typeof row.lateMinutes === 'number' && row.lateMinutes > 0;
                return (
                  <tr key={row.id}>
                    <td className="tabular whitespace-nowrap text-gray-600">{row.summaryDate}</td>
                    <td className="whitespace-nowrap">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar name={String(employeeName || '?')} size="sm" />
                        <span className="font-medium text-gray-900">{employeeName}</span>
                      </div>
                    </td>
                    <td className="tabular whitespace-nowrap text-right font-medium text-gray-900">{formatSecondsOrDash(row.workedSeconds)}</td>
                    <td className="tabular whitespace-nowrap text-right">{formatSecondsOrDash(row.missingSeconds)}</td>
                    <td className="tabular whitespace-nowrap text-right">
                      <span className={isLate ? 'font-medium text-amber-700' : ''}>
                        {typeof row.lateMinutes === 'number' ? `${row.lateMinutes} daq` : '-'}
                      </span>
                    </td>
                    <td className="tabular whitespace-nowrap text-gray-600">{formatDateTime(row.firstInAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-' })}</td>
                    <td className="tabular whitespace-nowrap text-gray-600">{formatDateTime(row.lastOutAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-' })}</td>
                    <td className="whitespace-nowrap">
                      <span className={`badge ${hasInPresence(row) ? 'badge-green' : 'badge-red'}`}>{getPresenceLabel(row)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {summariesQuery.isLoading ? (
          <LoadingBlock compact message="Yuklanmoqda..." className="m-1" />
        ) : summariesQuery.error ? (
          <p className="alert alert-error m-1">{summariesQuery.error.message}</p>
        ) : displayRows.length === 0 ? (
          <EmptyState title="Bu filtr uchun davomat yo'q." icon={IconUserCheck} className="m-1" />
        ) : null}
      </div>
    </section>
  );
}
