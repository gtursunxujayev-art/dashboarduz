'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { IconArrowRight, IconChartBar, IconCoin, IconPhone, IconTrophy, IconUsersGroup } from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useDashboardAiPageContext } from '@/contexts/dashboard-ai-context';
import { formatDurationCompact, formatPercent, formatResponseTime, formatSomRounded } from '@/lib/format';
import { getTashkentDateShift, getTashkentToday } from '@/lib/date-range';
import { getConversionBadge, getDebtCollectionBadge, getFollowUpBadge, getMissedCallBadge, getOutboundBadge, getRefundBadge, getResponseTimeBadge, type KpiBadge } from '@/components/dashboard/seller-kpi-badges';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { getInitials } from '@/components/ui/user-avatar';

const BADGE_COLORS: Record<KpiBadge, string> = {
  good: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-800',
  critical: 'bg-red-50 text-red-700',
  neutral: 'bg-gray-50 text-gray-600',
};

const BADGE_DOTS: Record<KpiBadge, string> = {
  good: 'bg-emerald-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
  neutral: 'bg-gray-300',
};

type CardVariant = 'podium' | 'grid';

function KpiPill({ label, value, badge }: { label: string; value: string; badge: KpiBadge }) {
  return (
    <div className={`flex min-w-0 items-center justify-between gap-2 rounded-full px-3 py-1.5 ${BADGE_COLORS[badge]}`}>
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${BADGE_DOTS[badge]}`} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className="tabular whitespace-nowrap text-[13px] font-semibold">{value}</span>
    </div>
  );
}

function CoreMetric({
  icon: MetricIcon,
  label,
  value,
  children,
}: {
  icon: typeof IconChartBar;
  label: string;
  value: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[16px] bg-gray-50 px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
        <MetricIcon className="h-3.5 w-3.5 text-gray-400" stroke={1.8} />
        <span className="truncate">{label}</span>
      </p>
      <p className="tabular mt-1 truncate text-lg font-semibold tracking-tight text-gray-900">{value}</p>
      <div className="mt-0.5 space-y-0.5 text-xs text-gray-500">{children}</div>
    </div>
  );
}

function RankMark({ rank, variant }: { rank: number; variant: CardVariant }) {
  if (variant === 'podium') {
    const tone = rank === 1 ? 'bg-blue-600 text-white shadow-[0_6px_16px_-6px_rgb(34_72_226/0.6)]' : 'bg-gray-100 text-gray-700';
    return (
      <span className={`inline-flex h-8 flex-shrink-0 items-center gap-1 rounded-full px-3 text-sm font-semibold tabular ${tone}`}>
        <IconTrophy className="h-4 w-4" stroke={1.8} aria-hidden="true" />
        {rank}
      </span>
    );
  }
  return (
    <span className="tabular flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
      {rank}
    </span>
  );
}

function AgentCard({ seller, rank, maxSales, variant }: { seller: any; rank: number; maxSales: number; variant: CardVariant }) {
  const m = seller.metrics;
  const displayName = seller.name || seller.email || seller.phone || 'Sotuvchi';
  const salesCount = m.newSalesCount ?? m.salesCount ?? 0;
  const newLeadsInRange = m.newLeadsInRange ?? 0;
  const followUpTotal = (m.followUpCount ?? 0) + (m.overdueFollowUpCount ?? 0);
  const followUpRate = followUpTotal > 0 ? ((m.followUpCount ?? 0) / followUpTotal) * 100 : null;
  const outboundRate = (m.totalCalls ?? 0) > 0 ? ((m.outboundCalls ?? 0) / m.totalCalls) * 100 : null;
  const avgDeal = salesCount > 0 ? (m.newSalesAgreementAmount ?? 0) / salesCount : 0;
  const share = maxSales > 0 ? Math.min(100, (salesCount / maxSales) * 100) : 0;
  const isPodium = variant === 'podium';
  const isLeader = isPodium && rank === 1;

  return (
    <Link
      href={`/dashboard/sotuvchilar/${seller.id}`}
      className={`panel group flex flex-col transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
        isPodium ? 'p-6' : 'p-5'
      } ${isLeader ? 'ring-1 ring-blue-500/30' : ''}`}
    >
      {/* Identity row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {!isPodium && <RankMark rank={rank} variant={variant} />}
          <span
            aria-hidden="true"
            className={`flex flex-shrink-0 items-center justify-center rounded-full font-semibold ${
              isPodium ? 'h-12 w-12 text-sm' : 'h-9 w-9 text-xs'
            } ${isLeader ? 'bg-blue-50 text-blue-700' : 'bg-gray-200 text-gray-700'}`}
          >
            {getInitials(displayName)}
          </span>
          <div className="min-w-0">
            <h2 className={`truncate font-semibold text-gray-900 ${isPodium ? 'text-base' : 'text-[15px]'}`}>{displayName}</h2>
            <p className="text-[13px] font-medium text-gray-500">Agent</p>
          </div>
        </div>
        {isPodium ? <RankMark rank={rank} variant={variant} /> : null}
      </div>

      {/* Main figure: sales, with the bar against the leader */}
      <div className={isPodium ? 'mt-6' : 'mt-5'}>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <IconChartBar className="h-3.5 w-3.5 text-gray-400" stroke={1.8} />
              Sotuvlar
            </p>
            <p className={`tabular mt-1 font-semibold leading-none tracking-[-0.02em] text-gray-900 ${isPodium ? 'text-[40px]' : 'text-[28px]'}`}>
              {salesCount}
            </p>
          </div>
          <div className="min-w-0 text-right text-xs text-gray-500">
            <p className="tabular truncate text-sm font-medium text-gray-900">{formatSomRounded(m.incomeAmount)}</p>
            <p className="tabular truncate">Yangi lid: {newLeadsInRange}</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
          <span
            className={`block h-full origin-left animate-grow-x rounded-full ${isLeader || !isPodium ? 'bg-blue-600' : 'bg-blue-400'}`}
            style={{ width: `${share}%` }}
          />
        </div>
      </div>

      {/* Calls and average deal */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <CoreMetric icon={IconPhone} label="Qo'ng'iroqlar" value={m.totalCalls ?? 0}>
          <p className="tabular truncate">{formatDurationCompact(m.totalCallDuration)}</p>
        </CoreMetric>
        <CoreMetric icon={IconCoin} label="O'rtacha sotuv" value={formatSomRounded(avgDeal)}>
          <p className="truncate">Kelishuv</p>
        </CoreMetric>
      </div>

      {/* KPI indicators */}
      <div className="mt-4 grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2">
        <KpiPill
          label="Konversiya"
          value={formatPercent(m.conversionRate, 1)}
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
          value={formatPercent(m.missedCallRate, 1)}
          badge={getMissedCallBadge(m.missedCallRate)}
        />
        <KpiPill
          label="Qarz yig'ish"
          value={formatPercent(m.debtCollectionRate, 1)}
          badge={getDebtCollectionBadge(m.debtCollectionRate)}
        />
        <KpiPill
          label="Qaytarish"
          value={formatPercent(m.refundRate, 1)}
          badge={getRefundBadge(m.refundRate)}
        />
        <KpiPill
          label="Javob vaqti"
          value={formatResponseTime(m.leadResponseTime?.avgResponseSeconds ?? 0)}
          badge={getResponseTimeBadge(m.leadResponseTime?.avgResponseSeconds ?? 0)}
        />
      </div>

      <span className="mt-5 inline-flex items-center gap-1 self-end text-[13px] font-medium text-blue-600 group-hover:text-blue-700">
        Batafsil
        <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" stroke={1.8} />
      </span>
    </Link>
  );
}

function CardSkeleton({ variant }: { variant: CardVariant }) {
  const isPodium = variant === 'podium';
  return (
    <div className={`panel animate-pulse ${isPodium ? 'p-6' : 'p-5'}`}>
      <div className="flex items-center gap-3">
        <div className={`rounded-full bg-gray-100 ${isPodium ? 'h-12 w-12' : 'h-9 w-9'}`} />
        <div className="space-y-2">
          <div className="h-4 w-32 rounded-full bg-gray-100" />
          <div className="h-3 w-16 rounded-full bg-gray-100" />
        </div>
      </div>
      <div className={`rounded-full bg-gray-100 ${isPodium ? 'mt-6 h-10 w-20' : 'mt-5 h-7 w-14'}`} />
      <div className="mt-3 h-1.5 rounded-full bg-gray-100" />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="h-[76px] rounded-[16px] bg-gray-100" />
        <div className="h-[76px] rounded-[16px] bg-gray-100" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-1.5">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-7 rounded-full bg-gray-100" />
        ))}
      </div>
    </div>
  );
}

export default function SotuvchilarPage() {
  const dateFrom = getTashkentDateShift(-29);
  const dateTo = getTashkentToday();

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

  const aiPageContext = useMemo(() => ({
    pageKey: '/dashboard/sotuvchilar',
    rangeMode: 'last30days',
    dateFrom,
    dateTo,
    filters: {},
    metrics: {
      sellersCount: sellers?.length ?? 0,
      totalSalesCount: (sellers || []).reduce((sum: number, seller: any) => sum + Number(seller?.metrics?.newSalesCount ?? seller?.metrics?.salesCount ?? 0), 0),
      totalIncomeAmount: (sellers || []).reduce((sum: number, seller: any) => sum + Number(seller?.metrics?.incomeAmount ?? 0), 0),
      totalNewLeadsInRange: (sellers || []).reduce((sum: number, seller: any) => sum + Number(seller?.metrics?.newLeadsInRange ?? 0), 0),
      totalCalls: (sellers || []).reduce((sum: number, seller: any) => sum + Number(seller?.metrics?.totalCalls ?? 0), 0),
      totalTalkSeconds: (sellers || []).reduce((sum: number, seller: any) => sum + Number(seller?.metrics?.totalCallDuration ?? 0), 0),
    },
  }), [dateFrom, dateTo, sellers]);
  useDashboardAiPageContext(aiPageContext);

  // The API already returns sellers ranked (sales, then income); the order is kept as is.
  const maxSales = (sellers || []).reduce(
    (max: number, seller: any) => Math.max(max, Number(seller?.metrics?.newSalesCount ?? seller?.metrics?.salesCount ?? 0)),
    0,
  );
  const podium = (sellers || []).slice(0, 3);
  const rest = (sellers || []).slice(3);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sotuvchilar"
        description="Har bir agent bo'yicha oxirgi 30 kunlik sotuv, tushum va qo'ng'iroq ko'rsatkichlari."
        actions={
          sellers?.length ? (
            <span className="badge badge-neutral tabular">
              <IconUsersGroup className="h-3.5 w-3.5" stroke={1.8} />
              {sellers.length}
            </span>
          ) : null
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <CardSkeleton key={index} variant="podium" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <CardSkeleton key={index} variant="grid" />
            ))}
          </div>
        </div>
      ) : error ? (
        <p className="alert alert-error">
          Sotuvchilar ma'lumotlarini yuklashda xatolik yuz berdi. Sahifani qayta yuklab ko'ring.
        </p>
      ) : !sellers?.length ? (
        <EmptyState title="Ko'rsatish uchun sotuvchi topilmadi." icon={IconUsersGroup} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-3">
            {podium.map((seller: any, index: number) => (
              <AgentCard key={seller.id} seller={seller} rank={index + 1} maxSales={maxSales} variant="podium" />
            ))}
          </div>
          {rest.length > 0 && (
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rest.map((seller: any, index: number) => (
                <AgentCard key={seller.id} seller={seller} rank={index + 4} maxSales={maxSales} variant="grid" />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
