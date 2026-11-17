'use client';

import { IconActivity, IconAlertTriangle, IconLinkOff } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDateTime, UZ_TASHKENT_DATE_TIME } from '@/lib/format';
import type { AttendancePageModel } from './use-attendance-page';

/** A compact list card for the page's right column. */
function ListCard({
  title,
  icon: CardIcon,
  iconClassName,
  count,
  countClassName,
  children,
}: {
  title: ReactNode;
  icon: Icon;
  iconClassName: string;
  count?: number;
  countClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className="panel flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${iconClassName}`}>
            <CardIcon className="h-4 w-4" stroke={1.8} />
          </span>
          <h3 className="section-title truncate">{title}</h3>
        </div>
        {count ? <span className={`badge tabular ${countClassName || 'badge-neutral'}`}>{count}</span> : null}
      </div>
      <div className="px-3 pb-3 pt-2">{children}</div>
    </section>
  );
}

/** Daily anomalies and unmatched Face ID events, as compact cards (managers and admins). */
export function AttendanceAnomalies({ vm }: { vm: AttendancePageModel }) {
  const { anomaliesQuery, canReadAnomalies, presenceByUserDate } = vm;
  const summaryAnomalies = anomaliesQuery.data?.summaryAnomalies || [];
  const unmatchedEvents = anomaliesQuery.data?.unmatchedEvents || [];

  if (!canReadAnomalies) return null;

  return (
    <>
      <ListCard
        title="Kunlik anomaliyalar"
        icon={IconAlertTriangle}
        iconClassName="bg-amber-50 text-amber-600"
        count={summaryAnomalies.length}
        countClassName="badge-amber"
      >
        <ul className="max-h-72 divide-y divide-gray-100 overflow-auto">
          {summaryAnomalies.map((row: any) => {
            const isPresent = presenceByUserDate.get(`${row.userId || ''}|${row.summaryDate || ''}`);
            return (
              <li key={row.id} className="space-y-1.5 px-2 py-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate font-medium text-gray-900">{row.user?.name || row.user?.username || row.userId}</p>
                  <p className="tabular flex-shrink-0 text-[13px] text-gray-500">{row.summaryDate}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="badge badge-amber tabular">anomaliya: {row.anomalyCount || 0}</span>
                  <span className={`badge ${isPresent ? 'badge-green' : 'badge-red'}`}>
                    {isPresent ? 'Kelgan (IN bor)' : "Kelmagan (IN yo'q)"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {anomaliesQuery.isLoading && <LoadingBlock compact message="Yuklanmoqda..." />}
        {!anomaliesQuery.isLoading && summaryAnomalies.length === 0 && (
          <EmptyState title="Anomaliya topilmadi." icon={IconAlertTriangle} className="py-6" />
        )}
      </ListCard>

      <ListCard
        title={<>Bog&apos;lanmagan eventlar</>}
        icon={IconLinkOff}
        iconClassName="bg-red-50 text-red-600"
        count={unmatchedEvents.length}
        countClassName="badge-red"
      >
        <ul className="max-h-80 divide-y divide-gray-100 overflow-auto">
          {unmatchedEvents.map((row: any) => (
            <li key={row.id} className="space-y-1 px-2 py-3 text-sm">
              <p className="font-medium text-gray-900">
                {(row.firstName || '')} {(row.lastName || '')} ({row.externalPhone || '-'})
              </p>
              <p className="tabular text-[13px] text-gray-500">
                {row.localDate} | {row.action} | {formatDateTime(row.eventAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-' })}
              </p>
              <p className="text-xs text-red-700">
                Sabab: {row.matchReason || 'unknown'} | Qadam: {row.matchStepTried || 'unknown'}
              </p>
              <p className="break-all rounded-[12px] bg-gray-50 px-2.5 py-1.5 font-mono text-[11px] text-gray-600">
                Raw user: ID={row.rawUser?.id ?? '-'}, name={(row.rawUser?.first_name || '')} {(row.rawUser?.last_name || '')}, phone={row.rawUser?.phone_number || '-'}
              </p>
            </li>
          ))}
        </ul>
        {anomaliesQuery.isLoading && <LoadingBlock compact message="Yuklanmoqda..." />}
        {!anomaliesQuery.isLoading && unmatchedEvents.length === 0 && (
          <EmptyState title="Bog'lanmagan event yo'q." icon={IconLinkOff} className="py-6" />
        )}
      </ListCard>
    </>
  );
}

/** The latest Face ID events, under the daily table. */
export function AttendanceRecentEvents({ vm }: { vm: AttendancePageModel }) {
  const { eventsQuery } = vm;
  const rows = eventsQuery.data?.rows || [];

  return (
    <section className="panel">
      <div className="panel-header pb-1">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600">
            <IconActivity className="h-4 w-4" stroke={1.8} />
          </span>
          <h3 className="section-title">Oxirgi eventlar</h3>
        </div>
      </div>
      <div className="p-2 sm:p-3">
        <div className="max-h-72 overflow-auto">
          <table className="data-table">
            <thead className="sticky top-0 z-[1] [&_th]:bg-white">
              <tr>
                <th className="text-left">Vaqt</th>
                <th className="text-left">Harakat</th>
                <th className="text-left">Xodim</th>
                <th className="text-left">Branch</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id}>
                  <td className="tabular whitespace-nowrap text-gray-600">{formatDateTime(row.eventAt, { ...UZ_TASHKENT_DATE_TIME, emptyText: '-' })}</td>
                  <td className="whitespace-nowrap">
                    <span className="badge badge-neutral">{row.action}</span>
                  </td>
                  <td className="whitespace-nowrap font-medium text-gray-900">{row.user?.name || `${row.firstName || ''} ${row.lastName || ''}`.trim() || '-'}</td>
                  <td className="whitespace-nowrap">{row.branchName || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {eventsQuery.isLoading ? (
          <LoadingBlock className="m-1" compact message="Yuklanmoqda..." />
        ) : eventsQuery.error ? (
          <p className="alert alert-error m-1">{eventsQuery.error.message}</p>
        ) : rows.length === 0 ? (
          <EmptyState title="Event topilmadi." icon={IconActivity} className="m-1" />
        ) : null}
      </div>
    </section>
  );
}
