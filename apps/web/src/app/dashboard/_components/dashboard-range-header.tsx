'use client';

import { AmoLeadSnapshotRefresh } from '@/components/dashboard/amo-lead-snapshot-refresh';
import MultiSelectDropdown from '@/components/dashboard/multi-select-dropdown';
import { DateRangePill } from '@/components/ui/date-range-pill';
import { formatRangeBounds, getRangeBounds, getRangeLabel } from '@/lib/date-range';
import type { DashboardPageModel } from './use-dashboard-page';

const PRESETS = ['today', 'week', 'month'] as const;

export function DashboardRangeHeader({ vm }: { vm: DashboardPageModel }) {
  const { activeRangeQueryFetching, amoPipelinesQuery, dateFrom, dateTo, isAdmin, isFinanceOnly, pipelineIds, pipelineOptions, range, rangeTabsRef, setDateFrom, setDateTo, setPipelineIds, setRange } = vm;
  const bounds = getRangeBounds(range, { dateFrom, dateTo });

  return (
    <div className="flex w-full flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
      <div ref={rangeTabsRef} className="inline-flex h-10 w-full gap-1 rounded-full bg-white p-1 shadow md:w-auto" role="group" aria-label="Davr">
        {PRESETS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setRange(option)}
            aria-pressed={range === option}
            className={`h-8 flex-1 rounded-full px-5 text-sm font-medium active:scale-[0.98] md:flex-none ${
              range === option ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            {getRangeLabel(option)}
          </button>
        ))}
      </div>

      <DateRangePill
        label={formatRangeBounds(bounds)}
        active={range === 'custom'}
        dateFrom={bounds.dateFrom}
        dateTo={bounds.dateTo}
        onApply={(next) => {
          setDateFrom(next.dateFrom);
          setDateTo(next.dateTo);
          setRange('custom');
        }}
      />

      {activeRangeQueryFetching ? (
        <span className="inline-flex items-center gap-2 text-[13px] text-gray-500" role="status">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" aria-hidden="true" />
          Yangilanmoqda
        </span>
      ) : null}

      {!isFinanceOnly ? <AmoLeadSnapshotRefresh isAdmin={isAdmin} /> : null}

      {!isFinanceOnly && isAdmin && (
        <div className="w-full md:w-[240px]">
          <MultiSelectDropdown
            label="Pipeline filtri"
            hideLabel
            options={pipelineOptions}
            selectedIds={pipelineIds}
            onChange={setPipelineIds}
            placeholder="Pipeline tanlang"
            disabled={amoPipelinesQuery.isLoading}
          />
        </div>
      )}
    </div>
  );
}
