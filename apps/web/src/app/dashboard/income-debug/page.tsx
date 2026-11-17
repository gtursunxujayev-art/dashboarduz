'use client';

import { useMemo, useState } from 'react';
import {
  IconAlertTriangle,
  IconCalendarDue,
  IconCalendarRepeat,
  IconEye,
  IconEyeOff,
  IconFileImport,
  IconFilter,
  IconLink,
  IconListSearch,
  IconMoodEmpty,
  IconRefresh,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { formatDateTime, formatSomUz } from '@/lib/format';

const MODE_OPTIONS = [
  { value: 'suspicious', label: 'Shubhali qatorlar' },
  { value: 'future', label: 'Kelajak sanali tushumlar' },
  { value: 'unresolved', label: 'Audit topilmagan' },
  { value: 'relink', label: 'Relink ehtimoli' },
  { value: 'imported', label: 'Import qatorlari' },
  { value: 'hidden', label: 'Yashirilgan qatorlar' },
  { value: 'all', label: 'Barcha qatorlar' },
] as const;

const STATUS_TONES: Record<string, string> = {
  future: 'badge-amber',
  possible_relink: 'badge-blue',
  imported: 'badge-neutral',
  unresolved: 'badge-red',
};

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

  const appliedModeLabel = MODE_OPTIONS.find((option) => option.value === applied.mode)?.label;
  const actionError = hideMutation.error?.message
    || repairMutation.error?.message
    || deleteIncomeMutation.error?.message
    || repairAllChainsMutation.error?.message;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tushum debug"
        description="Admin uchun kichik diagnostika sahifasi. Bu yerda kelajak sanali, importdan kelgan, audit topilmagan yoki relink orqali yaratilgan bo'lishi mumkin bo'lgan tushumlar ko'rinadi."
        actions={(
          <button
            type="button"
            disabled={repairAllChainsMutation.isLoading}
            onClick={handleRepairAllChains}
            className="btn btn-secondary"
          >
            <IconRefresh className="h-4 w-4" stroke={1.8} />
            Barcha aktiv chainni qayta hisoblash
          </button>
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as (typeof MODE_OPTIONS)[number]['value'])}
            aria-label="Rejim"
            className="field w-full rounded-full sm:w-[260px]"
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <div className="relative min-w-0 flex-1 basis-full sm:basis-64">
            <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Telefon yoki mijoz ismi"
              aria-label="Telefon yoki mijoz ismi"
              className="field rounded-full pl-10"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setApplied({ mode, query: query.trim(), limit: 200 });
              setSelectedIds([]);
            }}
            className="btn btn-primary w-full sm:w-auto"
          >
            <IconFilter className="h-4 w-4" stroke={1.8} />
            Ko'rsatish
          </button>
        </div>
      </PageHeader>

      {summary ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <StatTile
            label="Tekshirilgan qator"
            value={summary.inspectedCount}
            hint={<>Skan qilingan namuna: {summary.sampledCount}</>}
            icon={IconListSearch}
            tone="blue"
          />
          <StatTile label="Kelajak sanali" value={summary.futureCount} icon={IconCalendarDue} tone="amber" />
          <StatTile label="Import qatorlari" value={summary.importedCount} icon={IconFileImport} tone="neutral" />
          <StatTile label="Audit topilmagan" value={summary.unresolvedCount} icon={IconAlertTriangle} tone="red" />
          <StatTile label="Relink ehtimoli" value={summary.possibleRelinkCount} icon={IconLink} tone="amber" />
          <StatTile label="Yashirilgan" value={summary.hiddenCount} icon={IconEyeOff} tone="neutral" />
        </div>
      ) : null}

      {repairResults.length > 0 ? (
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-5 sm:px-6">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <IconCalendarRepeat className="h-[18px] w-[18px]" stroke={1.6} />
              </span>
              <div>
                <h2 className="section-title">
                  Oxirgi sana tiklash natijalari
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  O'tkazib yuborilgan qatorlar va sabablarini shu yerda ko'rasiz.
                </p>
              </div>
            </div>
            <span className="badge badge-neutral tabular">{repairResults.length}</span>
          </div>
          <div className="max-h-80 overflow-auto px-1 pb-2 sm:px-2">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="text-left">Mijoz</th>
                  <th className="text-left">Eski sana</th>
                  <th className="text-left">Yangi sana</th>
                  <th className="text-left">Holat</th>
                  <th className="text-left">Sabab</th>
                </tr>
              </thead>
              <tbody>
                {repairResults.map((row) => (
                  <tr key={`${row.incomeId ?? row.saleIncomeId}-${row.oldDate ?? 'none'}-${row.newDate ?? 'none'}`}>
                    <td>
                      <div className="tabular font-medium text-gray-900">{row.customerNumber || '-'}</div>
                      <div className="text-xs text-gray-500">{row.customerName}</div>
                    </td>
                    <td className="tabular whitespace-nowrap text-gray-600">{row.oldDate || '-'}</td>
                    <td className="tabular whitespace-nowrap">{row.newDate || '-'}</td>
                    <td className="whitespace-nowrap">
                      <span className={`badge ${
                        row.status === 'updated' || row.status === 'fixed'
                          ? 'badge-green'
                          : row.status === 'unchanged'
                            ? 'badge-neutral'
                            : 'badge-amber'
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
                    <td className="text-xs text-gray-500">{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-4 pt-5 sm:px-6">
          <div className="flex items-center gap-2">
            <h2 className="section-title">{appliedModeLabel}</h2>
            {!debugQuery.isLoading ? <span className="badge badge-neutral tabular">{rows.length}</span> : null}
          </div>
        </div>

        {/* Bulk action bar: lights up once rows are selected. */}
        <div
          className={`mx-3 flex flex-wrap items-center gap-2 rounded-[16px] px-3 py-2 transition-colors sm:mx-4 ${
            selectedIds.length ? 'bg-blue-50' : 'bg-gray-50'
          }`}
        >
          <div className="mr-auto px-2 text-sm text-gray-500">
            Tanlangan: <span className="tabular font-semibold text-gray-900">{selectedIds.length}</span>
          </div>
          {applied.mode !== 'hidden' ? (
            <button
              type="button"
              disabled={!selectedIds.length || hideMutation.isLoading}
              onClick={() => handleHide(true)}
              className="btn btn-warning-soft btn-sm"
            >
              <IconEyeOff className="h-4 w-4" stroke={1.8} />
              Tanlanganlarni yashirish
            </button>
          ) : (
            <button
              type="button"
              disabled={!selectedIds.length || hideMutation.isLoading}
              onClick={() => handleHide(false)}
              className="btn btn-soft btn-sm"
            >
              <IconEye className="h-4 w-4" stroke={1.8} />
              Tanlanganlarni qayta ko'rsatish
            </button>
          )}
          <button
            type="button"
            disabled={!selectedIds.length || repairMutation.isLoading}
            onClick={handleRepairDates}
            className="btn btn-soft btn-sm"
          >
            <IconCalendarRepeat className="h-4 w-4" stroke={1.8} />
            Snapshotdan sanani tiklash
          </button>
          <button
            type="button"
            disabled={!selectedIds.length || deleteIncomeMutation.isLoading}
            onClick={handleDelete}
            className="btn btn-danger-soft btn-sm"
          >
            <IconTrash className="h-4 w-4" stroke={1.8} />
            Tanlanganlarni o'chirish
          </button>
        </div>

        {actionError ? (
          <div className="alert alert-error mx-3 mt-3 py-2 sm:mx-4">
            {actionError}
          </div>
        ) : null}

        <div className="mt-2 px-1 pb-2 sm:px-2">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="checkbox" />
                  </th>
                  <th className="text-left">Sana</th>
                  <th className="text-left">Yaratilgan</th>
                  <th className="text-left">Mijoz</th>
                  <th className="text-left">Menedjer</th>
                  <th className="text-left">Kiritgan</th>
                  <th className="text-left">Tur</th>
                  <th className="text-left">Kurs/Tarif</th>
                  <th className="text-right">To'lov</th>
                  <th className="text-right">Qarz</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">Sabab</th>
                </tr>
              </thead>
              <tbody>
                {debugQuery.isLoading ? (
                  <tr>
                    <td colSpan={12}>
                      <LoadingBlock compact message="Yuklanmoqda..." />
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={12}>
                      <EmptyState title="Hech qanday qator topilmadi." icon={IconMoodEmpty} />
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const selected = selectedIds.includes(row.id);
                    return (
                      <tr key={row.id} className={`align-top ${selected ? 'bg-blue-50/60' : ''}`}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleRow(row.id)}
                            className="checkbox"
                          />
                        </td>
                        <td className="tabular whitespace-nowrap">{formatDateTime(row.entryDate, { locale: 'uz-UZ' }).slice(0, 10)}</td>
                        <td className="tabular whitespace-nowrap text-xs text-gray-500">{formatDateTime(row.createdAt, { locale: 'uz-UZ' })}</td>
                        <td>
                          <div className="tabular font-medium text-gray-900">{row.customerNumber}</div>
                          <div className="text-xs text-gray-500">{row.customerName}</div>
                        </td>
                        <td className="whitespace-nowrap">{row.managerName}</td>
                        <td className="whitespace-nowrap text-xs text-gray-500">{row.createdByLabel}</td>
                        <td className="whitespace-nowrap">
                          <span className={`badge ${row.type === 'new_sale' ? 'badge-blue' : 'badge-neutral'}`}>
                            {row.type === 'new_sale' ? 'Yangi sotuv' : 'Qarzdorlik'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-gray-700">{row.courseName} / {row.tariffName}</td>
                        <td className="tabular whitespace-nowrap text-right font-medium text-gray-900">{formatSomUz(row.paymentAmount)}</td>
                        <td className="tabular whitespace-nowrap text-right">{formatSomUz(row.remainingDebtAmount)}</td>
                        <td className="whitespace-nowrap">
                          <span className={`badge ${STATUS_TONES[row.status] || 'badge-neutral'}`}>
                            {statusLabel(row.status)}
                          </span>
                        </td>
                        <td className="min-w-[200px] space-y-0.5 text-xs text-gray-500">
                          <div>{row.reason}</div>
                          {row.legacyImportSource ? <div>Import: {row.legacyImportSource}</div> : null}
                          {row.historicalImportSessionId ? <div className="tabular">Session: {row.historicalImportSessionId.slice(0, 8)}</div> : null}
                          {row.relatedDebtIncomeId ? <div className="tabular">Debt link: {row.relatedDebtIncomeId.slice(0, 8)}</div> : null}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
