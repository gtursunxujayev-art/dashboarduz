'use client';

import { IconAlertTriangle, IconCalendar, IconFileSpreadsheet, IconRefresh, IconSearch } from '@tabler/icons-react';
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

export function AttendanceFilters({ vm }: { vm: AttendancePageModel }) {
  const { anomaliesOnly, dateFrom, dateTo, exportError, exportSuccess, query, recomputeMutation, setAnomaliesOnly, setDateFrom, setDateTo, setQuery } = vm;

  return (
    <div className="space-y-3">
      <div className="panel p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-none">
            <div className="lg:w-44">
              <label className="field-label">Boshlanish</label>
              <div className="relative">
                <IconCalendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="field pl-9"
                />
              </div>
            </div>
            <div className="lg:w-44">
              <label className="field-label">Tugash</label>
              <div className="relative">
                <IconCalendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="field pl-9"
                />
              </div>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <label className="field-label">Qidiruv</label>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ism, username yoki telefon"
                className="field pl-9"
              />
            </div>
          </div>
          <label
            className={`inline-flex h-10 flex-none cursor-pointer items-center gap-2 rounded-[10px] border px-3 text-sm font-medium ${
              anomaliesOnly ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
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
      </div>
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
