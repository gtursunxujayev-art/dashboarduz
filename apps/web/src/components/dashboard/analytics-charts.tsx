'use client';

import { IconAlertTriangle, IconClock, IconShoppingCart, IconUsers } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { formatDurationClock, formatPercent, formatSomUz } from '@/lib/format';
import { KpiCard } from '@/components/dashboard/kpi-card';
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

function CategoryCard({
  title,
  salesCount,
  agreement,
  income,
}: {
  title: string;
  salesCount: number;
  agreement: number;
  income: number;
}) {
  return (
    <div className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="badge badge-neutral">{title}</span>
        <IconShoppingCart className="h-4 w-4 text-gray-400" stroke={1.8} aria-hidden="true" />
      </div>
      <p className="tabular mt-3 text-3xl font-semibold tracking-tight text-gray-900">{salesCount}</p>
      <div className="mt-4 space-y-1.5 border-t border-gray-100 pt-3">
        <p className="text-sm text-gray-500">Kelishuv: <span className="tabular font-medium text-gray-900">{formatSomUz(agreement)}</span></p>
        <p className="text-sm text-gray-500">Tushum: <span className="tabular font-medium text-blue-700">{formatSomUz(income)}</span></p>
      </div>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Jami lidlar" value={(data?.summary.totalLeads || 0).toLocaleString('uz-UZ')} />
        <KpiCard label="Sifatli lidlar" value={(data?.summary.qualifiedLeads || 0).toLocaleString('uz-UZ')} />
        <KpiCard label="Sifatsiz lidlar" value={(data?.summary.nonQualifiedLeads || 0).toLocaleString('uz-UZ')} />
        <KpiCard label="Yangi sotuvlar" value={(data?.summary.newSalesCount || 0).toLocaleString('uz-UZ')} />
        <KpiCard label="Konversiya" value={formatPercent(data?.summary.conversionPercent, 2)} />
        <KpiCard label="Kelishuv summasi" value={formatSomUz(data?.summary.newSalesAgreementAmount || 0)} accent />
        <KpiCard label="Tushum" value={formatSomUz(data?.summary.totalIncomeAmount || 0)} accent />
        <KpiCard label="Follow-up" value={(data?.summary.followUpCount || 0).toLocaleString('uz-UZ')} />
        <KpiCard label="Bosqich o'zgarishi" value={(data?.summary.stageChangeCount || 0).toLocaleString('uz-UZ')} />
      </div>

      <div className="panel grid grid-cols-1 divide-y divide-gray-100 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        <CategoryCard
          title="Online"
          salesCount={data?.summary.onlineSalesCount || 0}
          agreement={data?.summary.onlineSalesAgreementAmount || 0}
          income={data?.summary.onlineSalesIncomeAmount || 0}
        />
        <CategoryCard
          title="Offline"
          salesCount={data?.summary.offlineSalesCount || 0}
          agreement={data?.summary.offlineSalesAgreementAmount || 0}
          income={data?.summary.offlineSalesIncomeAmount || 0}
        />
        <CategoryCard
          title="Intensiv"
          salesCount={data?.summary.intensiveSalesCount || 0}
          agreement={data?.summary.intensiveSalesAgreementAmount || 0}
          income={data?.summary.intensiveSalesIncomeAmount || 0}
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="section-title flex items-center gap-2">
            <IconUsers className="h-4 w-4 text-gray-400" stroke={1.8} aria-hidden="true" />
            Sotuv jamoasi overview
          </h3>
          <p className="text-xs text-gray-500">Jami follow-up: <span className="tabular font-medium text-gray-700">{teamFollowUp.toLocaleString('uz-UZ')}</span></p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Faol xodimlar" value={rows.length.toLocaleString('uz-UZ')} />
          <KpiCard label="Jami qo'ng'iroqlar" value={teamCalls.toLocaleString('uz-UZ')} />
          <KpiCard label="Jami suhbat vaqti" value={formatDurationClock(teamTalkSeconds, '-')} />
          <KpiCard label="Muddati o'tgan follow-up" value={teamOverdue.toLocaleString('uz-UZ')} />
          <KpiCard label="Bugungi/navbatdagi follow-up" value={teamTodayQueue.toLocaleString('uz-UZ')} />
        </div>
      </section>

      <div className="panel">
        <div className="panel-header">
          <h3 className="section-title">Agent performance</h3>
          <span className="badge badge-neutral tabular">{rows.length}</span>
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
                  <td className={`tabular text-right ${row.overdueFollowUpCount > 0 ? 'font-medium text-red-600' : ''}`}>{row.overdueFollowUpCount.toLocaleString('uz-UZ')}</td>
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
      </div>

      <p className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
        <IconClock className="h-3.5 w-3.5" stroke={1.8} aria-hidden="true" />
        <span>Ma'lumot yangilangan vaqt: {data?.updatedAt ? new Date(data.updatedAt).toLocaleString('uz-UZ') : 'Mavjud emas'}</span>
      </p>
    </div>
  );
}
