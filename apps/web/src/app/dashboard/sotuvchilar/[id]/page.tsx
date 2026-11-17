'use client';

import { trpc } from '@/lib/trpc';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';
import {
  IconCalendarTime,
  IconChartBar,
  IconChecklist,
  IconClockHour4,
  IconCoin,
  IconMessageCircle,
  IconPercentage,
  IconPhone,
  IconSend,
  IconTargetArrow,
  IconUserSearch,
  IconWallet,
} from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile, type StatTone } from '@/components/ui/stat-tile';
import { getInitials } from '@/components/ui/user-avatar';
import { formatDurationClock, formatPercent, formatResponseTime, formatSomRounded } from '@/lib/format';
import { getTashkentDateShift, getTashkentToday } from '@/lib/date-range';
import { getConversionBadge, getDailyTalkBadge, getDeadlineBadge, getDebtCollectionBadge, getFollowUpBadge, getMissedCallBadge, getOutboundBadge, getRefundBadge, getResponseTimeBadge, type KpiBadge } from '@/components/dashboard/seller-kpi-badges';
import { type SellerRange } from '@dashboarduz/shared';


function formatDurationReadable(seconds: number | null | undefined): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours} soat ${minutes} daqiqa`;
  return `${minutes} daqiqa`;
}

const BADGE_TONES: Record<KpiBadge, StatTone> = {
  good: 'green',
  warning: 'amber',
  critical: 'red',
  neutral: 'neutral',
};

const BADGE_TEXT: Record<KpiBadge, string> = {
  good: 'text-emerald-700',
  warning: 'text-amber-700',
  critical: 'text-red-700',
  neutral: 'text-gray-900',
};

const BADGE_DOTS: Record<KpiBadge, string> = {
  good: 'bg-emerald-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
  neutral: 'bg-gray-300',
};

/** Headline KPI: a stat tile tinted by its traffic-light grade. */
function MetricCard({
  title,
  value,
  subtitle,
  extra,
  badge,
  icon,
}: {
  title: string;
  value: string | number;
  subtitle?: string | null;
  extra?: string | null;
  badge?: KpiBadge;
  icon?: Icon;
}) {
  const b = badge ?? 'neutral';
  return (
    <StatTile
      label={title}
      value={value}
      icon={icon}
      tone={badge ? BADGE_TONES[b] : 'blue'}
      hint={subtitle || extra ? (
        <>
          {subtitle ? <span className="block">{subtitle}</span> : null}
          {extra ? <span className="mt-0.5 block font-semibold text-gray-900">{extra}</span> : null}
        </>
      ) : undefined}
    />
  );
}

/** Detail metric: a row inside a section panel, label and note left, value right. */
function MetricRow({
  title,
  value,
  subtitle,
  extra,
  badge,
}: {
  title: string;
  value: string | number;
  subtitle?: string | null;
  extra?: string | null;
  badge?: KpiBadge;
}) {
  const b = badge ?? 'neutral';
  return (
    <li className="flex items-start justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium text-gray-900">
          {badge ? <span className={`h-2 w-2 flex-shrink-0 rounded-full ${BADGE_DOTS[b]}`} aria-hidden="true" /> : null}
          {title}
        </p>
        {subtitle ? <p className="tabular mt-0.5 text-[13px] text-gray-500">{subtitle}</p> : null}
      </div>
      <div className="flex-shrink-0 text-right">
        <p className={`tabular text-lg font-semibold leading-tight tracking-tight ${BADGE_TEXT[b]}`}>{value}</p>
        {extra ? <p className="tabular mt-0.5 text-[13px] font-medium text-gray-700">{extra}</p> : null}
      </div>
    </li>
  );
}

function SectionPanel({ title, icon: SectionIcon, children, className = '' }: { title: ReactNode; icon: Icon; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-header">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-gray-100 text-gray-600">
            <SectionIcon className="h-4 w-4" stroke={1.8} />
          </span>
          <h3 className="section-title">{title}</h3>
        </div>
      </div>
      <ul className="divide-y divide-gray-100 px-5 pb-2 pt-2 sm:px-6">{children}</ul>
    </section>
  );
}

export default function SellerDetailsPage({ params }: { params: { id: string } }) {
  const [range, setRange] = useState<SellerRange>('last30days');
  const [dateFrom, setDateFrom] = useState(getTashkentDateShift(-29));
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [sendMessage, setSendMessage] = useState<string | null>(null);

  const queryInput = useMemo(() => {
    if (range === 'custom') {
      return { id: params.id, range, dateFrom, dateTo };
    }
    return { id: params.id, range };
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
    return <LoadingBlock message="Sotuvchi ma'lumotlari yuklanmoqda..." />;
  }

  if (!sellerQuery.data) {
    return <p className="alert alert-error">Sotuvchi topilmadi.</p>;
  }

  const { seller, metrics: m } = sellerQuery.data;
  const displayName = seller.name || seller.email || seller.phone || 'Sotuvchi';

  // Computed KPIs
  const salesCount = m.newSalesCount ?? m.salesCount ?? 0;
  const followUpTotal = (m.followUpCount ?? 0) + (m.overdueFollowUpCount ?? 0);
  const followUpRate = followUpTotal > 0 ? ((m.followUpCount ?? 0) / followUpTotal) * 100 : null;
  const outboundRate = (m.totalCalls ?? 0) > 0 ? ((m.outboundCalls ?? 0) / (m.totalCalls ?? 1)) * 100 : null;
  const inboundRate = (m.totalCalls ?? 0) > 0 ? ((m.inboundCalls ?? 0) / (m.totalCalls ?? 1)) * 100 : null;

  return (
    <div className="space-y-6">
      {/* Profile header */}
      <PageHeader
        title={(
          <span className="flex items-center gap-4">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-lg font-semibold text-blue-700"
            >
              {getInitials(displayName)}
            </span>
            <span className="min-w-0 break-words">{displayName}</span>
          </span>
        )}
        description="Agent bo'yicha sotuv, tushum, CRM va qo'ng'iroq ko'rsatkichlari."
        actions={(
          <button
            onClick={() => {
              setSendMessage(null);
              sendPdfMutation.mutate(queryInput);
            }}
            disabled={sendPdfMutation.isLoading}
            className="btn btn-primary"
          >
            <IconSend className="h-4 w-4" stroke={1.8} />
            {sendPdfMutation.isLoading ? 'Yuborilmoqda...' : 'PDF ni adminlarga yuborish'}
          </button>
        )}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="max-w-full overflow-x-auto">
            <div className="segmented">
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
                  aria-pressed={range === option.key}
                  className={`segmented-item ${range === option.key ? 'segmented-item-active' : ''}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {range === 'custom' ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="field w-auto"
              />
              <span className="text-gray-400" aria-hidden="true">-</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="field w-auto"
              />
            </div>
          ) : null}
        </div>

        {sendMessage ? (
          <p className="alert alert-info">
            {sendMessage}
          </p>
        ) : null}
      </PageHeader>

      {/* KPI Performance Indicators */}
      <section className="space-y-3">
        <h2 className="section-title">Asosiy ko'rsatkichlar (KPI)</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            title="Konversiya"
            value={formatPercent(m.conversionRate, 1)}
            subtitle={`Yangi lidlar: ${m.newLeadsInRange ?? 0} -> Sotuvlar: ${salesCount}`}
            badge={getConversionBadge(m.conversionRate)}
            icon={IconTargetArrow}
          />
          <MetricCard
            title="O'rtacha sotuv"
            value={formatSomRounded(m.averageAgreementAmount ?? m.averageDealAmount)}
            subtitle="Bir sotuvga o'rtacha kelishuv"
            icon={IconCoin}
          />
          <MetricCard
            title="Follow-up bajarish"
            value={followUpRate !== null ? `${followUpRate.toFixed(0)}%` : '-'}
            subtitle={`${m.followUpCount ?? 0} bajarildi / ${m.overdueFollowUpCount ?? 0} kechikdi`}
            badge={followUpRate !== null ? getFollowUpBadge(m.followUpCount ?? 0, m.overdueFollowUpCount ?? 0) : undefined}
            icon={IconChecklist}
          />
          <MetricCard
            title="Kunlik suhbat vaqti"
            value={formatDurationReadable(m.averageDailyCallDuration)}
            subtitle={`Kunlik o'rtacha ${m.averageDailyCalls ?? 0} qo'ng'iroq`}
            badge={getDailyTalkBadge(m.averageDailyCallDuration, (m.totalCalls ?? 0) > 0)}
            icon={IconClockHour4}
          />
          <MetricCard
            title="Lid javob vaqti"
            value={formatResponseTime(m.leadResponseTime?.avgResponseSeconds ?? 0)}
            subtitle={`Median: ${formatResponseTime(m.leadResponseTime?.medianResponseSeconds ?? 0)} | ${m.leadResponseTime?.respondedCount ?? 0}/${m.leadResponseTime?.totalCount ?? 0} lid`}
            badge={getResponseTimeBadge(m.leadResponseTime?.avgResponseSeconds ?? 0)}
            icon={IconMessageCircle}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Sales Breakdown */}
        <SectionPanel title="Sotuv ko'rsatkichlari" icon={IconChartBar}>
          <MetricRow
            title="Sotuv shartnomasi"
            value={salesCount}
            subtitle={`Kelishuv - ${formatSomRounded(m.newSalesAgreementAmount)}`}
            extra={`Tushum - ${formatSomRounded(m.incomeAmount)}`}
          />
          <MetricRow
            title="Sotuv - Onlayn"
            value={m.onlineSalesCount ?? 0}
            subtitle={`Kelishuv - ${formatSomRounded(m.onlineSalesAgreementAmount)}`}
            extra={`Tushum - ${formatSomRounded(m.onlineSalesIncomeAmount)}`}
          />
          <MetricRow
            title="Sotuv - Oflayn"
            value={m.offlineSalesCount ?? 0}
            subtitle={`Kelishuv - ${formatSomRounded(m.offlineSalesAgreementAmount)}`}
            extra={`Tushum - ${formatSomRounded(m.offlineSalesIncomeAmount)}`}
          />
          <MetricRow
            title="Sotuv - Intensiv"
            value={m.intensiveSalesCount ?? 0}
            subtitle={`Kelishuv - ${formatSomRounded(m.intensiveSalesAgreementAmount)}`}
            extra={`Tushum - ${formatSomRounded(m.intensiveSalesIncomeAmount)}`}
          />
        </SectionPanel>

        {/* Calls & Activity */}
        <SectionPanel title="Qo'ng'iroqlar va faollik" icon={IconPhone}>
          <MetricRow
            title="Jami qo'ng'iroqlar"
            value={m.totalCalls ?? 0}
            subtitle={`Davomiylik - ${formatDurationClock(m.totalCallDuration)}`}
          />
          <MetricRow
            title="Chiquvchi qo'ng'iroqlar"
            value={`${m.outboundCalls ?? 0} (${outboundRate !== null ? outboundRate.toFixed(0) + '%' : '-'})`}
            subtitle="Proaktiv qo'ng'iroqlar"
            badge={outboundRate !== null ? getOutboundBadge(m.outboundCalls ?? 0, m.totalCalls ?? 0) : undefined}
          />
          <MetricRow
            title="Kiruvchi qo'ng'iroqlar"
            value={`${m.inboundCalls ?? 0} (${inboundRate !== null ? inboundRate.toFixed(0) + '%' : '-'})`}
            subtitle="Qabul qilingan qo'ng'iroqlar"
          />
          <MetricRow
            title="O'tkazib yuborilgan"
            value={`${m.missedCalls ?? 0} (${formatPercent(m.missedCallRate, 1)})`}
            subtitle="Javobsiz qo'ng'iroqlar"
            badge={getMissedCallBadge(m.missedCallRate)}
          />
          <MetricRow
            title="O'rtacha davomiylik"
            value={formatDurationClock(m.averageCallDuration)}
            subtitle="Har bir qo'ng'iroq uchun"
          />
        </SectionPanel>

        {/* CRM Activity */}
        <SectionPanel title="CRM faoliyat" icon={IconCalendarTime}>
          <MetricRow title="Bajarilgan follow-up" value={m.followUpCount ?? 0} subtitle="Yakunlangan vazifalar" />
          <MetricRow title="Bugungi follow-up" value={m.todayFollowUpCount ?? 0} subtitle="Bugun uchun vazifalar" />
          <MetricRow
            title="Muddati o'tgan"
            value={m.overdueFollowUpCount ?? 0}
            subtitle="Kechikkan follow-up lar"
            badge={(m.overdueFollowUpCount ?? 0) > 5 ? 'critical' : (m.overdueFollowUpCount ?? 0) > 0 ? 'warning' : 'good'}
          />
          <MetricRow title="Yozuvlar" value={m.noteCount ?? 0} subtitle="CRM izohlari" />
          <MetricRow title="Bosqich o'zgarishi" value={m.stageChangeCount ?? 0} subtitle="Bosqich almashuvlari" />
        </SectionPanel>

        {/* Lead Metrics */}
        <SectionPanel title="Lid ko'rsatkichlari" icon={IconUserSearch}>
          <MetricRow title="Faol lidlar" value={m.activeLeads ?? 0} subtitle="Hozirgi faol lidlar" />
          <MetricRow title="Yangi lidlar" value={m.newLeadsInRange ?? 0} subtitle="Filtr davridagi yangi lidlar" />
          <MetricRow title="Yutilgan lidlar" value={m.wonLeads ?? 0} subtitle="Muvaffaqiyatli sotuvlar" />
          <MetricRow title="Yo'qotilgan lidlar" value={m.lostLeads ?? 0} subtitle="Yo'qotilgan imkoniyatlar" />
          <MetricRow
            title="Konversiya"
            value={formatPercent(m.conversionRate, 1)}
            subtitle={`Yangi lidlar: ${m.newLeadsInRange ?? 0} -> Sotuvlar: ${salesCount}`}
            badge={getConversionBadge(m.conversionRate)}
          />
        </SectionPanel>
      </div>

      {/* Financial KPIs */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 section-title">
          <IconWallet className="h-[18px] w-[18px] text-gray-400" stroke={1.6} />
          Moliyaviy ko'rsatkichlar
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Qarz yig'ish darajasi"
            value={formatPercent(m.debtCollectionRate, 1)}
            subtitle={`${formatSomRounded(m.totalPaidAmount)} / ${formatSomRounded(m.totalAgreementAmount)}`}
            badge={getDebtCollectionBadge(m.debtCollectionRate)}
            icon={IconWallet}
          />
          <MetricCard
            title="Qaytarish darajasi"
            value={formatPercent(m.refundRate, 1)}
            subtitle={`${m.refundCount ?? 0} ta qaytarish / ${salesCount} sotuv`}
            badge={getRefundBadge(m.refundRate)}
            icon={IconPercentage}
          />
          <MetricCard
            title="To'lov muddati"
            value={formatPercent(m.deadlineAdherenceRate, 1)}
            subtitle={`${m.deadlineMet ?? 0} / ${m.deadlineTotal ?? 0} o'z vaqtida`}
            badge={getDeadlineBadge(m.deadlineAdherenceRate)}
            icon={IconCalendarTime}
          />
          <MetricCard
            title="Yangi vs Qayta mijozlar"
            value={`${m.newCustomers ?? 0} / ${m.repeatCustomers ?? 0}`}
            subtitle={`Yangi mijoz: ${formatPercent(m.newCustomerRate, 1)}`}
            icon={IconUserSearch}
          />
        </div>
      </section>
    </div>
  );
}
