'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import LoadingBlock from '@/components/dashboard/loading-block';
import { FunnelCrmBanner, FunnelTable, LostRevenueTable } from '@/components/dashboard/funnel-tables';
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

const inputClass = 'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100';

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
    <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
      {label}
      <select
        className={inputClass}
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
    </label>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard/analytics" className="text-sm text-blue-600 hover:underline">← Tahlil</Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">Voronka</h1>
          <p className="text-sm text-gray-500">Menejerlar bo&apos;yicha voronka va yo&apos;qotilgan tushum tahlili</p>
        </div>
      </div>

      <div className="rounded-lg bg-white p-4 shadow">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Davr</span>
            <div className="flex flex-wrap gap-1">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateFilters({ range: option.value })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${range === option.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {range === 'custom' && (
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                Dan
                <input type="date" className={inputClass} value={dateFrom} onChange={(event) => updateFilters({ dateFrom: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
                Gacha
                <input type="date" className={inputClass} value={dateTo} onChange={(event) => updateFilters({ dateTo: event.target.value })} />
              </label>
            </div>
          )}
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            Guruh
            <select className={inputClass} value={group} onChange={(event) => updateFilters({ group: event.target.value as FunnelGroup })}>
              {GROUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            Voronka
            <select
              className={inputClass}
              value={pipelineId ?? ''}
              onChange={(event) => changePipeline(event.target.value)}
              disabled={!pipelines.length}
            >
              <option value="">Barcha voronkalar</option>
              {pipelines.map((pipeline) => <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>)}
            </select>
          </label>
          {renderStageSelect('taklif', 'Taklif bosqich', taklif)}
        </div>
        {customRangeInvalid && <p className="mt-2 text-sm text-red-600">Sanalar oralig&apos;ini to&apos;g&apos;ri tanlang.</p>}
        {stageOptionsQuery.isSuccess && !stageOptionsQuery.data.connected && (
          <p className="mt-2 text-sm text-amber-700">AmoCRM ulanmagan — bosqichlarni tanlab bo&apos;lmaydi.</p>
        )}
        <p className="mt-2 text-sm text-gray-500">
          Ishlangan lid — davrda yaratilgan va kamida {data?.minAnsweredCallSeconds ?? 50} soniya gaplashilgan (amoCRM qo&apos;ng&apos;iroqlari) lidlar.
        </p>
        {!taklif && pipelines.length > 0 && (
          <p className="mt-1 text-sm text-gray-500">Taklif ustuni uchun bosqichni tanlang.</p>
        )}
      </div>

      {summaryQuery.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Ma&apos;lumotni yuklab bo&apos;lmadi: {summaryQuery.error.message}
        </div>
      )}

      <div className="rounded-lg bg-white shadow">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-medium text-gray-900">
            Menejerlar voronkasi
            {isRefreshing && <RefreshSpinner />}
          </h3>
          {data && (
            <FunnelCrmBanner
              reason={crmFailureReason}
              unmappedNames={data.unmappedManagerNames}
              onRetry={() => setRefreshKey((key) => key + 1)}
              isRetrying={summaryQuery.isFetching}
            />
          )}
          {planError && <p className="mb-3 text-sm text-red-600">{planError}</p>}
          {!data && summaryQuery.isLoading ? (
            <LoadingBlock message="Voronka ma'lumoti yuklanmoqda..." />
          ) : data && data.rows.length ? (
            <div className={`transition-opacity ${isRefreshing ? 'opacity-50' : ''}`} aria-busy={isRefreshing}>
              <FunnelTable
                rows={data.rows}
                totals={data.totals}
                canEditPlans={data.canEditPlans}
                showMoney={showMoney}
                onPlanChange={(userId, plan) => setPlanMutation.mutate({ userId, plan })}
              />
            </div>
          ) : data ? (
            <p className="text-sm text-gray-600">Tanlangan guruhda menejer topilmadi.</p>
          ) : null}
        </div>
      </div>

      {showMoney && data && data.rows.length > 0 && (
        <div className="rounded-lg bg-white shadow">
          <div className="px-4 py-5 sm:p-6">
            <h3 className="flex items-center gap-2 text-lg font-medium text-gray-900">
              Yo&apos;qotilgan tushum
              {isRefreshing && <RefreshSpinner />}
            </h3>
            <p className="mb-4 mt-1 text-sm text-gray-500">
              Jamoa ko&apos;rsatkichlariga nisbatan har bir menejer qayerda ko&apos;proq tushum yo&apos;qotayotgani.
            </p>
            <div className={`transition-opacity ${isRefreshing ? 'opacity-50' : ''}`} aria-busy={isRefreshing}>
              <LostRevenueTable rows={data.lostRevenue.rows} totals={data.lostRevenue.totals} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
