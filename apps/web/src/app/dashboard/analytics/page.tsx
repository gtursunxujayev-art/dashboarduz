'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconBrandMeta,
  IconCash,
  IconClick,
  IconFileAnalytics,
  IconPercentage,
  IconReceipt,
  IconSparkles,
  IconUserPlus,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import AnalyticsCharts from '@/components/dashboard/analytics-charts';
import LoadingBlock from '@/components/dashboard/loading-block';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { useDashboardAiPageContext } from '@/contexts/dashboard-ai-context';
import { getRangeLabel, getTashkentToday } from '@/lib/date-range';
import { type AiFocus, type ReportRangePreset as DashboardRange } from '@dashboarduz/shared';

const RANGE_OPTIONS: DashboardRange[] = ['today', 'week', 'month', 'custom'];
const AI_FOCUS_OPTIONS: Array<{ value: AiFocus; label: string }> = [
  { value: 'sales', label: 'Sales' },
  { value: 'lead_quality', label: 'Lead quality' },
  { value: 'meta_targeting', label: 'Meta targeting' },
  { value: 'agents', label: 'Agents' },
  { value: 'courses', label: 'Courses' },
];

export default function AnalyticsPage() {
  const [range, setRange] = useState<DashboardRange>('today');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [aiFocus, setAiFocus] = useState<AiFocus>('sales');
  const [aiResult, setAiResult] = useState<any>(null);

  const summaryQuery = trpc.dashboard.summary.useQuery(
    {
      range,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
    },
    {
      retry: 1,
      refetchInterval: 5 * 60 * 1000,
    },
  );
  const metaInsightsQuery = trpc.analyticsAi.metaInsights.useQuery(
    {
      range,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
    },
    {
      retry: 1,
      refetchInterval: 10 * 60 * 1000,
    },
  );
  const generateAi = trpc.analyticsAi.generateSuggestions.useMutation({
    onSuccess: (data) => setAiResult(data),
  });
  const summary = summaryQuery.data?.summary;

  const runAi = () => {
    generateAi.mutate({
      range,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
      focus: aiFocus,
    });
  };

  const metaCampaigns = (metaInsightsQuery.data?.campaigns || []) as Array<{
    campaignId?: string | null;
    campaignName?: string | null;
    spend: number;
    clicks: number;
    impressions: number;
    leads: number;
    ctr: number;
    cpl: number | null;
    attribution?: string;
  }>;
  const metaTotalSpend = metaCampaigns.reduce((total, row) => total + Number(row.spend || 0), 0);
  const metaTotalClicks = metaCampaigns.reduce((total, row) => total + Number(row.clicks || 0), 0);
  const metaTotalImpressions = metaCampaigns.reduce((total, row) => total + Number(row.impressions || 0), 0);
  const metaTotalLeads = metaCampaigns.reduce((total, row) => total + Number(row.leads || 0), 0);
  const metaWeightedCtr = metaTotalImpressions > 0
    ? Number(((metaTotalClicks / metaTotalImpressions) * 100).toFixed(2))
    : 0;
  const metaBlendedCpl = metaTotalLeads > 0
    ? Number((metaTotalSpend / metaTotalLeads).toFixed(2))
    : null;
  const metaWeakCampaigns = metaCampaigns.filter((row) => Number(row.spend || 0) > 0 && Number(row.leads || 0) === 0);

  const aiPageContext = useMemo(() => ({
    pageKey: '/dashboard/analytics',
    rangeMode: range,
    dateFrom: range === 'custom' ? dateFrom : undefined,
    dateTo: range === 'custom' ? dateTo : undefined,
    filters: {
      aiFocus,
    },
    metrics: {
      totalLeads: summary?.totalLeads ?? 0,
      qualifiedLeads: summary?.qualifiedLeads ?? 0,
      nonQualifiedLeads: summary?.nonQualifiedLeads ?? 0,
      newSalesCount: summary?.newSalesCount ?? 0,
      conversionPercent: summary?.conversionPercent ?? 0,
      newSalesAgreementAmount: summary?.newSalesAgreementAmount ?? 0,
      totalIncomeAmount: summary?.totalIncomeAmount ?? 0,
      followUpCount: summary?.followUpCount ?? 0,
      stageChangeCount: summary?.stageChangeCount ?? 0,
      metaCampaignCount: metaCampaigns.length,
      metaSpend: metaTotalSpend,
      metaLeads: metaTotalLeads,
      metaWeightedCtr: metaWeightedCtr,
    },
  }), [
    range,
    dateFrom,
    dateTo,
    aiFocus,
    summary?.totalLeads,
    summary?.qualifiedLeads,
    summary?.nonQualifiedLeads,
    summary?.newSalesCount,
    summary?.conversionPercent,
    summary?.newSalesAgreementAmount,
    summary?.totalIncomeAmount,
    summary?.followUpCount,
    summary?.stageChangeCount,
    metaCampaigns.length,
    metaTotalSpend,
    metaTotalLeads,
    metaWeightedCtr,
  ]);
  useDashboardAiPageContext(aiPageContext);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tahlil"
        description={<>Lid va manba bo&apos;yicha tahlillar.</>}
        actions={(
          <Link
            href="/dashboard/analytics/reports"
            className="btn btn-secondary"
          >
            <IconFileAnalytics className="h-4 w-4" stroke={1.8} aria-hidden="true" />
            Hisobotlar &rarr;
          </Link>
        )}
      >
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
          <div className="max-w-full overflow-x-auto">
            <div className="segmented">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  aria-pressed={range === option}
                  className={`segmented-item ${range === option ? 'segmented-item-active' : ''}`}
                >
                  {getRangeLabel(option)}
                </button>
              ))}
            </div>
          </div>

          {range === 'custom' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:items-center">
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="field md:w-44"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="field md:w-44"
              />
            </div>
          )}
        </div>
      </PageHeader>

      <AnalyticsCharts
        data={summaryQuery.data as any}
        isLoading={summaryQuery.isLoading}
        isError={Boolean(summaryQuery.error)}
      />

      <section className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
            <IconBrandMeta className="h-5 w-5" stroke={1.6} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="section-title">Meta Ads</h2>
            <p className="mt-0.5 text-sm text-gray-500">Campaign/adset/ad bo&apos;yicha spend, CTR, CPL va CPQL.</p>
          </div>
        </div>

        {metaCampaigns.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Jami spend" value={Math.round(metaTotalSpend).toLocaleString('uz-UZ')} icon={IconCash} tone="blue" />
            <StatTile label="Jami clicks" value={metaTotalClicks.toLocaleString('uz-UZ')} icon={IconClick} />
            <StatTile label="Weighted CTR" value={`${metaWeightedCtr}%`} icon={IconPercentage} />
            <StatTile label="Jami leads" value={metaTotalLeads.toLocaleString('uz-UZ')} icon={IconUserPlus} tone="green" />
            <StatTile
              label="Blended CPL"
              value={metaBlendedCpl === null ? '-' : Math.round(metaBlendedCpl).toLocaleString('uz-UZ')}
              icon={IconReceipt}
            />
          </div>
        )}
        {metaWeakCampaigns.length > 0 && (
          <div className="alert alert-warning flex items-start gap-3">
            <IconAlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" stroke={1.8} aria-hidden="true" />
            <p>
              Yuqori spend, lekin leads 0 bo'lgan kampaniyalar: {metaWeakCampaigns.slice(0, 5).map((item) => item.campaignName || 'Nomaʼlum').join(', ')}
              {metaWeakCampaigns.length > 5 ? ` va yana ${metaWeakCampaigns.length - 5} ta` : ''}.
            </p>
          </div>
        )}

        <div className="panel p-2 sm:p-3">
          {metaInsightsQuery.isLoading ? (
            <LoadingBlock compact message="Meta ma'lumotlari yuklanmoqda..." />
          ) : metaInsightsQuery.error ? (
            <div className="alert alert-error">
              Meta Ads ma&apos;lumotlarini yuklashda xatolik: {metaInsightsQuery.error.message}
            </div>
          ) : (metaInsightsQuery.data?.campaigns || []).length === 0 ? (
            <EmptyState
              icon={IconBrandMeta}
              title={
                (metaInsightsQuery.data as any)?.tableMissing
                  ? 'Meta Ads DB migratsiyasi hali production database ga qo‘llanmagan. db:migrate:deploy qiling.'
                  : 'Bu davr uchun Meta Ads ma&apos;lumotlari topilmadi. Integratsiyani ulang va sync qiling.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left">Campaign</th>
                    <th className="text-right">Spend</th>
                    <th className="text-right">Clicks</th>
                    <th className="text-right">CTR</th>
                    <th className="text-right">Leads</th>
                    <th className="text-right">CPL</th>
                    <th className="text-left">Attribution</th>
                  </tr>
                </thead>
                <tbody>
                  {(metaInsightsQuery.data?.campaigns || []).map((campaign: any) => (
                    <tr key={campaign.campaignId || campaign.campaignName}>
                      <td className="font-medium text-gray-900">{campaign.campaignName}</td>
                      <td className="tabular text-right">{Math.round(campaign.spend).toLocaleString()}</td>
                      <td className="tabular text-right">{campaign.clicks.toLocaleString()}</td>
                      <td className="tabular text-right">{campaign.ctr}%</td>
                      <td className="tabular text-right">
                        <span className={campaign.leads > 0 ? 'font-medium text-gray-900' : 'text-amber-700'}>{campaign.leads.toLocaleString()}</span>
                      </td>
                      <td className="tabular text-right">{campaign.cpl === null ? '-' : Math.round(campaign.cpl).toLocaleString()}</td>
                      <td>
                        {campaign.attribution ? <span className="badge badge-neutral">{campaign.attribution}</span> : campaign.attribution}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <div className="panel overflow-hidden">
        <div className="panel-header pb-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
              <IconSparkles className="h-5 w-5" stroke={1.6} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="section-title">AI yordamchi</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                CRM, tushum, qo&apos;ng&apos;iroq va Meta Ads metrikalari asosida amaliy tavsiyalar.
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <select
              value={aiFocus}
              onChange={(event) => setAiFocus(event.target.value as AiFocus)}
              className="field sm:w-48"
            >
              {AI_FOCUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={runAi}
              disabled={generateAi.isLoading}
              className="btn btn-primary"
            >
              <IconSparkles className="h-4 w-4" stroke={1.8} aria-hidden="true" />
              {generateAi.isLoading ? 'Tahlil qilinmoqda...' : 'Tahlil qilish'}
            </button>
          </div>
        </div>
        <div className="space-y-4 border-t border-gray-100 p-5 sm:p-6">
          {generateAi.error && (
            <div className="alert alert-error">
              AI tahlilda xatolik: {generateAi.error.message}
            </div>
          )}

          {aiResult?.result ? (
            <div className="space-y-4">
              <div className="alert alert-info">
                <p className="text-[13px] font-semibold">
                  Umumiy tashxis {aiResult.usedAi ? '' : '(local fallback)'}
                </p>
                <p className="mt-1.5 text-sm text-gray-800">{aiResult.result.summary}</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {(aiResult.result.top_findings || []).slice(0, 6).map((finding: any, index: number) => (
                  <div key={`${finding.title}-${index}`} className="panel-inset flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{finding.title}</h3>
                      <span className="badge badge-neutral">
                        {finding.severity}
                      </span>
                    </div>
                    <p className="mt-3 text-xs font-semibold text-gray-500">Evidence</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-gray-700">
                      {(finding.evidence || []).map((item: string) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <p className="mt-3 text-xs font-semibold text-gray-500">Action</p>
                    <p className="mt-1 text-sm text-gray-800">{finding.recommended_action}</p>
                    <p className="mt-auto pt-3 text-xs text-gray-500">Confidence: {finding.confidence}</p>
                  </div>
                ))}
              </div>

              {Array.isArray(aiResult.result.data_gaps) && aiResult.result.data_gaps.length > 0 && (
                <div className="alert alert-warning">
                  <p className="font-semibold">Data gaps</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4">
                    {aiResult.result.data_gaps.map((gap: string) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Focus tanlang va “Tahlil qilish” tugmasini bosing. AI faqat agregatsiya qilingan metrikalarni ko&apos;radi.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
