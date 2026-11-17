'use client';

import {
  IconAlertTriangle,
  IconCash,
  IconClock,
  IconFileText,
  IconPercentage,
  IconShoppingCart,
  IconUsers,
} from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { formatDurationClock, formatPercent, formatSomUz } from '@/lib/format';
import { StatTile } from '@/components/ui/stat-tile';
import { SplitBar, sharePercent } from '@/components/ui/split-bar';
import { UserAvatar } from '@/components/ui/user-avatar';
import { type ReportRangePreset as DashboardRange } from '@dashboarduz/shared';


type SellerPerformanceRow = {
  userId: string;
  name: string;
  newLeads: number | null;
  qualifiedLeads: number | null;
  sales: number;
  conversionPercent: number | null;
  agreementsAmount: number;
  incomeAmount: number;
  talkedSeconds: number | null;
  callsCount: number;
  followUpCount: number;
  noteCount: number;
  stageChangeCount: number;
  overdueFollowUpCount: number;
  todayFollowUpCount: number;
};

type DashboardSummaryResponse = {
  range: DashboardRange;
  sourceStatus?: {
    amoContext?: { ok: boolean; retried: boolean; reason: string | null };
    catalog?: { ok: boolean; retried: boolean; reason: string | null };
    leads?: { ok: boolean; retried: boolean; reason: string | null };
    activity?: { ok: boolean; retried: boolean; reason: string | null };
    corporateCalls?: { ok: boolean; retried: boolean; reason: string | null };
  };
  summary: {
    totalLeads: number;
    qualifiedLeads: number;
    nonQualifiedLeads: number;
    totalCalls: number;
    totalIncomeAmount: number;
    newSalesCount: number;
    newSalesAgreementAmount: number;
    onlineSalesCount: number;
    onlineSalesAgreementAmount: number;
    onlineSalesIncomeAmount: number;
    offlineSalesCount: number;
    offlineSalesAgreementAmount: number;
    offlineSalesIncomeAmount: number;
    intensiveSalesCount: number;
    intensiveSalesAgreementAmount: number;
    intensiveSalesIncomeAmount: number;
    conversionPercent: number;
    followUpCount: number;
    stageChangeCount: number;
    overdueFollowUpCount: number;
    todayFollowUpCount: number;
  };
  sellerPerformance: SellerPerformanceRow[];
  updatedAt: string;
};

interface AnalyticsChartsProps {
  data?: DashboardSummaryResponse;
  isLoading?: boolean;
  isError?: boolean;
}

function barWidth(value: number, max: number): string {
  if (!max || max <= 0 || value <= 0) return '0%';
  return `${Math.max(2, Math.min(100, (value / max) * 100))}%`;
}

/** A bar with no track: only the measured part is drawn. */
function InlineBar({ value, max, className }: { value: number; max: number; className: string }) {
  return (
    <div className="h-2 w-full" aria-hidden="true">
      <div className={`h-full origin-left animate-grow-x rounded-full ${className}`} style={{ width: barWidth(value, max) }} />
    </div>
  );
}

function CategoryColumn({
  title,
  salesCount,
  agreement,
  income,
  max,
}: {
  title: string;
  salesCount: number;
  agreement: number;
  income: number;
  max: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4 px-5 py-5 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <span className="badge badge-neutral">{title}</span>
        <IconShoppingCart className="h-4 w-4 text-gray-400" stroke={1.8} aria-hidden="true" />
      </div>
      <p className="tabular text-[34px] font-semibold leading-none tracking-[-0.02em] text-gray-900">{salesCount}</p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-sm text-gray-500">Kelishuv: <span className="tabular font-medium text-gray-900">{formatSomUz(agreement)}</span></p>
          <InlineBar value={agreement} max={max} className="bg-gray-300" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm text-gray-500">Tushum: <span className="tabular font-medium text-blue-700">{formatSomUz(income)}</span></p>
          <InlineBar value={income} max={max} className="bg-blue-600" />
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, valueClassName = 'text-gray-900' }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-gray-500">{label}</p>
      <p className={`tabular mt-1 break-words text-lg font-semibold leading-tight tracking-tight ${valueClassName}`}>{value}</p>
    </div>
  );
}

