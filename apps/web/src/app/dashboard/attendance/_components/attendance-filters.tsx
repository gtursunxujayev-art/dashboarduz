'use client';

import { IconAlertTriangle, IconCalendar, IconFileSpreadsheet, IconRefresh, IconSearch } from '@tabler/icons-react';
import { FilterPill, pillControlClass } from '@/components/dashboard/filter-pill';
import type { AttendancePageModel } from './use-attendance-page';

/** Page-level actions (recompute, period export), rendered in the PageHeader. */
export function AttendanceHeaderActions({ vm }: { vm: AttendancePageModel }) {
  const { dateFrom, dateTo, exportReportMutation, handleExportReport, isAdmin, recomputeMutation } = vm;

  return (
    <>
      {isAdmin && (
        <button
          type="button"
          onClick={() => recomputeMutation.mutate({ dateFrom, dateTo })}
          disabled={recomputeMutation.isLoading}
          className="btn btn-secondary"
        >
          <IconRefresh className={`h-4 w-4 ${recomputeMutation.isLoading ? 'animate-spin' : ''}`} stroke={1.8} />
          {recomputeMutation.isLoading ? 'Hisoblanmoqda...' : 'Qayta hisoblash'}
        </button>
      )}
      <button
        type="button"
        onClick={handleExportReport}
        disabled={exportReportMutation.isLoading}
        className="btn btn-primary"
      >
        <IconFileSpreadsheet className="h-4 w-4" stroke={1.8} />
        {exportReportMutation.isLoading ? 'Yuklanmoqda...' : 'Davr hisobotini yuklab olish'}
      </button>
    </>
  );
}

/** The period, search and anomaly filters, rendered as one pill toolbar under the PageHeader title. */
export function AttendanceFilters({ vm }: { vm: AttendancePageModel }) {
  const { anomaliesOnly, dateFrom, dateTo, query, setAnomaliesOnly, setDateFrom, setDateTo, setQuery } = vm;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterPill icon={IconCalendar} label="Boshlanish">
        <input
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
          className={`${pillControlClass} w-[9.5rem] flex-none`}
        />
      </FilterPill>
      <FilterPill label="Tugash">
        <input
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
          className={`${pillControlClass} w-[9.5rem] flex-none`}
        />
      </FilterPill>
      <FilterPill icon={IconSearch} label="Qidiruv" className="w-full sm:w-auto sm:min-w-[18rem] sm:flex-1 lg:max-w-md">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ism, username yoki telefon"
          className={pillControlClass}
        />
      </FilterPill>
      <label
        className={`inline-flex h-10 flex-none cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-medium shadow ${
          anomaliesOnly ? 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200' : 'bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        <input
          type="checkbox"
          checked={anomaliesOnly}
          onChange={(event) => setAnomaliesOnly(event.target.checked)}
          className="checkbox"
        />
        <IconAlertTriangle className="h-4 w-4" stroke={1.8} />
        Faqat anomaliya
      </label>
    </div>
  );
}

/** Messages from the recompute and export actions. */
export function AttendanceAlerts({ vm }: { vm: AttendancePageModel }) {
  const { exportError, exportSuccess, recomputeMutation } = vm;
  if (!recomputeMutation.error && !exportError && !exportSuccess) return null;

  return (
    <div className="space-y-3">
      {recomputeMutation.error && (
        <p className="alert alert-error">
          {recomputeMutation.error.message}
        </p>
      )}
      {exportError && (
        <p className="alert alert-error">
          {exportError}
        </p>
      )}
      {exportSuccess && (
        <p className="alert alert-success">
          {exportSuccess}
        </p>
      )}
    </div>
  );
}
