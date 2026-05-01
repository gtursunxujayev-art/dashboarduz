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

function formatDurationReadable(seconds: number | null | undefined): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours} soat ${minutes} daqiqa`;
  return `${minutes} daqiqa`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return `${value.toFixed(1)}%`;
}

type KpiBadge = 'good' | 'warning' | 'critical' | 'neutral';

const BADGE_COLORS: Record<KpiBadge, string> = {
  good: 'border-emerald-500/40 bg-emerald-500/10',
  warning: 'border-amber-500/40 bg-amber-500/10',
  critical: 'border-red-500/40 bg-red-500/10',
  neutral: 'border-slate-700/60 bg-slate-900/70',
};

const BADGE_TEXT: Record<KpiBadge, string> = {
  good: 'text-emerald-300',
  warning: 'text-amber-300',
  critical: 'text-red-300',
  neutral: 'text-slate-300',
};

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

function getDailyTalkBadge(seconds: number | null | undefined, hasCalls: boolean): KpiBadge {
  if (!hasCalls) return 'neutral';
  const s = seconds ?? 0;
  if (s >= 7200) return 'good';
  if (s >= 5400) return 'warning';
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

function getDeadlineBadge(rate: number | null | undefined): KpiBadge {
  if (rate === null || rate === undefined) return 'neutral';
  if (rate >= 90) return 'good';
  if (rate >= 75) return 'warning';
  return 'critical';
}

function getResponseTimeBadge(seconds: number): KpiBadge {
  if (seconds <= 0) return 'neutral';
  if (seconds <= 300) return 'good';       // <= 5 min
  if (seconds <= 1800) return 'warning';   // <= 30 min
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

function MetricCard({
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
    <div className={`rounded-2xl border p-5 ${BADGE_COLORS[b]}`}>
      <p className="text-sm text-slate-300">{title}</p>
      <p className={`mt-2 text-4xl font-semibold ${badge ? BADGE_TEXT[b] : 'text-white'}`}>{value}</p>
      {subtitle ? <p className="mt-3 text-sm text-slate-300">{subtitle}</p> : null}
      {extra ? <p className="mt-1 text-sm font-semibold text-white">{extra}</p> : null}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{children}</h3>
  );
}

export default function SellerDetailsPage({ params }: { params: { id: string } }) {
  const [range, setRange] = useState<SellerRange>('last30days');
  const [dateFrom, setDateFrom] = useState(getTashkentDateDaysAgo(29));
  const [dateTo, setDateTo] = useState(getTodayTashkent());
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
    return <p className="text-sm text-slate-300">Sotuvchi ma'lumotlari yuklanmoqda...</p>;
  }

  if (!sellerQuery.data) {
    return <p className="text-sm text-red-300">Sotuvchi topilmadi.</p>;
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
      {/* Header */}
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

      {/* KPI Performance Indicators */}
      <div>
        <SectionHeading>Asosiy ko'rsatkichlar (KPI)</SectionHeading>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <MetricCard
            title="Konversiya"
            value={formatPercent(m.conversionRate)}
            subtitle={`Yangi lidlar: ${m.newLeadsInRange ?? 0} -> Sotuvlar: ${salesCount}`}
            badge={getConversionBadge(m.conversionRate)}
          />
          <MetricCard
            title="O'rtacha sotuv"
            value={formatAmount(m.averageAgreementAmount ?? m.averageDealAmount)}
            subtitle="Bir sotuvga o'rtacha kelishuv"
          />
          <MetricCard
            title="Follow-up bajarish"
            value={followUpRate !== null ? `${followUpRate.toFixed(0)}%` : '-'}
            subtitle={`${m.followUpCount ?? 0} bajarildi / ${m.overdueFollowUpCount ?? 0} kechikdi`}
            badge={followUpRate !== null ? getFollowUpBadge(m.followUpCount ?? 0, m.overdueFollowUpCount ?? 0) : undefined}
          />
          <MetricCard
            title="Kunlik suhbat vaqti"
            value={formatDurationReadable(m.averageDailyCallDuration)}
            subtitle={`Kunlik o'rtacha ${m.averageDailyCalls ?? 0} qo'ng'iroq`}
            badge={getDailyTalkBadge(m.averageDailyCallDuration, (m.totalCalls ?? 0) > 0)}
          />
          <MetricCard
            title="Lid javob vaqti"
            value={formatResponseTime(m.leadResponseTime?.avgResponseSeconds ?? 0)}
            subtitle={`Median: ${formatResponseTime(m.leadResponseTime?.medianResponseSeconds ?? 0)} | ${m.leadResponseTime?.respondedCount ?? 0}/${m.leadResponseTime?.totalCount ?? 0} lid`}
            badge={getResponseTimeBadge(m.leadResponseTime?.avgResponseSeconds ?? 0)}
          />
        </div>
      </div>

      {/* Sales Breakdown */}
      <div>
        <SectionHeading>Sotuv ko'rsatkichlari</SectionHeading>
        <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Sotuv shartnomasi"
            value={salesCount}
            subtitle={`Kelishuv - ${formatAmount(m.newSalesAgreementAmount)}`}
            extra={`Tushum - ${formatAmount(m.incomeAmount)}`}
          />
          <MetricCard
            title="Sotuv - Onlayn"
            value={m.onlineSalesCount ?? 0}
            subtitle={`Kelishuv - ${formatAmount(m.onlineSalesAgreementAmount)}`}
            extra={`Tushum - ${formatAmount(m.onlineSalesIncomeAmount)}`}
          />
          <MetricCard
            title="Sotuv - Oflayn"
            value={m.offlineSalesCount ?? 0}
            subtitle={`Kelishuv - ${formatAmount(m.offlineSalesAgreementAmount)}`}
            extra={`Tushum - ${formatAmount(m.offlineSalesIncomeAmount)}`}
          />
          <MetricCard
            title="Sotuv - Intensiv"
            value={m.intensiveSalesCount ?? 0}
            subtitle={`Kelishuv - ${formatAmount(m.intensiveSalesAgreementAmount)}`}
            extra={`Tushum - ${formatAmount(m.intensiveSalesIncomeAmount)}`}
          />
        </div>
      </div>

      {/* Calls & Activity */}
      <div>
        <SectionHeading>Qo'ng'iroqlar va faollik</SectionHeading>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <MetricCard
            title="Jami qo'ng'iroqlar"
            value={m.totalCalls ?? 0}
            subtitle={`Davomiylik - ${formatDuration(m.totalCallDuration)}`}
          />
          <MetricCard
            title="Chiquvchi qo'ng'iroqlar"
            value={`${m.outboundCalls ?? 0} (${outboundRate !== null ? outboundRate.toFixed(0) + '%' : '-'})`}
            subtitle="Proaktiv qo'ng'iroqlar"
            badge={outboundRate !== null ? getOutboundBadge(m.outboundCalls ?? 0, m.totalCalls ?? 0) : undefined}
          />
          <MetricCard
            title="Kiruvchi qo'ng'iroqlar"
            value={`${m.inboundCalls ?? 0} (${inboundRate !== null ? inboundRate.toFixed(0) + '%' : '-'})`}
            subtitle="Qabul qilingan qo'ng'iroqlar"
          />
          <MetricCard
            title="O'tkazib yuborilgan"
            value={`${m.missedCalls ?? 0} (${formatPercent(m.missedCallRate)})`}
            subtitle="Javobsiz qo'ng'iroqlar"
            badge={getMissedCallBadge(m.missedCallRate)}
          />
          <MetricCard
            title="O'rtacha davomiylik"
            value={formatDuration(m.averageCallDuration)}
            subtitle="Har bir qo'ng'iroq uchun"
          />
        </div>
      </div>

      {/* CRM Activity */}
      <div>
        <SectionHeading>CRM faoliyat</SectionHeading>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <MetricCard title="Bajarilgan follow-up" value={m.followUpCount ?? 0} subtitle="Yakunlangan vazifalar" />
          <MetricCard title="Bugungi follow-up" value={m.todayFollowUpCount ?? 0} subtitle="Bugun uchun vazifalar" />
          <MetricCard
            title="Muddati o'tgan"
            value={m.overdueFollowUpCount ?? 0}
            subtitle="Kechikkan follow-up lar"
            badge={(m.overdueFollowUpCount ?? 0) > 5 ? 'critical' : (m.overdueFollowUpCount ?? 0) > 0 ? 'warning' : 'good'}
          />
          <MetricCard title="Yozuvlar" value={m.noteCount ?? 0} subtitle="CRM izohlari" />
          <MetricCard title="Bosqich o'zgarishi" value={m.stageChangeCount ?? 0} subtitle="Bosqich almashuvlari" />
        </div>
      </div>

      {/* Lead Metrics */}
      <div>
        <SectionHeading>Lid ko'rsatkichlari</SectionHeading>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <MetricCard title="Faol lidlar" value={m.activeLeads ?? 0} subtitle="Hozirgi faol lidlar" />
          <MetricCard title="Yangi lidlar" value={m.newLeadsInRange ?? 0} subtitle="Filtr davridagi yangi lidlar" />
          <MetricCard title="Yutilgan lidlar" value={m.wonLeads ?? 0} subtitle="Muvaffaqiyatli sotuvlar" />
          <MetricCard title="Yo'qotilgan lidlar" value={m.lostLeads ?? 0} subtitle="Yo'qotilgan imkoniyatlar" />
          <MetricCard
            title="Konversiya"
            value={formatPercent(m.conversionRate)}
            subtitle={`Yangi lidlar: ${m.newLeadsInRange ?? 0} -> Sotuvlar: ${salesCount}`}
            badge={getConversionBadge(m.conversionRate)}
          />
        </div>
      </div>

      {/* Financial KPIs */}
      <div>
        <SectionHeading>Moliyaviy ko'rsatkichlar</SectionHeading>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            title="Qarz yig'ish darajasi"
            value={formatPercent(m.debtCollectionRate)}
            subtitle={`${formatAmount(m.totalPaidAmount)} / ${formatAmount(m.totalAgreementAmount)}`}
            badge={getDebtCollectionBadge(m.debtCollectionRate)}
          />
          <MetricCard
            title="Qaytarish darajasi"
            value={formatPercent(m.refundRate)}
            subtitle={`${m.refundCount ?? 0} ta qaytarish / ${salesCount} sotuv`}
            badge={getRefundBadge(m.refundRate)}
          />
          <MetricCard
            title="To'lov muddati"
            value={formatPercent(m.deadlineAdherenceRate)}
            subtitle={`${m.deadlineMet ?? 0} / ${m.deadlineTotal ?? 0} o'z vaqtida`}
            badge={getDeadlineBadge(m.deadlineAdherenceRate)}
          />
          <MetricCard
            title="Yangi vs Qayta mijozlar"
            value={`${m.newCustomers ?? 0} / ${m.repeatCustomers ?? 0}`}
            subtitle={`Yangi mijoz: ${formatPercent(m.newCustomerRate)}`}
          />
        </div>
      </div>
    </div>
  );
}
