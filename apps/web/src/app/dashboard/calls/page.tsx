'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { IconClock, IconPhone, IconPhoneOff, IconTrendingDown, IconTrendingUp, IconUsers } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useAuth } from '@/contexts/auth-context';
import { getRangeLabel, getTashkentToday } from '@/lib/date-range';
import { formatDurationShortWords } from '@/lib/format';
import { type ReportRangePreset as CallsRange } from '@dashboarduz/shared';

const RANGE_OPTIONS: CallsRange[] = ['today', 'week', 'month', 'custom'];
const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);

function formatDecimal(value?: number | null): string {
  const safeValue = Number(value || 0);
  return safeValue.toFixed(1);
}

export default function CallsPage() {
  const { user } = useAuth();
  const [range, setRange] = useState<CallsRange>('today');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());

  const isAgentOnly = Boolean(
    user?.roles?.some((role) => AGENT_ROLES.has(role))
    && !user?.roles?.includes('Admin')
    && !user?.roles?.includes('Manager')
    && !user?.roles?.includes('TeamLeader')
    && !user?.roles?.includes('Finance'),
  );

  const callsQuery = trpc.calls.analytics.useQuery({
    range,
    dateFrom: range === 'custom' ? dateFrom : undefined,
    dateTo: range === 'custom' ? dateTo : undefined,
  }, {
    refetchInterval: 60_000,
    keepPreviousData: true,
  });

  const rows = useMemo(() => callsQuery.data?.rows ?? [], [callsQuery.data]);
  const totals = useMemo(() => ({
    totalCalls: rows.reduce((sum: number, row: any) => sum + Number(row.totalCalls || 0), 0),
    totalDurationSeconds: rows.reduce((sum: number, row: any) => sum + Number(row.totalDurationSeconds || 0), 0),
  }), [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Qo&apos;ng&apos;iroqlar tahlili</>}
        description={<>Agentlar kesimida qo&apos;ng&apos;iroqlar statistikasi va bugungi natijalar</>}
      >
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
          <div className="max-w-full overflow-x-auto">
            <div className="segmented">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  aria-pressed={range === option}
                  className={`segmented-item ${range === option ? 'segmented-item-active' : ''}`}
                >
                  {getRangeLabel(option, 'long')}
                </button>
              ))}
            </div>
          </div>

          {range === 'custom' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:items-center">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="field md:w-44"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="field md:w-44"
              />
            </div>
          )}
        </div>
      </PageHeader>

      {callsQuery.data?.agentInsight?.message && (
        <div className={`alert flex items-start gap-3 font-medium ${
          callsQuery.data.agentInsight.aboveAverage ? 'alert-success' : 'alert-warning'
        }`}>
          {callsQuery.data.agentInsight.aboveAverage
            ? <IconTrendingUp className="mt-0.5 h-4 w-4 flex-shrink-0" stroke={1.8} aria-hidden="true" />
            : <IconTrendingDown className="mt-0.5 h-4 w-4 flex-shrink-0" stroke={1.8} aria-hidden="true" />}
          <span>{callsQuery.data.agentInsight.message}</span>
        </div>
      )}

      {callsQuery.data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="Agentlar" value={callsQuery.data.totals?.totalAgents || 0} icon={IconUsers} />
          <StatTile label={<>Jami qo&apos;ng&apos;iroqlar</>} value={totals.totalCalls} icon={IconPhone} tone="blue" />
          <StatTile label="Umumiy suhbat vaqti" value={formatDurationShortWords(totals.totalDurationSeconds)} icon={IconClock} />
        </div>
      )}

      <div className="panel p-2 sm:p-3">
        {callsQuery.isLoading ? (
          <LoadingBlock message="Qo'ng'iroqlar statistikasi yuklanmoqda..." />
        ) : callsQuery.error ? (
          <p className="alert alert-error">
            {callsQuery.error.message || 'Statistikani yuklashda xatolik yuz berdi.'}
          </p>
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-12 text-left">#</th>
                  <th className="text-left">Xodim</th>
                  {!isAgentOnly && (
                    <th className="text-left">Ichki raqam</th>
                  )}
                  <th className="text-right">Barcha qo&apos;ng&apos;iroqlar</th>
                  <th className="text-right">Kuniga o&apos;rtacha qo&apos;ng&apos;iroqlar</th>
                  <th className="text-right">Bugungi qo&apos;ng&apos;iroqlar</th>
                  <th className="text-right">Kiruvchi</th>
                  <th className="text-right">Chiquvchi</th>
                  <th className="text-right">Qo&apos;ng&apos;iroqlar umumiy vaqti</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any) => (
                  <tr key={row.userId}>
                    <td className="tabular font-medium text-gray-500">{row.rank}</td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <UserAvatar name={String(row.agentName || '?')} size="sm" />
                        <span className="whitespace-nowrap font-medium text-gray-900">{row.agentName}</span>
                      </div>
                    </td>
                    {!isAgentOnly && (
                      <td>
                        {row.extension ? <span className="badge badge-neutral tabular">{row.extension}</span> : '-'}
                      </td>
                    )}
                    <td className="tabular text-right font-medium text-gray-900">{row.totalCalls}</td>
                    <td className="tabular text-right">{formatDecimal(row.averageDailyCalls)}</td>
                    <td className="tabular text-right">{row.callsToday}</td>
                    <td className="tabular text-right">{row.incomingCalls}</td>
                    <td className="tabular text-right">{row.outgoingCalls}</td>
                    <td className="tabular whitespace-nowrap text-right">{formatDurationShortWords(row.totalDurationSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={IconPhoneOff}
            title={<>Hozircha statistikada ko&apos;rsatish uchun qo&apos;ng&apos;iroqlar yo&apos;q.</>}
          />
        )}
      </div>
    </div>
  );
}
