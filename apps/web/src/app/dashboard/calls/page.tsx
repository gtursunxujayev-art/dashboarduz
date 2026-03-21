'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type CallsRange = 'today' | 'week' | 'month' | 'custom';
const RANGE_OPTIONS: CallsRange[] = ['today', 'week', 'month', 'custom'];

function formatDuration(totalSeconds?: number | null): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${hours} soat ${minutes} daq ${seconds} son`;
}

function formatDecimal(value?: number | null): string {
  const safeValue = Number(value || 0);
  return safeValue.toFixed(1);
}

function getTashkentToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function getRangeLabel(range: CallsRange): string {
  if (range === 'week') return 'Bu hafta';
  if (range === 'month') return 'Bu oy';
  if (range === 'custom') return 'Ixtiyoriy sana';
  return 'Bugun';
}

export default function CallsPage() {
  const { user } = useAuth();
  const [range, setRange] = useState<CallsRange>('today');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());

  const isAgentOnly = Boolean(
    user?.roles?.includes('Agent')
    && !user?.roles?.includes('Admin')
    && !user?.roles?.includes('Manager')
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
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Qo&apos;ng&apos;iroqlar tahlili</h1>
        <p className="mt-1 text-sm text-gray-500">
          Agentlar kesimida qo&apos;ng&apos;iroqlar statistikasi va bugungi natijalar
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <div className="inline-flex min-w-max rounded-md shadow-sm">
              {RANGE_OPTIONS.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  className={`border border-gray-300 px-4 py-2 text-sm font-medium ${
                    range === option ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  } ${index === 0 ? 'rounded-l-md' : ''} ${
                    index === RANGE_OPTIONS.length - 1 ? 'rounded-r-md' : ''
                  } ${index !== 0 ? 'border-l-0' : ''}`}
                >
                  {getRangeLabel(option)}
                </button>
              ))}
            </div>
          </div>

          {range === 'custom' && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
        </div>
      </div>

      {callsQuery.data?.agentInsight?.message && (
        <div className={`rounded-lg border px-4 py-3 text-sm font-medium ${
          callsQuery.data.agentInsight.aboveAverage
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}>
          {callsQuery.data.agentInsight.message}
        </div>
      )}

      <div className="bg-white shadow rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          {callsQuery.data && (
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-gray-500">Agentlar</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">{callsQuery.data.totals?.totalAgents || 0}</p>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-gray-500">Jami qo&apos;ng&apos;iroqlar</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">{totals.totalCalls}</p>
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-gray-500">Umumiy suhbat vaqti</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">{formatDuration(totals.totalDurationSeconds)}</p>
              </div>
            </div>
          )}

          {callsQuery.isLoading ? (
            <p className="text-sm text-gray-600">Qo&apos;ng&apos;iroqlar statistikasi yuklanmoqda...</p>
          ) : callsQuery.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {callsQuery.error.message || 'Statistikani yuklashda xatolik yuz berdi.'}
            </p>
          ) : rows.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">#</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Xodim</th>
                    {!isAgentOnly && (
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Ichki raqam</th>
                    )}
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Barcha qo&apos;ng&apos;iroqlar</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Kuniga o&apos;rtacha qo&apos;ng&apos;iroqlar</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Bugungi qo&apos;ng&apos;iroqlar</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Kiruvchi</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Chiquvchi</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">Qo&apos;ng&apos;iroqlar umumiy vaqti</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {rows.map((row: any) => (
                    <tr key={row.userId}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.rank}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{row.agentName}</td>
                      {!isAgentOnly && (
                        <td className="px-4 py-3 text-sm text-gray-700">{row.extension || '-'}</td>
                      )}
                      <td className="px-4 py-3 text-sm text-gray-700">{row.totalCalls}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatDecimal(row.averageDailyCalls)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{row.callsToday}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{row.incomingCalls}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{row.outgoingCalls}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{formatDuration(row.totalDurationSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-600">
              Hozircha statistikada ko&apos;rsatish uchun qo&apos;ng&apos;iroqlar yo&apos;q.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
