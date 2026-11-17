'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { IconArrowRight, IconChartBar, IconCoin, IconPhone, IconUsersGroup } from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import { useDashboardAiPageContext } from '@/contexts/dashboard-ai-context';
import { formatDurationCompact, formatPercent, formatResponseTime, formatSomRounded } from '@/lib/format';
import { getTashkentDateShift, getTashkentToday } from '@/lib/date-range';
import { getConversionBadge, getDebtCollectionBadge, getFollowUpBadge, getMissedCallBadge, getOutboundBadge, getRefundBadge, getResponseTimeBadge, type KpiBadge } from '@/components/dashboard/seller-kpi-badges';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';

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

function KpiPill({ label, value, badge }: { label: string; value: string; badge: KpiBadge }) {
  return (
    <div className={`flex min-w-0 items-center justify-between gap-2 rounded-[10px] px-3 py-2 ${BADGE_COLORS[badge]}`}>
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
    <div className="min-w-0 px-3 py-1 first:pl-0 last:pr-0 sm:px-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
        <MetricIcon className="h-3.5 w-3.5 text-gray-400" stroke={1.8} />
        <span className="truncate">{label}</span>
      </p>
      <p className="tabular mt-1.5 truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">{value}</p>
      <div className="mt-1 space-y-0.5 text-xs text-gray-500">{children}</div>
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
      className="panel group block p-5 transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 sm:p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar name={displayName} />
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-gray-900">{displayName}</h2>
            <p className="text-[13px] font-medium text-gray-500">Agent</p>
          </div>
        </div>
        <span className="inline-flex flex-shrink-0 items-center gap-1 text-[13px] font-medium text-blue-600 group-hover:text-blue-700">
          Batafsil
          <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" stroke={1.8} />
        </span>
      </div>

      {/* Core metrics row */}
      <div className="mt-5 grid grid-cols-3 divide-x divide-gray-100">
        <CoreMetric icon={IconChartBar} label="Sotuvlar" value={salesCount}>
          <p className="tabular truncate">{formatSomRounded(m.incomeAmount)}</p>
          <p className="tabular truncate text-gray-400">Yangi lid: {newLeadsInRange}</p>
        </CoreMetric>
        <CoreMetric icon={IconPhone} label="Qo'ng'iroqlar" value={m.totalCalls ?? 0}>
          <p className="tabular truncate">{formatDurationCompact(m.totalCallDuration)}</p>
        </CoreMetric>
        <CoreMetric icon={IconCoin} label="O'rtacha sotuv" value={formatSomRounded(avgDeal)}>
          <p className="truncate">Kelishuv</p>
        </CoreMetric>
      </div>

      {/* KPI indicators */}
      <div className="mt-5 grid grid-cols-2 gap-2 border-t border-gray-100 pt-4 sm:grid-cols-4">
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
    </Link>
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
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="panel animate-pulse p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-gray-100" />
                <div className="h-5 w-40 rounded bg-gray-100" />
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3">
                <div className="h-20 rounded-[10px] bg-gray-100" />
                <div className="h-20 rounded-[10px] bg-gray-100" />
                <div className="h-20 rounded-[10px] bg-gray-100" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="h-9 rounded-[10px] bg-gray-100" />
                <div className="h-9 rounded-[10px] bg-gray-100" />
                <div className="h-9 rounded-[10px] bg-gray-100" />
                <div className="h-9 rounded-[10px] bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="alert alert-error">
          Sotuvchilar ma'lumotlarini yuklashda xatolik yuz berdi. Sahifani qayta yuklab ko'ring.
        </p>
      ) : !sellers?.length ? (
        <EmptyState title="Ko'rsatish uchun sotuvchi topilmadi." icon={IconUsersGroup} />
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
