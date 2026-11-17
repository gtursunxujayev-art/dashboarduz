'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { IconArrowDownRight, IconArrowUpRight } from '@tabler/icons-react';
import type { ReportRangePreset as DashboardRange } from '@dashboarduz/shared';
import LoadingBlock from '@/components/dashboard/loading-block';
import { trpc } from '@/lib/trpc';
import { formatSom } from '@/lib/format';

const TITLES: Record<DashboardRange, string> = {
  today: 'Bugungi tushum dinamikasi',
  week: 'Haftalik tushum dinamikasi',
  month: 'Oylik tushum dinamikasi',
  custom: 'Tanlangan davr dinamikasi',
};

const COMPARISON: Record<DashboardRange, string> = {
  today: 'kechagiga nisbatan',
  week: "o'tgan haftaga nisbatan",
  month: "o'tgan oyga nisbatan",
  custom: 'oldingi davrga nisbatan',
};

function formatAxisAmount(value: number) {
  if (value >= 1_000_000_000) return `${Number((value / 1_000_000_000).toFixed(1))} mlrd`;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))} mln`;
  if (value >= 1_000) return `${Math.round(value / 1_000)} ming`;
  return String(value);
}

function ChangeBadge({ changePercent, range }: { changePercent: number | null; range: DashboardRange }) {
  if (changePercent === null) {
    return <p className="text-[13px] text-gray-500">Taqqoslash uchun oldingi davr ma&apos;lumoti yo&apos;q</p>;
  }
  const growing = changePercent >= 0;
  const Arrow = growing ? IconArrowUpRight : IconArrowDownRight;
  return (
    <p className="flex items-center justify-end gap-1 text-[13px]">
      <span className={`tabular inline-flex items-center gap-0.5 font-semibold ${growing ? 'text-emerald-600' : 'text-red-600'}`}>
        <Arrow className="h-4 w-4" stroke={2} />
        {growing ? '+' : ''}
        {changePercent.toLocaleString('ru-RU')}%
      </span>
      <span className="text-gray-500">{COMPARISON[range]}</span>
    </p>
  );
}

type Props = {
  range: DashboardRange;
  dateFrom?: string;
  dateTo?: string;
};

export default function DashboardIncomeDynamics({ range, dateFrom, dateTo }: Props) {
  const query = trpc.dashboard.incomeDynamics.useQuery(
    { range, dateFrom: range === 'custom' ? dateFrom : undefined, dateTo: range === 'custom' ? dateTo : undefined },
    { keepPreviousData: true, staleTime: 60_000, refetchOnWindowFocus: false },
  );
  const data = query.data;
  const buckets = data?.buckets ?? [];
  const hasIncome = buckets.some((bucket) => bucket.amount > 0);

  return (
    <section className="panel flex min-h-[340px] flex-col p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h2 className="section-title">{TITLES[range]}</h2>
        {data ? (
          <div className="text-right">
            <p className="tabular text-xl font-semibold leading-tight tracking-tight text-gray-900">{formatSom(data.total)}</p>
            <ChangeBadge changePercent={data.changePercent} range={range} />
          </div>
        ) : null}
      </div>

      {query.isLoading ? (
        <LoadingBlock message="Yuklanmoqda..." className="mt-5 flex-1" />
      ) : query.error ? (
        <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Tushum dinamikasini yuklab bo&apos;lmadi.
        </div>
      ) : !hasIncome ? (
        <div className="mt-5 flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
          Tanlangan davrda tushum yozuvi yo&apos;q.
        </div>
      ) : (
        <div className={`mt-4 h-[248px] flex-1 transition-opacity ${query.isFetching ? 'opacity-60' : ''}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="income-dynamics-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3964f3" stopOpacity={0.32} />
                  <stop offset="100%" stopColor="#3964f3" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 4" />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12 }}
                interval="preserveStartEnd"
                minTickGap={24}
                tickMargin={10}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12 }}
                width={60}
                tickFormatter={(value: number) => formatAxisAmount(value)}
              />
              <Tooltip
                cursor={{ stroke: '#3964f3', strokeOpacity: 0.35, strokeWidth: 1 }}
                formatter={(value: number) => [formatSom(Number(value || 0)), 'Tushum']}
              />
              <Area
                type="monotone"
                dataKey="amount"
                stroke="#3964f3"
                strokeWidth={2}
                fill="url(#income-dynamics-fill)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: '#3964f3', fill: 'rgb(var(--surface))' }}
                animationDuration={700}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
