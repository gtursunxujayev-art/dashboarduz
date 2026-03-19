'use client';

import { trpc } from '@/lib/trpc';
import { useMemo, useState } from 'react';

type SellerRange = 'today' | 'week' | 'month' | 'custom';

function getTodayTashkent(): string {
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

function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '-';
  }
  return `${Math.round(value).toLocaleString('ru-RU')} UZS`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '-';
  }
  return `${value.toFixed(1)}%`;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) {
    return '00:00:00';
  }
  const safe = Math.floor(seconds);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function MetricBox({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/70 p-4">
      <p className="text-sm text-slate-300">{title}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </div>
  );
}

export default function SellerDetailsPage({ params }: { params: { id: string } }) {
  const [range, setRange] = useState<SellerRange>('today');
  const [dateFrom, setDateFrom] = useState(getTodayTashkent());
  const [dateTo, setDateTo] = useState(getTodayTashkent());

  const queryInput = useMemo(() => {
    if (range === 'custom') {
      return {
        id: params.id,
        range,
        dateFrom,
        dateTo,
      };
    }
    return {
      id: params.id,
      range,
    };
  }, [params.id, range, dateFrom, dateTo]);

  const sellerQuery = trpc.sellers.getById.useQuery(queryInput as any, {
    keepPreviousData: true,
  });

  if (sellerQuery.isLoading) {
    return <p className="text-sm text-gray-600">Sotuvchi ma'lumotlari yuklanmoqda...</p>;
  }

  if (!sellerQuery.data) {
    return <p className="text-sm text-red-700">Sotuvchi topilmadi.</p>;
  }

  const data = sellerQuery.data;
  const seller = data.seller;
  const metrics = data.metrics;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { key: 'today', label: 'Bugun' },
            { key: 'week', label: 'Hafta' },
            { key: 'month', label: 'Oy' },
            { key: 'custom', label: 'Maxsus' },
          ].map((option) => (
            <button
              key={option.key}
              onClick={() => setRange(option.key as SellerRange)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                range === option.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {option.label}
            </button>
          ))}

          {range === 'custom' && (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              />
            </div>
          )}
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {seller.name || seller.email || seller.phone || 'Sotuvchi'}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Sotuvchi ko'rsatkichlari (Batafsil)</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricBox title="Tushum" value={formatAmount(metrics.incomeAmount)} />
        <MetricBox title="Faol lidlar" value={metrics.activeLeads ?? 0} />
        <MetricBox title="Yangi lidlar" value={metrics.newLeads ?? 0} />
        <MetricBox title="Sotuvlar" value={metrics.salesCount ?? 0} />
        <MetricBox title="Sifatli lidlar" value={metrics.qualifiedLeads ?? 0} />
        <MetricBox title="Sifatsiz lidlar" value={metrics.unqualifiedLeads ?? 0} />
        <MetricBox title="Konversiya" value={formatPercent(metrics.conversionRate)} />
        <MetricBox title="Konversiya umumiy" value={formatPercent(metrics.conversionRate)} />
        <MetricBox title="Follow-up" value={metrics.followUpCount ?? 0} />
        <MetricBox title="Yozuvlar" value={metrics.noteCount ?? 0} />
        <MetricBox title="Bosqich o'zgarishi" value={metrics.stageChangeCount ?? 0} />
      </div>

      <div className="rounded-xl border border-slate-700/50 bg-slate-900/70 p-5">
        <h2 className="text-xl font-semibold text-white">Qo&apos;ng&apos;iroq ma&apos;lumotlari</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-sm text-slate-300">Jami qo&apos;ng&apos;iroqlar</p>
            <p className="mt-2 text-3xl font-semibold text-white">{metrics.totalCalls ?? 0}</p>
          </div>
          <div>
            <p className="text-sm text-slate-300">Kunlik o&apos;rtacha qo&apos;ng&apos;iroqlar</p>
            <p className="mt-2 text-3xl font-semibold text-white">{metrics.averageDailyCalls ?? 0}</p>
          </div>
          <div>
            <p className="text-sm text-slate-300">Qo&apos;ng&apos;iroq davomiyligi</p>
            <p className="mt-2 text-3xl font-semibold text-white">{formatDuration(metrics.totalCallDuration)}</p>
          </div>
          <div>
            <p className="text-sm text-slate-300">Kunlik o&apos;rtacha davomiylik</p>
            <p className="mt-2 text-3xl font-semibold text-white">{formatDuration(metrics.averageDailyCallDuration)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
