'use client';

import Link from 'next/link';
import { trpc } from '@/lib/trpc';

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
  if (hours > 0) {
    return `${hours} soat ${minutes} daqiqa ${secs} soniya`;
  }
  if (minutes > 0) {
    return `${minutes} daqiqa ${secs} soniya`;
  }
  return `${secs} soniya`;
}

function AgentCard({ seller }: { seller: any }) {
  const displayName = seller.name || seller.email || seller.phone || 'Sotuvchi';

  return (
    <Link
      href={`/dashboard/sotuvchilar/${seller.id}`}
      className="block rounded-2xl border border-slate-700/60 bg-slate-900/70 p-5 transition hover:border-blue-500/60 hover:bg-slate-900"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Agent</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{displayName}</h2>
        </div>
        <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-200">
          Batafsil
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-700/50 bg-slate-950/50 p-4">
          <p className="text-sm text-slate-300">Sotuvlar</p>
          <p className="mt-2 text-3xl font-semibold text-white">{seller.metrics.newSalesCount ?? seller.metrics.salesCount ?? 0}</p>
          <p className="mt-3 text-sm text-slate-300">Kelishuv - {formatAmount(seller.metrics.newSalesAgreementAmount)}</p>
          <p className="mt-1 text-sm font-semibold text-white">Tushum - {formatAmount(seller.metrics.incomeAmount)}</p>
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-950/50 p-4">
          <p className="text-sm text-slate-300">30 kunlik suhbat vaqti</p>
          <p className="mt-2 text-3xl font-semibold text-white">{formatDuration(seller.metrics.totalCallDuration)}</p>
          <p className="mt-3 text-sm text-slate-300">Qo'ng'iroqlar soni - {seller.metrics.totalCalls ?? 0}</p>
          <p className="mt-1 text-sm text-slate-300">Follow-up - {seller.metrics.followUpCount ?? 0}</p>
        </div>
      </div>
    </Link>
  );
}

export default function SotuvchilarPage() {
  const dateFrom = getTashkentDateDaysAgo(29);
  const dateTo = getTodayTashkent();

  const { data: sellers, isLoading, error } = trpc.sellers.list.useQuery(
    {
      range: 'custom',
      dateFrom,
      dateTo,
    },
    {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-5">
        <h1 className="text-2xl font-semibold text-white">Sotuvchilar</h1>
        <p className="mt-2 text-sm text-slate-300">
          Har bir agent bo'yicha oxirgi 30 kunlik sotuv, tushum va qo'ng'iroq ko'rsatkichlari.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="animate-pulse rounded-2xl border border-slate-700/60 bg-slate-900/70 p-5">
              <div className="h-6 w-40 rounded bg-slate-700" />
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="h-32 rounded-xl bg-slate-800" />
                <div className="h-32 rounded-xl bg-slate-800" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200">
          Sotuvchilar ma'lumotlarini yuklashda xatolik yuz berdi. Sahifani qayta yuklab ko'ring.
        </div>
      ) : !sellers?.length ? (
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-5 text-sm text-slate-300">
          Ko'rsatish uchun sotuvchi topilmadi.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {sellers.map((seller: any) => (
            <AgentCard key={seller.id} seller={seller} />
          ))}
        </div>
      )}
    </div>
  );
}
