'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import AnalyticsCharts from '@/components/dashboard/analytics-charts';
import { useDashboardAiPageContext } from '@/contexts/dashboard-ai-context';

type DashboardRange = 'today' | 'week' | 'month' | 'custom';
type AiFocus = 'sales' | 'lead_quality' | 'meta_targeting' | 'agents' | 'courses';
const RANGE_OPTIONS: DashboardRange[] = ['today', 'week', 'month', 'custom'];
const AI_FOCUS_OPTIONS: Array<{ value: AiFocus; label: string }> = [
  { value: 'sales', label: 'Sales' },
  { value: 'lead_quality', label: 'Lead quality' },
  { value: 'meta_targeting', label: 'Meta targeting' },
  { value: 'agents', label: 'Agents' },
  { value: 'courses', label: 'Courses' },
];

function getTashkentToday(): string {
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

function getRangeLabel(range: DashboardRange): string {
  if (range === 'week') return 'Hafta';
  if (range === 'month') return 'Oy';
  if (range === 'custom') return 'Ixtiyoriy';
  return 'Bugun';
}

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
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Tahlil</h1>
        <p className="mt-1 text-sm text-gray-500">Lid va manba bo&apos;yicha tahlillar.</p>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="px-4 py-5 sm:p-6">
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <div className="inline-flex min-w-max rounded-md shadow-sm">
                {RANGE_OPTIONS.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRange(option)}
                    className={`border border-gray-300 px-4 py-2 text-sm font-medium ${
                      range === option ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    } ${index === 0 ? 'rounded-l-md' : ''} ${
                      index === RANGE_OPTIONS.length - 1 ? 'rounded-r-md' : ''
                    } ${index !== 0 ? 'border-l-0' : ''}`}
                  >
                    {getRangeLabel(option)}
                  </button>
                ))}
              </div>
            </div>

            {range === 'custom' && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-200 px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">AI yordamchi</h2>
              <p className="text-sm text-gray-500">
                CRM, tushum, qo&apos;ng&apos;iroq va Meta Ads metrikalari asosida amaliy tavsiyalar.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={aiFocus}
                onChange={(event) => setAiFocus(event.target.value as AiFocus)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generateAi.isLoading ? 'Tahlil qilinmoqda...' : 'Tahlil qilish'}
              </button>
            </div>
          </div>
        </div>
        <div className="space-y-4 px-4 py-5 sm:p-6">
          {generateAi.error && (
            <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
              AI tahlilda xatolik: {generateAi.error.message}
            </div>
          )}

          {aiResult?.result ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Umumiy tashxis {aiResult.usedAi ? '' : '(local fallback)'}
                </p>
                <p className="mt-2 text-sm text-blue-950">{aiResult.result.summary}</p>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                {(aiResult.result.top_findings || []).slice(0, 6).map((finding: any, index: number) => (
                  <div key={`${finding.title}-${index}`} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{finding.title}</h3>
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
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
                    <p className="mt-3 text-xs text-gray-500">Confidence: {finding.confidence}</p>
                  </div>
                ))}
              </div>

              {Array.isArray(aiResult.result.data_gaps) && aiResult.result.data_gaps.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-semibold text-amber-900">Data gaps</p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-amber-900">
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

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-200 px-4 py-4 sm:px-6">
          <h2 className="text-lg font-semibold text-gray-900">Meta Ads</h2>
          <p className="text-sm text-gray-500">Campaign/adset/ad bo&apos;yicha spend, CTR, CPL va CPQL.</p>
        </div>
        <div className="overflow-x-auto px-4 py-5 sm:p-6">
          {metaCampaigns.length > 0 && (
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Jami spend</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">{Math.round(metaTotalSpend).toLocaleString('uz-UZ')}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Jami clicks</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">{metaTotalClicks.toLocaleString('uz-UZ')}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Weighted CTR</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">{metaWeightedCtr}%</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Jami leads</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">{metaTotalLeads.toLocaleString('uz-UZ')}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Blended CPL</p>
                <p className="mt-1 text-lg font-semibold text-gray-900">
                  {metaBlendedCpl === null ? '-' : Math.round(metaBlendedCpl).toLocaleString('uz-UZ')}
                </p>
              </div>
            </div>
          )}
          {metaWeakCampaigns.length > 0 && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Yuqori spend, lekin leads 0 bo'lgan kampaniyalar: {metaWeakCampaigns.slice(0, 5).map((item) => item.campaignName || 'Nomaʼlum').join(', ')}
              {metaWeakCampaigns.length > 5 ? ` va yana ${metaWeakCampaigns.length - 5} ta` : ''}.
            </div>
          )}
          {metaInsightsQuery.isLoading ? (
            <p className="text-sm text-gray-500">Meta ma&apos;lumotlari yuklanmoqda...</p>
          ) : metaInsightsQuery.error ? (
            <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
              Meta Ads ma&apos;lumotlarini yuklashda xatolik: {metaInsightsQuery.error.message}
            </div>
          ) : (metaInsightsQuery.data?.campaigns || []).length === 0 ? (
            <p className="text-sm text-gray-500">
              {(metaInsightsQuery.data as any)?.tableMissing
                ? 'Meta Ads DB migratsiyasi hali production database ga qo‘llanmagan. db:migrate:deploy qiling.'
                : 'Bu davr uchun Meta Ads ma&apos;lumotlari topilmadi. Integratsiyani ulang va sync qiling.'}
            </p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Campaign</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Spend</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Clicks</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">CTR</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">Leads</th>
                  <th className="px-3 py-2 text-right font-semibold text-gray-600">CPL</th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-600">Attribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(metaInsightsQuery.data?.campaigns || []).map((campaign: any) => (
                  <tr key={campaign.campaignId || campaign.campaignName}>
                    <td className="px-3 py-2 text-gray-900">{campaign.campaignName}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{Math.round(campaign.spend).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{campaign.clicks.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{campaign.ctr}%</td>
                    <td className="px-3 py-2 text-right text-gray-700">{campaign.leads.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{campaign.cpl === null ? '-' : Math.round(campaign.cpl).toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-700">{campaign.attribution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <AnalyticsCharts
        data={summaryQuery.data as any}
        isLoading={summaryQuery.isLoading}
        isError={Boolean(summaryQuery.error)}
      />
    </div>
  );
}
