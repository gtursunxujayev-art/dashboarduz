'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { IconCalendar, IconInfoCircle } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { FilterPill, pillControlClass } from '@/components/dashboard/filter-pill';
import { FunnelCrmBanner, FunnelStageBars, FunnelTable, LostRevenueTable } from '@/components/dashboard/funnel-tables';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { getTashkentToday } from '@/lib/date-range';
import {
  FILTERS_STORAGE_KEY,
  GROUP_OPTIONS,
  RANGE_OPTIONS,
  LEGACY_TAKLIF_STAGE_KEY,
  buildFunnelQueryInput,
  parseStageRef,
  parseStoredFilters,
  serializeFilters,
  serializeStageRef,
  stagePipelines,
  type FunnelFilters,
  type FunnelGroup,
  type FunnelStageRef,
} from './funnel-view';

function RefreshSpinner() {
  return (
    <span
      role="status"
      aria-label="Yangilanmoqda"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600"
    />
  );
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be blocked; the filters then just aren't remembered.
  }
}

export default function FunnelPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const showMoney = !(roles.includes('Tashkiliy') && !roles.some((role: string) => ['Admin', 'Manager', 'TeamLeader', 'Finance'].includes(role)));

  const [filters, setFilters] = useState<FunnelFilters>(() => ({
    range: 'month',
    dateFrom: getTashkentToday(),
    dateTo: getTashkentToday(),
    group: 'all',
    pipelineId: null,
    taklif: null,
  }));
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [planError, setPlanError] = useState('');
  const [tableTab, setTableTab] = useState<'funnel' | 'lost'>('funnel');
  const { range, dateFrom, dateTo, group, pipelineId, taklif } = filters;

  const utils = trpc.useContext();
  const stageOptionsQuery = trpc.funnel.stageOptions.useQuery(undefined, { staleTime: 10 * 60 * 1000 });
  const pipelines = useMemo(() => stageOptionsQuery.data?.pipelines ?? [], [stageOptionsQuery.data]);
  const stageChoices = useMemo(() => stagePipelines(pipelines, pipelineId), [pipelines, pipelineId]);

  // Restore saved filters once the funnel list is known (needed to validate funnel/stage ids).
  useEffect(() => {
    if (filtersHydrated || stageOptionsQuery.isLoading) return;
    setFilters((current) => parseStoredFilters(
      readStorage(FILTERS_STORAGE_KEY),
      {
        ...current,
        // Stage saved by the first version of this page, before all filters were saved together.
        taklif: parseStageRef(readStorage(LEGACY_TAKLIF_STAGE_KEY)),
      },
      pipelines,
    ));
    setFiltersHydrated(true);
  }, [filtersHydrated, stageOptionsQuery.isLoading, pipelines]);

  useEffect(() => {
    if (filtersHydrated) writeStorage(FILTERS_STORAGE_KEY, serializeFilters(filters));
  }, [filtersHydrated, filters]);

  const updateFilters = (patch: Partial<FunnelFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const changePipeline = (value: string) => {
    const nextPipelineId = value || null;
    const keepStage = (ref: FunnelStageRef | null) => (!nextPipelineId || ref?.pipelineId === nextPipelineId ? ref : null);
    setFilters((current) => ({
      ...current,
      pipelineId: nextPipelineId,
      taklif: keepStage(current.taklif),
    }));
  };

  const customRangeInvalid = range === 'custom' && (!dateFrom || !dateTo || dateFrom > dateTo);
  const queryInput = useMemo(
    () => buildFunnelQueryInput({ range, dateFrom, dateTo, group, pipelineId, taklif, refreshKey }),
    [range, dateFrom, dateTo, group, pipelineId, taklif, refreshKey],
  );
  const summaryQuery = trpc.funnel.summary.useQuery(queryInput, {
    enabled: filtersHydrated && !customRangeInvalid,
    retry: 1,
    staleTime: 60 * 1000,
    keepPreviousData: true,
  });

  const setPlanMutation = trpc.funnel.setPlan.useMutation({
    onSuccess: () => {
      setPlanError('');
      void utils.funnel.summary.invalidate();
    },
    onError: (error) => setPlanError(error.message || "Rejani saqlab bo'lmadi."),
  });

  const data = summaryQuery.data;
  // Old results stay on screen while new filters load (keepPreviousData), so flag that they are stale.
  const isRefreshing = Boolean(data) && summaryQuery.isFetching;
  const leadsStatus = data?.sourceStatus.leads;
  const callsStatus = data?.sourceStatus.calls;
  const crmFailureReason = leadsStatus && !leadsStatus.ok
    ? (leadsStatus.reason || 'fetch_failed')
    : (callsStatus && !callsStatus.ok ? (callsStatus.reason || 'calls_fetch_failed') : null);

  const renderStageSelect = (kind: 'taklif', label: string, value: FunnelStageRef | null) => (
    <FilterPill label={label}>
      <select
        className={`${pillControlClass} max-w-[14rem]`}
        value={serializeStageRef(value)}
        onChange={(event) => updateFilters({ [kind]: parseStageRef(event.target.value) })}
        disabled={!pipelines.length}
      >
        <option value="">— Bosqichni tanlang —</option>
        {stageChoices.map((pipeline) => (
          <optgroup key={pipeline.id} label={pipeline.name}>
            {pipeline.statuses.map((status) => (
              <option key={status.id} value={serializeStageRef({ pipelineId: pipeline.id, statusId: status.id })}>
                {status.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </FilterPill>
  );

  const hasRows = Boolean(data && data.rows.length);
  const activeTable = showMoney ? tableTab : 'funnel';
  const rangeLabel = RANGE_OPTIONS.find((option) => option.value === range)?.label;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Voronka"
        description={<>Menejerlar bo&apos;yicha voronka va yo&apos;qotilgan tushum tahlili</>}
        actions={(
          <Link href="/dashboard/analytics" className="btn btn-ghost">← Tahlil</Link>
        )}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex max-w-full items-center gap-3 overflow-x-auto">
              <span className="text-[13px] font-medium text-gray-500">Davr</span>
              <div className="segmented">
                {RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateFilters({ range: option.value })}
                    aria-pressed={range === option.value}
                    className={`segmented-item ${range === option.value ? 'segmented-item-active' : ''}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {range === 'custom' && (
              <>
                <FilterPill icon={IconCalendar} label="Dan">
                  <input type="date" className={`${pillControlClass} w-[9.5rem] flex-none`} value={dateFrom} onChange={(event) => updateFilters({ dateFrom: event.target.value })} />
                </FilterPill>
                <FilterPill label="Gacha">
                  <input type="date" className={`${pillControlClass} w-[9.5rem] flex-none`} value={dateTo} onChange={(event) => updateFilters({ dateTo: event.target.value })} />
                </FilterPill>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterPill label="Guruh">
              <select className={`${pillControlClass} max-w-[10rem]`} value={group} onChange={(event) => updateFilters({ group: event.target.value as FunnelGroup })}>
                {GROUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </FilterPill>
            <FilterPill label="Voronka">
              <select
                className={`${pillControlClass} max-w-[14rem]`}
                value={pipelineId ?? ''}
                onChange={(event) => changePipeline(event.target.value)}
                disabled={!pipelines.length}
              >
                <option value="">Barcha voronkalar</option>
                {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
              </select>
            </FilterPill>
            {renderStageSelect('taklif', 'Taklif bosqich', taklif)}
          </div>
          {customRangeInvalid && <p className="field-error">Sanalar oralig&apos;ini to&apos;g&apos;ri tanlang.</p>}
          {stageOptionsQuery.isSuccess && !stageOptionsQuery.data.connected && (
            <p className="alert alert-warning">AmoCRM ulanmagan — bosqichlarni tanlab bo&apos;lmaydi.</p>
          )}
          <div className="flex items-start gap-2 text-sm text-gray-500">
            <IconInfoCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" stroke={1.8} aria-hidden="true" />
            <div className="space-y-1">
              <p>
                Ishlangan lid — davrda yaratilgan va kamida {data?.minAnsweredCallSeconds ?? 50} soniya gaplashilgan (amoCRM qo&apos;ng&apos;iroqlari) lidlar.
              </p>
              {!taklif && pipelines.length > 0 && (
                <p className="font-medium text-gray-600">Taklif ustuni uchun bosqichni tanlang.</p>
              )}
            </div>
          </div>
        </div>
      </PageHeader>

      {summaryQuery.error && (
        <div className="alert alert-error">
          Ma&apos;lumotni yuklab bo&apos;lmadi: {summaryQuery.error.message}
        </div>
      )}

      {data && (
        <FunnelCrmBanner
          reason={crmFailureReason}
          unmappedNames={data.unmappedManagerNames}
          onRetry={() => setRefreshKey((key) => key + 1)}
          isRetrying={summaryQuery.isFetching}
        />
      )}
      {planError && <p className="alert alert-error">{planError}</p>}

      {/* Hero: the team funnel */}
      <section className="panel" aria-label="Voronka">
        <div className="panel-header">
          <div className="flex min-w-0 items-center gap-2">
            {rangeLabel ? <p className="caption">{rangeLabel}</p> : null}
            {isRefreshing && <RefreshSpinner />}
          </div>
        </div>
        <div className="px-5 pb-7 pt-4 sm:px-8 sm:pb-9">
          {!data && summaryQuery.isLoading ? (
            <LoadingBlock message="Voronka ma'lumoti yuklanmoqda..." className="min-h-[320px]" />
          ) : data && hasRows ? (
            <div className={`transition-opacity ${isRefreshing ? 'opacity-50' : ''}`} aria-busy={isRefreshing}>
              <FunnelStageBars totals={data.totals} variant="hero" />
            </div>
          ) : data ? (
            <EmptyState title="Tanlangan guruhda menejer topilmadi." />
          ) : null}
        </div>
      </section>

      {data && hasRows && (
        <section className="panel">
          <div className="flex flex-wrap items-end justify-between gap-3 px-5 pt-3 sm:px-6">
            <div className="tabs min-w-0 flex-1 border-b-0" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTable === 'funnel'}
                onClick={() => setTableTab('funnel')}
                className={`tab text-[15px] font-semibold ${activeTable === 'funnel' ? 'tab-active' : ''}`}
              >
                Menejerlar voronkasi
              </button>
              {showMoney && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTable === 'lost'}
                  onClick={() => setTableTab('lost')}
                  className={`tab text-[15px] font-semibold ${activeTable === 'lost' ? 'tab-active' : ''}`}
                >
                  Yo&apos;qotilgan tushum
                </button>
              )}
            </div>
            {isRefreshing && <span className="pb-3"><RefreshSpinner /></span>}
          </div>
          <div className="border-t border-gray-200" />

          {activeTable === 'lost' ? (
            <div role="tabpanel" aria-label="Yo'qotilgan tushum">
              <p className="px-5 pt-4 text-sm text-gray-500 sm:px-6">
                Jamoa ko&apos;rsatkichlariga nisbatan har bir menejer qayerda ko&apos;proq tushum yo&apos;qotayotgani.
              </p>
              <div className="p-2 sm:p-3">
                <div className={`transition-opacity ${isRefreshing ? 'opacity-50' : ''}`} aria-busy={isRefreshing}>
                  <LostRevenueTable rows={data.lostRevenue.rows} totals={data.lostRevenue.totals} />
                </div>
              </div>
            </div>
          ) : (
            <div role="tabpanel" aria-label="Menejerlar voronkasi" className="p-2 sm:p-3">
              <div className={`transition-opacity ${isRefreshing ? 'opacity-50' : ''}`} aria-busy={isRefreshing}>
                <FunnelTable
                  rows={data.rows}
                  totals={data.totals}
                  canEditPlans={data.canEditPlans}
                  showMoney={showMoney}
                  onPlanChange={(userId, plan) => setPlanMutation.mutate({ userId, plan })}
                />
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
