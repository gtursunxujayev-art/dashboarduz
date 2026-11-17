'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { IconCalendar, IconClock, IconPhone, IconPhoneOff, IconTrendingDown, IconTrendingUp, IconUsers } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { FilterPill, pillControlClass } from '@/components/dashboard/filter-pill';
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

/** A small leaderboard bar with no track: only the measured part is drawn. */
function InlineBar({ value, max, className }: { value: number; max: number; className: string }) {
  const width = max > 0 && value > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="ml-auto mt-1.5 h-1 w-24" aria-hidden="true">
      <div className={`h-full origin-left animate-grow-x rounded-full ${className}`} style={{ width: `${width}%` }} />
    </div>
  );
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

  const maxCalls = useMemo(() => Math.max(0, ...rows.map((row) => Number(row.totalCalls || 0))), [rows]);
  const maxDuration = useMemo(() => Math.max(0, ...rows.map((row) => Number(row.totalDurationSeconds || 0))), [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Qo&apos;ng&apos;iroqlar tahlili</>}
        description={<>Agentlar kesimida qo&apos;ng&apos;iroqlar statistikasi va bugungi natijalar</>}
      >
        <div className="flex flex-wrap items-center gap-2">
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
            <div className="flex flex-wrap items-center gap-2">
              <FilterPill icon={IconCalendar}>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className={`${pillControlClass} w-[9.5rem] flex-none`}
                />
              </FilterPill>
              <FilterPill icon={IconCalendar}>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className={`${pillControlClass} w-[9.5rem] flex-none`}
                />
              </FilterPill>
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="relative isolate flex min-h-[148px] flex-col justify-between gap-6 overflow-hidden rounded-[20px] bg-slate-950 p-6 text-white shadow-lg ring-1 ring-inset ring-white/10 md:col-span-2 xl:col-span-1">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400">Jami qo&apos;ng&apos;iroqlar</p>
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-blue-300">
                <IconPhone className="h-[18px] w-[18px]" stroke={1.6} aria-hidden="true" />
              </span>
            </div>
            <p className="tabular text-[40px] font-semibold leading-none tracking-[-0.02em]">{totals.totalCalls}</p>
          </div>
          <StatTile label="Agentlar" value={callsQuery.data.totals?.totalAgents || 0} icon={IconUsers} />
          <StatTile label="Umumiy suhbat vaqti" value={formatDurationShortWords(totals.totalDurationSeconds)} icon={IconClock} tone="blue" />
        </div>
      )}

      <section className="panel">
        {rows.length > 0 && !callsQuery.isLoading && !callsQuery.error && (
          <div className="panel-header pb-1">
            <div className="flex items-center gap-2">
              <h2 className="section-title">Agentlar</h2>
              <span className="badge badge-neutral tabular">{rows.length}</span>
            </div>
          </div>
        )}
        <div className="p-2 sm:p-3">
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
                  {rows.map((row: any) => {
                    const rank = Number(row.rank);
                    const podium = rank >= 1 && rank <= 3;
                    return (
                      <tr key={row.userId}>
                        <td>
                          <span
                            className={`tabular flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                              podium ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {row.rank}
                          </span>
                        </td>
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
                        <td className="text-right">
                          <span className="tabular font-semibold text-gray-900">{row.totalCalls}</span>
                          <InlineBar value={Number(row.totalCalls || 0)} max={maxCalls} className="bg-blue-600" />
                        </td>
                        <td className="tabular text-right">{formatDecimal(row.averageDailyCalls)}</td>
                        <td className="tabular text-right">{row.callsToday}</td>
                        <td className="tabular text-right">{row.incomingCalls}</td>
                        <td className="tabular text-right">{row.outgoingCalls}</td>
                        <td className="whitespace-nowrap text-right">
                          <span className="tabular">{formatDurationShortWords(row.totalDurationSeconds)}</span>
                          <InlineBar value={Number(row.totalDurationSeconds || 0)} max={maxDuration} className="bg-gray-300" />
                        </td>
                      </tr>
                    );
                  })}
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
      </section>
    </div>
  );
}
