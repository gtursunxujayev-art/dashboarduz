'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconArrowRight, IconFilter } from '@tabler/icons-react';
import type { ReportRangePreset as DashboardRange } from '@dashboarduz/shared';
import LoadingBlock from '@/components/dashboard/loading-block';
import { FunnelStageBars } from '@/components/dashboard/funnel-tables';
import { EmptyState } from '@/components/ui/empty-state';
import { FILTERS_STORAGE_KEY, parseStoredFilters, type FunnelFilters } from '@/app/dashboard/analytics/funnel/funnel-view';
import { getTashkentToday } from '@/lib/date-range';
import { trpc } from '@/lib/trpc';

type Props = {
  range: DashboardRange;
  dateFrom: string;
  dateTo: string;
};

function readSavedFilters(): string | null {
  try {
    return window.localStorage.getItem(FILTERS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function percent(part: number, whole: number): string {
  if (!whole) return '0%';
  return `${Number(((part / whole) * 100).toFixed(1)).toLocaleString('ru-RU')}%`;
}

/**
 * Funnel stages for the dashboard's selected period. The funnel, group and "Taklif" stage come from
 * the filters saved on the Voronka page, so both pages count the same leads.
 */
export default function DashboardFunnelOverview({ range, dateFrom, dateTo }: Props) {
  const stageOptionsQuery = trpc.funnel.stageOptions.useQuery(undefined, { staleTime: 10 * 60 * 1000 });
  const [saved, setSaved] = useState<FunnelFilters | null>(null);

  useEffect(() => {
    if (stageOptionsQuery.isLoading) return;
    const today = getTashkentToday();
    setSaved(parseStoredFilters(
      readSavedFilters(),
      { range: 'month', dateFrom: today, dateTo: today, group: 'all', pipelineId: null, taklif: null },
      stageOptionsQuery.data?.pipelines ?? [],
    ));
  }, [stageOptionsQuery.isLoading, stageOptionsQuery.data]);

  const input = useMemo(() => ({
    range,
    dateFrom: range === 'custom' ? dateFrom : undefined,
    dateTo: range === 'custom' ? dateTo : undefined,
    group: saved?.group ?? 'all',
    pipelineId: saved?.pipelineId ?? null,
    taklifStage: saved?.taklif ?? null,
  }), [range, dateFrom, dateTo, saved]);

  const summaryQuery = trpc.funnel.summary.useQuery(input, {
    enabled: saved !== null,
    retry: 1,
    staleTime: 60 * 1000,
    keepPreviousData: true,
    refetchOnWindowFocus: false,
  });

  const data = summaryQuery.data;
  const totals = data?.totals;
  const leadsUnavailable = data ? !data.sourceStatus.leads.ok : false;

  return (
    <section className="panel flex flex-col">
      <div className="panel-header">
        <h2 className="section-title">Voronka tahlili</h2>
        <Link
          href="/dashboard/analytics/funnel"
          className="inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Batafsil
          <IconArrowRight className="h-4 w-4" stroke={1.6} />
        </Link>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
        {(saved === null || summaryQuery.isLoading) && !data ? (
          <LoadingBlock message="Voronka ma'lumoti yuklanmoqda..." className="flex-1" />
        ) : summaryQuery.error ? (
          <p className="alert alert-error">Ma&apos;lumotni yuklab bo&apos;lmadi: {summaryQuery.error.message}</p>
        ) : totals && totals.assignedLeads > 0 ? (
          <>
            {leadsUnavailable ? (
              <p className="alert alert-warning">AmoCRM lid ma&apos;lumotlari to&apos;liq yuklanmadi.</p>
            ) : null}
            <div className={`transition-opacity ${summaryQuery.isFetching ? 'opacity-60' : ''}`}>
              <FunnelStageBars totals={totals} />
            </div>
            <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 text-[13px]">
              <div>
                <dt className="text-gray-500">Lid dan sotuvga</dt>
                <dd className="tabular mt-0.5 text-lg font-semibold text-gray-900">{percent(totals.sales, totals.assignedLeads)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Qo&apos;ng&apos;iroqlar</dt>
                <dd className="tabular mt-0.5 text-lg font-semibold text-gray-900">{totals.calls.toLocaleString('ru-RU')}</dd>
              </div>
            </dl>
          </>
        ) : (
          <EmptyState icon={IconFilter} title="Tanlangan davrda biriktirilgan lid yo'q." className="flex-1" />
        )}
      </div>
    </section>
  );
}
