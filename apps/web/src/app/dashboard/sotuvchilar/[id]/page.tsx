'use client';

import { trpc } from '@/lib/trpc';
import { useMemo, useState } from 'react';

type SellerRange = 'today' | 'week' | 'month' | 'last30days' | 'custom';

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

function getTashkentDateDaysAgo(daysAgo: number): string {
  const now = new Date();
  const shifted = new Date(now.getTime() + (5 * 60 * 60 * 1000));
  shifted.setUTCDate(shifted.getUTCDate() - daysAgo);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatAmount(value: number | null | undefined): string {
  return `${Math.round(value || 0).toLocaleString('ru-RU')} so'm`;
}

function formatDuration(seconds: number | null | undefined): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function MetricCard({
  title,
  value,
  subtitle,
  extra,
}: {
  title: string;
  value: string | number;
  subtitle?: string | null;
  extra?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-5">
      <p className="text-sm text-slate-300">{title}</p>
      <p className="mt-2 text-4xl font-semibold text-white">{value}</p>
      {subtitle ? <p className="mt-3 text-sm text-slate-300">{subtitle}</p> : null}
      {extra ? <p className="mt-1 text-sm font-semibold text-white">{extra}</p> : null}
    </div>
  );
}

export default function SellerDetailsPage({ params }: { params: { id: string } }) {
  const [range, setRange] = useState<SellerRange>('last30days');
  const [dateFrom, setDateFrom] = useState(getTashkentDateDaysAgo(29));
  const [dateTo, setDateTo] = useState(getTodayTashkent());
  const [sendMessage, setSendMessage] = useState<string | null>(null);

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

  const sellerQuery = trpc.sellers.getById.useQuery(queryInput, {
    keepPreviousData: true,
  });
  const sendPdfMutation = trpc.sellers.sendPdfToAdmins.useMutation({
    onSuccess: (result) => {
      setSendMessage(`PDF adminlarga yuborildi: ${result.recipientCount} ta qabul qiluvchi.`);
    },
    onError: (error) => {
      setSendMessage(error.message);
    },
  });

  if (sellerQuery.isLoading) {
    return <p className="text-sm text-slate-300">Sotuvchi ma'lumotlari yuklanmoqda...</p>;
  }

  if (!sellerQuery.data) {
    return <p className="text-sm text-red-300">Sotuvchi topilmadi.</p>;
  }

  const { seller, metrics } = sellerQuery.data;
  const displayName = seller.name || seller.email || seller.phone || 'Sotuvchi';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">{displayName}</h1>
            <p className="mt-2 text-sm text-slate-300">Agent bo'yicha sotuv, tushum, CRM va qo'ng'iroq ko'rsatkichlari.</p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              onClick={() => {
                setSendMessage(null);
                sendPdfMutation.mutate(queryInput);
              }}
              disabled={sendPdfMutation.isLoading}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sendPdfMutation.isLoading ? 'Yuborilmoqda...' : 'PDF ni adminlarga yuborish'}
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          {[
            { key: 'today', label: 'Bugun' },
            { key: 'week', label: 'Hafta' },
            { key: 'month', label: 'Oy' },
            { key: 'last30days', label: '30 kun' },
            { key: 'custom', label: 'Maxsus' },
          ].map((option) => (
            <button
              key={option.key}
              onClick={() => {
                setSendMessage(null);
                setRange(option.key as SellerRange);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                range === option.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
              }`}
            >
              {option.label}
            </button>
          ))}

          {range === 'custom' ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
              />
            </div>
          ) : null}
        </div>

        {sendMessage ? (
          <div className="mt-4 rounded-xl border border-slate-700/60 bg-slate-950/50 px-4 py-3 text-sm text-slate-200">
            {sendMessage}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <MetricCard
          title="Sotuv shartnomasi"
          value={metrics.newSalesCount ?? metrics.salesCount ?? 0}
          subtitle={`Kelishuv - ${formatAmount(metrics.newSalesAgreementAmount)}`}
          extra={`Tushum - ${formatAmount(metrics.incomeAmount)}`}
        />
        <MetricCard
          title="Sotuv - Onlayn"
          value={metrics.onlineSalesCount ?? 0}
          subtitle={`Kelishuv - ${formatAmount(metrics.onlineSalesAgreementAmount)}`}
          extra={`Tushum - ${formatAmount(metrics.onlineSalesIncomeAmount)}`}
        />
        <MetricCard
          title="Sotuv - Oflayn"
          value={metrics.offlineSalesCount ?? 0}
          subtitle={`Kelishuv - ${formatAmount(metrics.offlineSalesAgreementAmount)}`}
          extra={`Tushum - ${formatAmount(metrics.offlineSalesIncomeAmount)}`}
        />
        <MetricCard
          title="Sotuv - Intensiv"
          value={metrics.intensiveSalesCount ?? 0}
          subtitle={`Kelishuv - ${formatAmount(metrics.intensiveSalesAgreementAmount)}`}
          extra={`Tushum - ${formatAmount(metrics.intensiveSalesIncomeAmount)}`}
        />
        <MetricCard
          title="Qo'ng'iroqlar"
          value={metrics.totalCalls ?? 0}
          subtitle={`Davomiylik - ${formatDuration(metrics.totalCallDuration)}`}
          extra={`Kunlik o'rtacha - ${metrics.averageDailyCalls ?? 0}`}
        />
        <MetricCard
          title="O'rtacha sotuv"
          value={formatAmount(metrics.averageAgreementAmount ?? metrics.averageDealAmount)}
          subtitle="Bir sotuvga to'g'ri keladigan o'rtacha kelishuv"
        />
        <MetricCard title="Bajarilgan follow-up" value={metrics.followUpCount ?? 0} subtitle="Yakunlangan vazifalar" />
        <MetricCard title="Yozuvlar" value={metrics.noteCount ?? 0} subtitle="CRM izohlari" />
        <MetricCard title="CRM o'zgarishlari" value={metrics.stageChangeCount ?? 0} subtitle="Bosqich almashuvlari" />
        <MetricCard title="Bugungi follow-up" value={metrics.todayFollowUpCount ?? 0} subtitle="Bugun uchun vazifalar" />
        <MetricCard title="Muddati o'tgan follow-up" value={metrics.overdueFollowUpCount ?? 0} subtitle="Kechikkan follow-up lar" />
      </div>
    </div>
  );
}
