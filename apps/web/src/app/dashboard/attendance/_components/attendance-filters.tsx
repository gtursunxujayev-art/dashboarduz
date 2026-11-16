'use client';

import type { AttendancePageModel } from './use-attendance-page';

export function AttendanceFilters({ vm }: { vm: AttendancePageModel }) {
  const { anomaliesOnly, dateFrom, dateTo, exportError, exportReportMutation, exportSuccess, handleExportReport, isAdmin, query, recomputeMutation, setAnomaliesOnly, setDateFrom, setDateTo, setQuery } = vm;

  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        <div className="space-y-1">
          <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Boshlanish</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Tugash</label>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Qidiruv</label>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ism, username yoki telefon"
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={anomaliesOnly}
              onChange={(event) => setAnomaliesOnly(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Faqat anomaliya
          </label>
        </div>
        <div className="flex flex-col justify-end gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => recomputeMutation.mutate({ dateFrom, dateTo })}
              disabled={recomputeMutation.isLoading}
              className="min-w-0 flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {recomputeMutation.isLoading ? 'Hisoblanmoqda...' : 'Qayta hisoblash'}
            </button>
          )}
          <button
            type="button"
            onClick={handleExportReport}
            disabled={exportReportMutation.isLoading}
            className="min-w-0 flex-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exportReportMutation.isLoading ? 'Yuklanmoqda...' : 'Davr hisobotini yuklab olish'}
          </button>
        </div>
      </div>
      {recomputeMutation.error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {recomputeMutation.error.message}
        </p>
      )}
      {exportError && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {exportError}
        </p>
      )}
      {exportSuccess && (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
          {exportSuccess}
        </p>
      )}
    </div>
  );
}
