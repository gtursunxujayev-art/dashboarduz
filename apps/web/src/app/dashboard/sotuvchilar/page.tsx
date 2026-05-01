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
    return `${hours} soat ${minutes} daqiqa`;
  }
  if (minutes > 0) {
    return `${minutes} daqiqa ${secs} soniya`;
  }
  return `${secs} soniya`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(1)}%`;
}

type KpiBadge = 'good' | 'warning' | 'critical' | 'neutral';

function getConversionBadge(rate: number | null | undefined): KpiBadge {
  if (rate === null || rate === undefined) return 'neutral';
  if (rate >= 15) return 'good';
  if (rate >= 10) return 'warning';
  return 'critical';
}

function getFollowUpBadge(completed: number, overdue: number): KpiBadge {
  const total = completed + overdue;
  if (total === 0) return 'neutral';
  const rate = (completed / total) * 100;
  if (rate >= 90) return 'good';
  if (rate >= 80) return 'warning';
  return 'critical';
}

function getOutboundBadge(outbound: number, total: number): KpiBadge {
  if (total === 0) return 'neutral';
  const rate = (outbound / total) * 100;
  if (rate >= 60) return 'good';
  if (rate >= 50) return 'warning';
  return 'critical';
}

function getMissedCallBadge(rate: number | null | undefined): KpiBadge {
  if (rate === null || rate === undefined) return 'neutral';
  if (rate <= 5) return 'good';
  if (rate <= 10) return 'warning';
  return 'critical';
}

function getDebtCollectionBadge(rate: number | null | undefined): KpiBadge {
  if (rate === null || rate === undefined) return 'neutral';
  if (rate >= 85) return 'good';
  if (rate >= 70) return 'warning';
  return 'critical';
}

function getRefundBadge(rate: number | null | undefined): KpiBadge {
  if (rate === null || rate === undefined) return 'neutral';
  if (rate <= 5) return 'good';
  if (rate <= 8) return 'warning';
  return 'critical';
}

function getResponseTimeBadge(seconds: number): KpiBadge {
  if (seconds <= 0) return 'neutral';
  if (seconds <= 300) return 'good';
  if (seconds <= 1800) return 'warning';
  return 'critical';
}

function formatResponseTime(seconds: number): string {
  if (seconds <= 0) return '-';
  if (seconds < 60) return `${seconds} son`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} daq`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h} soat ${m} daq`;
}

const BADGE_COLORS: Record<KpiBadge, string> = {
  good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  warning: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  critical: 'border-red-500/40 bg-red-500/10 text-red-300',
  neutral: 'border-slate-600/40 bg-slate-700/30 text-slate-400',
};

function KpiPill({ label, value, badge }: { label: string; value: string; badge: KpiBadge }) {
  return (
    <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${BADGE_COLORS[badge]}`}>
      <span className="text-xs">{label}</span>
      <span className="ml-2 text-sm font-semibold">{value}</span>
    </div>
  );
}

function AgentCard({ seller }: { seller: any }) {
  const m = seller.metrics;
  const displayName = seller.name || seller.email || seller.phone || 'Sotuvchi';
  const salesCount = m.newSalesCount ?? m.salesCount ?? 0;
  const newLeadsInRange = m.newLeadsInRange ?? 0;
  const followUpTotal = (m.followUpCount ?? 0) + (m.overdueFollowUpCount ?? 0);
  const followUpRate = followUpTotal > 0 ? ((m.followUpCount ?? 0) / followUpTotal) * 100 : null;
  const outboundRate = (m.totalCalls ?? 0) > 0 ? ((m.outboundCalls ?? 0) / m.totalCalls) * 100 : null;
  const avgDeal = salesCount > 0 ? (m.newSalesAgreementAmount ?? 0) / salesCount : 0;

  return (
    <Link
      href={`/dashboard/sotuvchilar/${seller.id}`}
      className="block rounded-2xl border border-slate-700/60 bg-slate-900/70 p-5 transition hover:border-blue-500/60 hover:bg-slate-900"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Agent</p>
          <h2 className="mt-1 text-xl font-semibold text-white">{displayName}</h2>
        </div>
        <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-200">
          Batafsil
        </span>
      </div>

      {/* Core metrics row */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-700/50 bg-slate-950/50 p-3 text-center">
          <p className="text-xs text-slate-400">Sotuvlar</p>
          <p className="mt-1 text-2xl font-bold text-white">{salesCount}</p>
          <p className="mt-1 text-xs text-slate-400">{formatAmount(m.incomeAmount)}</p>
          <p className="mt-1 text-xs text-slate-500">Yangi lid: {newLeadsInRange}</p>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-950/50 p-3 text-center">
          <p className="text-xs text-slate-400">Qo'ng'iroqlar</p>
          <p className="mt-1 text-2xl font-bold text-white">{m.totalCalls ?? 0}</p>
          <p className="mt-1 text-xs text-slate-400">{formatDuration(m.totalCallDuration)}</p>
        </div>
        <div className="rounded-xl border border-slate-700/50 bg-slate-950/50 p-3 text-center">
          <p className="text-xs text-slate-400">O'rtacha sotuv</p>
          <p className="mt-1 text-2xl font-bold text-white">{formatAmount(avgDeal)}</p>
          <p className="mt-1 text-xs text-slate-400">Kelishuv</p>
        </div>
      </div>

      {/* KPI indicators */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <KpiPill
          label="Konversiya"
          value={formatPercent(m.conversionRate)}
          badge={getConversionBadge(m.conversionRate)}
        />
        <KpiPill
          label="Lid -> Sotuv"
          value={`${newLeadsInRange} -> ${salesCount}`}
          badge={newLeadsInRange > 0 ? 'good' : 'neutral'}
        />
        <KpiPill
          label="Follow-up"
          value={followUpRate !== null ? `${followUpRate.toFixed(0)}%` : '-'}
          badge={followUpRate !== null ? getFollowUpBadge(m.followUpCount ?? 0, m.overdueFollowUpCount ?? 0) : 'neutral'}
        />
        <KpiPill
          label="Chiquvchi"
          value={outboundRate !== null ? `${outboundRate.toFixed(0)}%` : '-'}
          badge={outboundRate !== null ? getOutboundBadge(m.outboundCalls ?? 0, m.totalCalls ?? 0) : 'neutral'}
        />
        <KpiPill
          label="O'tkazib yub."
          value={formatPercent(m.missedCallRate)}
          badge={getMissedCallBadge(m.missedCallRate)}
        />
        <KpiPill
          label="Qarz yig'ish"
          value={formatPercent(m.debtCollectionRate)}
          badge={getDebtCollectionBadge(m.debtCollectionRate)}
        />
        <KpiPill
          label="Qaytarish"
          value={formatPercent(m.refundRate)}
          badge={getRefundBadge(m.refundRate)}
        />
        <KpiPill
          label="Javob vaqti"
          value={formatResponseTime(m.leadResponseTime?.avgResponseSeconds ?? 0)}
          badge={getResponseTimeBadge(m.leadResponseTime?.avgResponseSeconds ?? 0)}
        />
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
              <div className="mt-6 grid grid-cols-3 gap-3">
                <div className="h-24 rounded-xl bg-slate-800" />
                <div className="h-24 rounded-xl bg-slate-800" />
                <div className="h-24 rounded-xl bg-slate-800" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="h-9 rounded-lg bg-slate-800" />
                <div className="h-9 rounded-lg bg-slate-800" />
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
