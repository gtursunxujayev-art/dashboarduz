'use client';

import type { ReactNode } from 'react';
import { IconCalendar, IconCash, IconMinus, IconRepeat, IconShoppingCart, IconTrendingDown, IconTrendingUp, IconUserExclamation } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { formatSom } from '@/lib/format';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompactAmount, getTrendMeta } from './finance-helpers';

const CHART_TICK = { fontSize: 11, fill: 'rgb(var(--gray-500))' };
const CHART_TOOLTIP_STYLE = { borderRadius: 10, border: '1px solid rgb(var(--gray-200))', background: 'rgb(var(--surface))', fontSize: 12 };

function HeroFigure({ label, value, icon: FigureIcon }: { label: string; value: ReactNode; icon: Icon }) {
  return (
    <div className="min-w-0 px-0 sm:px-5 sm:first:pl-0">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-white/55">
        <FigureIcon className="h-3.5 w-3.5 flex-shrink-0" stroke={1.8} />
        <span className="truncate">{label}</span>
      </p>
      <p className="tabular mt-2 text-2xl font-semibold leading-none tracking-tight text-white">{value}</p>
    </div>
  );
}

/** The dark ink band at the top of the finance page: the period's income and its three counts. */
export function FinanceHero({
  totalIncomeAmount,
  newSalesCount,
  repaymentCount,
  debtorsCount,
  dateFrom,
  dateTo,
}: {
  totalIncomeAmount?: number | null;
  newSalesCount?: number | null;
  repaymentCount?: number | null;
  debtorsCount?: number | null;
  dateFrom: string;
  dateTo: string;
}) {
  return (
    <section className="relative isolate flex min-h-[236px] flex-col justify-between gap-8 overflow-hidden rounded-[20px] bg-slate-950 p-6 text-white shadow-lg ring-1 ring-inset ring-white/10 sm:p-8">
      <div
        aria-hidden="true"
        className="absolute -right-24 -top-32 -z-10 h-80 w-80 rounded-full bg-blue-600/30 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-40 left-1/3 -z-10 h-72 w-72 rounded-full bg-blue-400/10 blur-3xl"
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-white/70">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white">
              <IconCash className="h-4 w-4" stroke={1.8} />
            </span>
            Jami tushum
          </p>
          <p className="tabular mt-4 break-words text-4xl font-semibold leading-none tracking-[-0.02em] sm:text-5xl">
            {formatSom(totalIncomeAmount)}
          </p>
        </div>
        <span className="tabular inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80 ring-1 ring-inset ring-white/10">
          <IconCalendar className="h-3.5 w-3.5" stroke={1.8} />
          {dateFrom} - {dateTo}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-5 border-t border-white/10 pt-5 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-white/10">
        <HeroFigure label="Yangi sotuvlar" value={newSalesCount ?? 0} icon={IconShoppingCart} />
        <HeroFigure label="Qayta to'lovlar" value={repaymentCount ?? 0} icon={IconRepeat} />
        <HeroFigure label="Qarzdorlar" value={debtorsCount ?? 0} icon={IconUserExclamation} />
      </div>
    </section>
  );
}

type ComparisonData = {
  direction?: string;
  currentValue?: number | null;
  previousValue?: number | null;
  diffAmount?: number | null;
  diffPercent?: number | null;
} | null | undefined;

const TREND_BAR: Record<string, string> = {
  up: 'bg-emerald-500',
  down: 'bg-red-500',
};

/** One period comparison: the difference large, the two compared values underneath. */
export function ComparisonCard({ title, data }: { title: string; data: ComparisonData }) {
  const trend = getTrendMeta(data?.direction);
  const TrendIcon = data?.direction === 'up' ? IconTrendingUp : data?.direction === 'down' ? IconTrendingDown : IconMinus;

  return (
    <div className="panel relative flex flex-col overflow-hidden p-5">
      <span aria-hidden="true" className={`absolute inset-y-5 left-0 w-[3px] rounded-r-full ${TREND_BAR[data?.direction || ''] || 'bg-gray-300'}`} />
      <div className="flex items-start justify-between gap-3">
        <p className="caption leading-snug">{title}</p>
        <span className={`badge flex-shrink-0 ${trend.badgeClass}`}>
          <TrendIcon className="h-3.5 w-3.5" stroke={2} />
          {trend.label}
        </span>
      </div>
      <p className="tabular mt-4 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-gray-900">
        {trend.sign}{formatSom(data?.diffAmount)}{' '}
        <span className="text-sm font-medium text-gray-500">({trend.sign}{Number(data?.diffPercent || 0).toFixed(2)}%)</span>
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="panel-inset px-3 py-2.5">
          <p className="text-xs text-gray-500">Joriy:</p>
          <p className="tabular mt-0.5 truncate text-sm font-semibold text-gray-900">{formatSom(data?.currentValue)}</p>
        </div>
        <div className="panel-inset px-3 py-2.5">
          <p className="text-xs text-gray-500">Taqqoslash:</p>
          <p className="tabular mt-0.5 truncate text-sm font-semibold text-gray-900">{formatSom(data?.previousValue)}</p>
        </div>
      </div>
    </div>
  );
}

type ForecastBlock = {
  projectedTotal?: number | null;
  currentToDate?: number | null;
  remainingAmount?: number | null;
} | null | undefined;

/** Month-end or year-end forecast: projected total, the two parts and the actual vs forecast line chart. */
export function ForecastPanel({
  title,
  description,
  block,
  currentLabel,
  data,
  labelFormatter,
}: {
  title: string;
  description: ReactNode;
  block: ForecastBlock;
  currentLabel: string;
  data: any[];
  labelFormatter?: (label: any) => string;
}) {
  return (
    <div className="panel flex flex-col">
      <div className="panel-header items-start">
        <div className="min-w-0">
          <h2 className="section-title">{title}</h2>
          <p className="mt-0.5 text-sm text-gray-500">{description}</p>
        </div>
      </div>
      <div className="panel-body flex flex-1 flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-[16px] bg-blue-50 px-4 py-3">
            <p className="caption text-blue-700">Prognoz</p>
            <p className="tabular mt-1 truncate text-lg font-semibold text-blue-900">{formatSom(block?.projectedTotal)}</p>
          </div>
          <div className="panel-inset px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="h-2 w-2 rounded-full bg-[#3964f3]" aria-hidden="true" />
              {currentLabel}
            </p>
            <p className="tabular mt-1 truncate text-sm font-semibold text-gray-900">{formatSom(block?.currentToDate)}</p>
          </div>
          <div className="panel-inset px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
              Qolgan potensial
            </p>
            <p className="tabular mt-1 truncate text-sm font-semibold text-gray-900">{formatSom(block?.remainingAmount)}</p>
          </div>
        </div>

        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--gray-200))" vertical={false} />
              <XAxis dataKey="label" tick={CHART_TICK} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(value) => formatCompactAmount(value)} tick={CHART_TICK} axisLine={false} tickLine={false} width={64} />
              <Tooltip
                formatter={(value: any, name: string) => [formatSom(Number(value || 0)), name === 'actual' ? 'Amaldagi' : 'Prognoz']}
                labelFormatter={labelFormatter}
                contentStyle={CHART_TOOLTIP_STYLE}
              />
              <Line type="monotone" dataKey="actual" name="actual" stroke="#3964f3" strokeWidth={2.5} dot={false} connectNulls={false} />
              <Line type="monotone" dataKey="forecast" name="forecast" stroke="#F59E0B" strokeWidth={2} dot={false} strokeDasharray="6 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
