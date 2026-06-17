'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';

const MODE_OPTIONS = [
  { value: 'suspicious', label: 'Shubhali qatorlar' },
  { value: 'future', label: 'Kelajak sanali tushumlar' },
  { value: 'unresolved', label: 'Audit topilmagan' },
  { value: 'relink', label: 'Relink ehtimoli' },
  { value: 'imported', label: 'Import qatorlari' },
  { value: 'hidden', label: 'Yashirilgan qatorlar' },
  { value: 'all', label: 'Barcha qatorlar' },
] as const;

function formatDateTime(value: string | Date): string {
  const date = new Date(value);
  return date.toLocaleString('uz-UZ');
}

function formatMoney(value: number): string {
  return `${Math.round(value || 0).toLocaleString('uz-UZ')} so'm`;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'future':
      return 'Kelajak sana';
    case 'possible_relink':
      return 'Relink';
    case 'imported':
      return 'Import';
    case 'unresolved':
      return 'Audit yo\'q';
    default:
      return 'Oddiy';
  }
}

export default function IncomeDebugPage() {
  const [mode, setMode] = useState<(typeof MODE_OPTIONS)[number]['value']>('suspicious');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [repairResults, setRepairResults] = useState<Array<any>>([]);
  const [applied, setApplied] = useState({
    mode: 'suspicious' as (typeof MODE_OPTIONS)[number]['value'],
    query: '',
    limit: 200,
  });

  const debugQuery = trpc.incomeDebug.list.useQuery(applied, {
    retry: false,
    refetchOnWindowFocus: false,
  });
  const hideMutation = trpc.incomeDebug.hideSelected.useMutation();
  const repairMutation = trpc.incomeDebug.repairDatesFromSnapshot.useMutation();
  const repairAllChainsMutation = trpc.incomeDebug.repairAllActiveChains.useMutation();
  const deleteIncomeMutation = trpc.customerIncome.deleteIncome.useMutation();

  const rows = useMemo(() => (debugQuery.data?.rows ?? []) as Array<any>, [debugQuery.data]);
  const summary = debugQuery.data?.summary;
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));

  const toggleRow = (incomeId: string) => {
    setSelectedIds((prev) => (prev.includes(incomeId)
      ? prev.filter((id) => id !== incomeId)
      : [...prev, incomeId]));
  };

  const toggleAll = () => {
    setSelectedIds((prev) => (allSelected ? [] : rows.map((row) => row.id)));
  };

  const refreshList = async () => {
    setSelectedIds([]);
    await debugQuery.refetch();
  };

  const handleHide = async (hidden: boolean) => {
    if (!selectedIds.length) return;
    await hideMutation.mutateAsync({ incomeIds: selectedIds, hidden });
    await refreshList();
  };

  const handleDelete = async () => {
    if (!selectedIds.length) return;

    if (selectedIds.length > 1) {
      if (!window.confirm(`Siz ${selectedIds.length} ta tushumni o'chirmoqchisiz. Rostdan ham davom etasizmi?`)) return;
      if (!window.confirm('Bu amal qaytarilmaydi. Yana bir marta tasdiqlang.')) return;
      if (!window.confirm("Oxirgi tasdiq: tanlangan tushumlar butunlay o'chiriladi. Davom etilsinmi?")) return;
    } else {
      if (!window.confirm("Tanlangan tushumni o'chirishni tasdiqlaysizmi?")) return;
    }

    const deleteOrder = [...selectedIds].sort((leftId, rightId) => {
      const left = rows.find((row) => row.id === leftId);
      const right = rows.find((row) => row.id === rightId);
      const leftPriority = left?.type === 'repayment' ? 0 : 1;
      const rightPriority = right?.type === 'repayment' ? 0 : 1;
      return leftPriority - rightPriority;
    });

    for (const incomeId of deleteOrder) {
      await deleteIncomeMutation.mutateAsync({ incomeId });
    }
    await refreshList();
  };

  const handleRepairDates = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`Tanlangan ${selectedIds.length} ta qatorning sanasini faol snapshot orqali tiklaysizmi?`)) return;
    const result = await repairMutation.mutateAsync({ incomeIds: selectedIds });
    setRepairResults(result.results ?? []);
    await refreshList();
    window.alert(`Sana tiklash yakunlandi. Yangilandi: ${result.updatedCount}. O'tkazib yuborildi: ${result.skippedCount}.`);
  };

  const handleRepairAllChains = async () => {
    if (!window.confirm("Barcha aktiv sotuv chainlarini qayta hisoblashni boshlaysizmi?")) return;
    const result = await repairAllChainsMutation.mutateAsync({ limit: 5000 });
    setRepairResults(result.results ?? []);
    await refreshList();
    window.alert(`Chain qayta hisoblash yakunlandi. Tekshirildi: ${result.scannedCount}. Tuzatildi: ${result.fixedCount}. Xatolik: ${result.failedCount}.`);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Tushum debug</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Admin uchun kichik diagnostika sahifasi. Bu yerda kelajak sanali, importdan kelgan, audit topilmagan yoki relink orqali yaratilgan bo'lishi mumkin bo'lgan tushumlar ko'rinadi.
          </p>
        </div>

        <div className="space-y-5 p-6">
          <div className="rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr_auto]">
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as (typeof MODE_OPTIONS)[number]['value'])}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                {MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Telefon yoki mijoz ismi"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => {
                  setApplied({ mode, query: query.trim(), limit: 200 });
                  setSelectedIds([]);
                }}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Ko'rsatish
              </button>
            </div>
          </div>

          {summary ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <p className="text-xs text-gray-500">Tekshirilgan qator</p>
                <p className="mt-1 text-lg font-semibold">{summary.inspectedCount}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  Skan qilingan namuna: {summary.sampledCount}
                </p>
              </div>
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <p className="text-xs text-gray-500">Kelajak sanali</p>
                <p className="mt-1 text-lg font-semibold">{summary.futureCount}</p>
              </div>
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <p className="text-xs text-gray-500">Import qatorlari</p>
                <p className="mt-1 text-lg font-semibold">{summary.importedCount}</p>
              </div>
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <p className="text-xs text-gray-500">Audit topilmagan</p>
                <p className="mt-1 text-lg font-semibold">{summary.unresolvedCount}</p>
              </div>
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <p className="text-xs text-gray-500">Relink ehtimoli</p>
                <p className="mt-1 text-lg font-semibold">{summary.possibleRelinkCount}</p>
              </div>
              <div className="rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <p className="text-xs text-gray-500">Yashirilgan</p>
                <p className="mt-1 text-lg font-semibold">{summary.hiddenCount}</p>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 p-4 dark:border-slate-700">
            <div className="text-sm text-gray-500 dark:text-slate-400">
              Tanlangan: <span className="font-semibold text-gray-900 dark:text-slate-100">{selectedIds.length}</span>
            </div>
            {applied.mode !== 'hidden' ? (
              <button
                type="button"
                disabled={!selectedIds.length || hideMutation.isLoading}
                onClick={() => handleHide(true)}
                className="rounded-md border border-amber-300 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/20"
              >
                Tanlanganlarni yashirish
              </button>
            ) : (
              <button
                type="button"
                disabled={!selectedIds.length || hideMutation.isLoading}
                onClick={() => handleHide(false)}
                className="rounded-md border border-sky-300 px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/20"
              >
                Tanlanganlarni qayta ko'rsatish
              </button>
            )}
            <button
              type="button"
              disabled={!selectedIds.length || repairMutation.isLoading}
              onClick={handleRepairDates}
              className="rounded-md border border-emerald-300 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-950/20"
            >
              Snapshotdan sanani tiklash
            </button>
            <button
              type="button"
              disabled={!selectedIds.length || deleteIncomeMutation.isLoading}
              onClick={handleDelete}
              className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/20"
            >
              Tanlanganlarni o'chirish
            </button>
            <button
              type="button"
              disabled={repairAllChainsMutation.isLoading}
              onClick={handleRepairAllChains}
              className="rounded-md border border-violet-300 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-700 dark:text-violet-300 dark:hover:bg-violet-950/20"
            >
              Barcha aktiv chainni qayta hisoblash
            </button>
            {(hideMutation.error || repairMutation.error || deleteIncomeMutation.error || repairAllChainsMutation.error) ? (
              <div className="text-sm text-red-600 dark:text-red-400">
                {hideMutation.error?.message
                  || repairMutation.error?.message
                  || deleteIncomeMutation.error?.message
                  || repairAllChainsMutation.error?.message}
              </div>
            ) : null}
          </div>

          {repairResults.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700">
              <div className="border-b border-gray-200 px-4 py-3 dark:border-slate-700">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                  Oxirgi sana tiklash natijalari
                </h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  O'tkazib yuborilgan qatorlar va sabablarini shu yerda ko'rasiz.
                </p>
              </div>
              <div className="max-h-80 overflow-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
                  <thead className="bg-gray-50 dark:bg-slate-800/80">
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      <th className="px-4 py-3">Mijoz</th>
                      <th className="px-4 py-3">Eski sana</th>
                      <th className="px-4 py-3">Yangi sana</th>
                      <th className="px-4 py-3">Holat</th>
                      <th className="px-4 py-3">Sabab</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                    {repairResults.map((row) => (
                      <tr key={`${row.incomeId ?? row.saleIncomeId}-${row.oldDate ?? 'none'}-${row.newDate ?? 'none'}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-slate-100">{row.customerNumber || '-'}</div>
                          <div className="text-xs text-gray-500 dark:text-slate-400">{row.customerName}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{row.oldDate || '-'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{row.newDate || '-'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                            row.status === 'updated'
                              || row.status === 'fixed'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : row.status === 'unchanged'
                                ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}>
                            {row.status === 'updated'
                              ? 'Yangilandi'
                              : row.status === 'fixed'
                                ? 'Qayta hisoblandi'
                              : row.status === 'unchanged'
                                ? "To'g'ri edi"
                                : row.status === 'ambiguous'
                                  ? 'Noaniq moslik'
                                  : row.status === 'no_match'
                                    ? 'Mos qator topilmadi'
                                    : row.status === 'invalid_snapshot_date'
                                      ? 'Snapshot xato'
                                      : row.status === 'failed'
                                        ? 'Xatolik'
                                        : row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800/80">
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    <th className="px-4 py-3">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                    </th>
                    <th className="px-4 py-3">Sana</th>
                    <th className="px-4 py-3">Yaratilgan</th>
                    <th className="px-4 py-3">Mijoz</th>
                    <th className="px-4 py-3">Menedjer</th>
                    <th className="px-4 py-3">Kiritgan</th>
                    <th className="px-4 py-3">Tur</th>
                    <th className="px-4 py-3">Kurs/Tarif</th>
                    <th className="px-4 py-3">To'lov</th>
                    <th className="px-4 py-3">Qarz</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Sabab</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {debugQuery.isLoading ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-6">
                        <LoadingBlock compact message="Yuklanmoqda..." />
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-slate-400">
                        Hech qanday qator topilmadi.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id} className="align-top">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(row.id)}
                            onChange={() => toggleRow(row.id)}
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(row.entryDate).slice(0, 10)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-slate-400">{formatDateTime(row.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-slate-100">{row.customerNumber}</div>
                          <div className="text-xs text-gray-500 dark:text-slate-400">{row.customerName}</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{row.managerName}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-xs">{row.createdByLabel}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{row.type === 'new_sale' ? 'Yangi sotuv' : 'Qarzdorlik'}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{row.courseName} / {row.tariffName}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatMoney(row.paymentAmount)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatMoney(row.remainingDebtAmount)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                            {statusLabel(row.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                          <div>{row.reason}</div>
                          {row.legacyImportSource ? <div>Import: {row.legacyImportSource}</div> : null}
                          {row.historicalImportSessionId ? <div>Session: {row.historicalImportSessionId.slice(0, 8)}</div> : null}
                          {row.relatedDebtIncomeId ? <div>Debt link: {row.relatedDebtIncomeId.slice(0, 8)}</div> : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