export default function AnalyticsCharts({
  data,
  isLoading = false,
  isError = false,
}: AnalyticsChartsProps) {
  const sourceStatus = data?.sourceStatus || {};
  const sourceLabelMap: Record<string, string> = {
    amoContext: 'AmoCRM ulanishi',
    catalog: 'AmoCRM katalog maydonlari',
    leads: 'AmoCRM lidlari',
    activity: 'AmoCRM activity',
    corporateCalls: "Korporativ qo'ng'iroqlar",
  };
  const degradedSources = Object.entries(sourceStatus)
    .filter(([, value]) => value && value.ok === false)
    .map(([key, value]) => ({
      key,
      label: sourceLabelMap[key] || key,
      reason: value?.reason || 'unknown',
      retried: Boolean(value?.retried),
    }));

  const rows = data?.sellerPerformance || [];
  const teamTalkSeconds = rows.reduce((total, row) => total + (row.talkedSeconds || 0), 0);
  const teamCalls = rows.reduce((total, row) => total + (row.callsCount || 0), 0);
  const teamFollowUp = rows.reduce((total, row) => total + (row.followUpCount || 0), 0);
  const teamOverdue = rows.reduce((total, row) => total + (row.overdueFollowUpCount || 0), 0);
  const teamTodayQueue = rows.reduce((total, row) => total + (row.todayFollowUpCount || 0), 0);

  const summary = data?.summary;
  const totalLeads = summary?.totalLeads || 0;
  const qualifiedLeads = summary?.qualifiedLeads || 0;
  const nonQualifiedLeads = summary?.nonQualifiedLeads || 0;
  const categories = [
    {
      title: 'Online',
      salesCount: summary?.onlineSalesCount || 0,
      agreement: summary?.onlineSalesAgreementAmount || 0,
      income: summary?.onlineSalesIncomeAmount || 0,
    },
    {
      title: 'Offline',
      salesCount: summary?.offlineSalesCount || 0,
      agreement: summary?.offlineSalesAgreementAmount || 0,
      income: summary?.offlineSalesIncomeAmount || 0,
    },
    {
      title: 'Intensiv',
      salesCount: summary?.intensiveSalesCount || 0,
      agreement: summary?.intensiveSalesAgreementAmount || 0,
      income: summary?.intensiveSalesIncomeAmount || 0,
    },
  ];
  const categoryMax = Math.max(0, ...categories.flatMap((category) => [category.agreement, category.income]));
  const followUpMax = Math.max(teamOverdue, teamTodayQueue);

  return (
    <div className="space-y-6">
      {isError && !data && (
        <div className="alert alert-error">
          Boshqaruv tahlillarini yuklashda xatolik yuz berdi.
        </div>
      )}

      {degradedSources.length > 0 && (
        <div className="alert alert-warning flex items-start gap-3">
          <IconAlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" stroke={1.8} aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium">Ba'zi tashqi manbalar vaqtincha ishlamadi. Asosiy DB ma'lumotlari ko'rsatildi.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {degradedSources.map((source) => (
                <span key={source.key} className="badge bg-white text-amber-800 ring-1 ring-amber-200">
                  {source.label} ({source.reason}{source.retried ? ', retry' : ''})
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {isLoading && <LoadingBlock message="Tahlillar yuklanmoqda..." />}

      {/* KPI band */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Yangi sotuvlar" value={(summary?.newSalesCount || 0).toLocaleString('uz-UZ')} icon={IconShoppingCart} />
        <StatTile label="Konversiya" value={formatPercent(summary?.conversionPercent, 2)} icon={IconPercentage} />
        <StatTile label="Kelishuv summasi" value={formatSomUz(summary?.newSalesAgreementAmount || 0)} icon={IconFileText} tone="blue" />
        <StatTile label="Tushum" value={formatSomUz(summary?.totalIncomeAmount || 0)} icon={IconCash} tone="green" />
      </div>

      {/* Bento: one wide chart, two half-width ones */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="panel lg:col-span-2">
          <div className="panel-header">
            <div className="min-w-0">
              <p className="caption">Online / Offline / Intensiv</p>
              <h3 className="section-title mt-1">Sotuv turlari</h3>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500" aria-hidden="true">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-gray-300" />Kelishuv</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-600" />Tushum</span>
            </div>
          </div>
          <div className="grid grid-cols-1 divide-y divide-gray-100 pb-1 md:grid-cols-3 md:divide-x md:divide-y-0">
            {categories.map((category) => (
              <CategoryColumn
                key={category.title}
                title={category.title}
                salesCount={category.salesCount}
                agreement={category.agreement}
                income={category.income}
                max={categoryMax}
              />
            ))}
          </div>
        </section>

        <section className="panel flex flex-col">
          <div className="panel-header">
            <div className="min-w-0">
              <p className="caption">Jami lidlar</p>
              <p className="tabular mt-2 text-[34px] font-semibold leading-none tracking-[-0.02em] text-gray-900">
                {totalLeads.toLocaleString('uz-UZ')}
              </p>
            </div>
          </div>
          <div className="panel-body flex flex-1 flex-col gap-5">
            <SplitBar first={qualifiedLeads} second={nonQualifiedLeads} className="h-2.5" />
            <dl className="grid grid-cols-2 gap-4">
              <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-[13px] text-gray-500">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full bg-blue-600" aria-hidden="true" />
                  Sifatli lidlar
                </dt>
                <dd className="mt-1 flex items-baseline gap-2">
                  <span className="tabular text-lg font-semibold text-gray-900">{qualifiedLeads.toLocaleString('uz-UZ')}</span>
                  <span className="tabular text-xs text-gray-500">{sharePercent(qualifiedLeads, qualifiedLeads + nonQualifiedLeads)}</span>
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-[13px] text-gray-500">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full bg-gray-300" aria-hidden="true" />
                  Sifatsiz lidlar
                </dt>
                <dd className="mt-1 flex items-baseline gap-2">
                  <span className="tabular text-lg font-semibold text-gray-900">{nonQualifiedLeads.toLocaleString('uz-UZ')}</span>
                  <span className="tabular text-xs text-gray-500">{sharePercent(nonQualifiedLeads, qualifiedLeads + nonQualifiedLeads)}</span>
                </dd>
              </div>
            </dl>
            <div className="mt-auto grid grid-cols-2 gap-4 border-t border-gray-100 pt-4">
              <MiniStat label="Follow-up" value={(summary?.followUpCount || 0).toLocaleString('uz-UZ')} />
              <MiniStat label="Bosqich o'zgarishi" value={(summary?.stageChangeCount || 0).toLocaleString('uz-UZ')} />
            </div>
          </div>
        </section>

        <section className="panel flex flex-col">
          <div className="panel-header">
            <div className="min-w-0">
              <h3 className="section-title flex items-center gap-2">
                <IconUsers className="h-4 w-4 text-gray-400" stroke={1.8} aria-hidden="true" />
                Sotuv jamoasi overview
              </h3>
              <p className="mt-1 text-xs text-gray-500">Jami follow-up: <span className="tabular font-medium text-gray-700">{teamFollowUp.toLocaleString('uz-UZ')}</span></p>
            </div>
          </div>
          <div className="panel-body flex flex-1 flex-col gap-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MiniStat label="Faol xodimlar" value={rows.length.toLocaleString('uz-UZ')} />
              <MiniStat label="Jami qo'ng'iroqlar" value={teamCalls.toLocaleString('uz-UZ')} />
              <MiniStat label="Jami suhbat vaqti" value={formatDurationClock(teamTalkSeconds, '-')} />
            </div>
            <div className="mt-auto space-y-4 border-t border-gray-100 pt-4">
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-gray-500">Muddati o'tgan follow-up</span>
                  <span className={`tabular text-base font-semibold ${teamOverdue > 0 ? 'text-red-600' : 'text-gray-900'}`}>{teamOverdue.toLocaleString('uz-UZ')}</span>
                </div>
                <InlineBar value={teamOverdue} max={followUpMax} className="bg-red-500" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="text-gray-500">Bugungi/navbatdagi follow-up</span>
                  <span className="tabular text-base font-semibold text-gray-900">{teamTodayQueue.toLocaleString('uz-UZ')}</span>
                </div>
                <InlineBar value={teamTodayQueue} max={followUpMax} className="bg-blue-600" />
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header pb-1">
          <div className="flex items-center gap-2">
            <h3 className="section-title">Agent performance</h3>
            <span className="badge badge-neutral tabular">{rows.length}</span>
          </div>
        </div>
        <div className="overflow-x-auto p-2 sm:p-3">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left">Agent</th>
                <th className="text-right">Yangi lid</th>
                <th className="text-right">Sifatli lid</th>
                <th className="text-right">Sotuv</th>
                <th className="text-right">Konversiya</th>
                <th className="text-right">Kelishuv</th>
                <th className="text-right">Tushum</th>
                <th className="text-right">Qo'ng'iroq</th>
                <th className="text-right">Suhbat vaqti</th>
                <th className="text-right">Follow-up</th>
                <th className="text-right">Bosqich o'zgarishi</th>
                <th className="text-right">Muddati o'tgan</th>
                <th className="text-right">Bugungi/navbatdagi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <UserAvatar name={row.name} size="sm" />
                      <span className="whitespace-nowrap font-medium text-gray-900">{row.name}</span>
                    </div>
                  </td>
                  <td className="tabular text-right">{row.newLeads ?? '-'}</td>
                  <td className="tabular text-right">{row.qualifiedLeads ?? '-'}</td>
                  <td className="tabular text-right font-medium text-gray-900">{row.sales.toLocaleString('uz-UZ')}</td>
                  <td className="tabular text-right">{formatPercent(row.conversionPercent, 2)}</td>
                  <td className="tabular whitespace-nowrap text-right">{formatSomUz(row.agreementsAmount)}</td>
                  <td className="tabular whitespace-nowrap text-right font-medium text-blue-700">{formatSomUz(row.incomeAmount)}</td>
                  <td className="tabular text-right">{row.callsCount.toLocaleString('uz-UZ')}</td>
                  <td className="tabular text-right">{formatDurationClock(row.talkedSeconds, '-')}</td>
                  <td className="tabular text-right">{row.followUpCount.toLocaleString('uz-UZ')}</td>
                  <td className="tabular text-right">{row.stageChangeCount.toLocaleString('uz-UZ')}</td>
                  <td className="tabular text-right">
                    {row.overdueFollowUpCount > 0 ? (
                      <span className="badge badge-red tabular">{row.overdueFollowUpCount.toLocaleString('uz-UZ')}</span>
                    ) : row.overdueFollowUpCount.toLocaleString('uz-UZ')}
                  </td>
                  <td className="tabular text-right">{row.todayFollowUpCount.toLocaleString('uz-UZ')}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-10 text-center text-gray-500">
                    Tanlangan davr uchun agent ma'lumotlari topilmadi.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
        <IconClock className="h-3.5 w-3.5" stroke={1.8} aria-hidden="true" />
        <span>Ma'lumot yangilangan vaqt: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString('uz-UZ') : 'Mavjud emas'}</span>
      </p>
    </div>
  );
}
