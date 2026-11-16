'use client';

import MultiSelectDropdown from '@/components/dashboard/multi-select-dropdown';
import { getRangeLabel } from '@/lib/date-range';
import { RANGE_OPTIONS } from './dashboard-helpers';
import type { DashboardPageModel } from './use-dashboard-page';

export function DashboardRangeHeader({ vm }: { vm: DashboardPageModel }) {
  const { activeRangeQueryFetching, amoPipelinesQuery, dateFrom, dateTo, estimatedRemainingSeconds, isAdmin, isFinanceOnly, pipelineIds, pipelineOptions, range, rangeLoadProgress, rangeLoadVisible, rangeTabsRef, rangeTabsWidth, setDateFrom, setDateTo, setPipelineIds, setRange } = vm;

  return (
    <div className="rounded-lg bg-white shadow">
      <div className="px-3 py-2 sm:px-5 sm:py-4">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-end">
          {false && rangeLoadVisible && (
            <div className="overflow-x-auto">
              <div
                className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2"
                style={rangeTabsWidth ? { width: `${rangeTabsWidth}px` } : undefined}
              >
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[11px] font-medium text-blue-700 sm:text-xs">
                    {activeRangeQueryFetching
                      ? `Yuklanmoqda: ${rangeLoadProgress}%`
                      : 'Yangilandi'}
                  </p>
                  {activeRangeQueryFetching && (
                    <p className="text-[11px] text-blue-600 sm:text-xs">
                      Taxminan {estimatedRemainingSeconds} soniya
                    </p>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-[width] duration-200 ease-out"
                    style={{ width: `${Math.max(0, Math.min(100, rangeLoadProgress))}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="shrink-0 overflow-x-auto">
            <div ref={rangeTabsRef} className="inline-flex min-w-max rounded-md shadow-sm">
              {RANGE_OPTIONS.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  className={`border border-gray-300 px-2.5 py-1 text-xs font-medium sm:px-3 sm:py-1.5 sm:text-sm ${
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

          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-[170px_170px_1fr]">
            <input
              type="date"
              value={dateFrom}
              disabled={range !== 'custom'}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 sm:px-3 sm:py-1.5 sm:text-sm"
            />
            <input
              type="date"
              value={dateTo}
              disabled={range !== 'custom'}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 sm:px-3 sm:py-1.5 sm:text-sm"
            />

            {!isFinanceOnly && isAdmin && (
              <MultiSelectDropdown
                label="Pipeline filtri"
                options={pipelineOptions}
                selectedIds={pipelineIds}
                onChange={setPipelineIds}
                placeholder="Pipeline tanlang"
                disabled={amoPipelinesQuery.isLoading}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
