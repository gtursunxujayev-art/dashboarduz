'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';
import {
  DEBTOR_EXPORT_COLUMN_WIDTHS,
  DEBTOR_EXPORT_HEADERS,
  REFUND_EXPORT_COLUMN_WIDTHS,
  REFUND_EXPORT_HEADERS,
  TARIFF_CHANGE_EXPORT_COLUMN_WIDTHS,
  TARIFF_CHANGE_EXPORT_HEADERS,
  buildDebtorExportRows,
  buildRefundExportRows,
  buildTariffChangeExportRows,
  formatCourseBundle,
  formatResponseDuration,
  formatTashkentDate,
  formatTashkentDateTime,
  getAdjustmentStatusLabel,
  getReportFilename,
  type AdjustmentReportRow,
  type DebtorReportRow,
  type ReportTab,
} from './reports-export';

type AdjustmentStatusFilter = '' | 'pending' | 'approved' | 'rejected';

const TAB_LABELS: Record<ReportTab, string> = {
  debtors: 'Qarzdorlar',
  tariff_change: "Kurs o'zgartirganlar",
  refund: "Pul qaytarish so'raganlar",
};

const inputClass = 'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';
const thClass = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500';
const tdClass = 'px-3 py-2 text-sm text-gray-700';
const tdNumClass = 'whitespace-nowrap px-3 py-2 text-right text-sm text-gray-700';

function formatAmount(value: number | null | undefined): string {
  return `${Math.round(Number(value || 0)).toLocaleString('uz-UZ')} so'm`;
}

function pendingMinutes(requestDate: Date | string): number {
  return Math.max(Math.round((Date.now() - new Date(requestDate).getTime()) / 60_000), 0);
}

function statusClass(status: string): string {
  if (status === 'approved') return 'text-emerald-600';
  if (status === 'rejected') return 'text-red-600';
  return 'text-amber-600';
}

function ResponseCell({ row }: { row: AdjustmentReportRow }) {
  if (row.responseMinutes == null) {
    return <span className="text-amber-600">Kutilmoqda ({formatResponseDuration(pendingMinutes(row.requestDate))})</span>;
  }
  return <span>{formatResponseDuration(row.responseMinutes)}</span>;
}

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('debtors');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [managerUserId, setManagerUserId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [status, setStatus] = useState<AdjustmentStatusFilter>('');
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);

  const accessQuery = trpc.reports.access.useQuery();
  const optionsQuery = trpc.reports.filterOptions.useQuery(undefined, { staleTime: 5 * 60 * 1000 });

  const visibleTabs = useMemo<ReportTab[]>(() => {
    const tabs: ReportTab[] = ['debtors'];
    if (accessQuery.data?.canSeeTariffChanges) tabs.push('tariff_change');
    if (accessQuery.data?.canSeeRefunds) tabs.push('refund');
    return tabs;
  }, [accessQuery.data]);

  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab('debtors');
  }, [visibleTabs, tab]);

  const tariffOptions = useMemo(
    () => optionsQuery.data?.courses.find((course) => course.id === courseId)?.tariffs ?? [],
    [optionsQuery.data, courseId],
  );

  const filters = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    managerUserId: managerUserId || undefined,
    courseId: courseId || undefined,
    tariffId: tariffId || undefined,
  };

  const debtorsQuery = trpc.reports.debtors.useQuery(filters, { enabled: tab === 'debtors' });
  const adjustmentsQuery = trpc.reports.adjustments.useQuery(
    { ...filters, type: tab === 'refund' ? 'refund' : 'tariff_change', status: status || undefined },
    { enabled: tab !== 'debtors' },
  );

  const debtorRows = (debtorsQuery.data ?? []) as DebtorReportRow[];
  const adjustmentRows = (adjustmentsQuery.data ?? []) as AdjustmentReportRow[];
  const activeQuery = tab === 'debtors' ? debtorsQuery : adjustmentsQuery;
  const activeRows: Array<{ agreementAmount: number; paidAmount: number; debtAmount: number }> = tab === 'debtors' ? debtorRows : adjustmentRows;
  const totals = useMemo(() => activeRows.reduce(
    (sum, row) => ({
      agreement: sum.agreement + Number(row.agreementAmount || 0),
      paid: sum.paid + Number(row.paidAmount || 0),
      debt: sum.debt + Number(row.debtAmount || 0),
    }),
    { agreement: 0, paid: 0, debt: 0 },
  ), [activeRows]);

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setManagerUserId('');
    setCourseId('');
    setTariffId('');
    setStatus('');
  };

  const handleExport = async () => {
    setExportError('');
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const [headers, widths, rows] = tab === 'debtors'
        ? [DEBTOR_EXPORT_HEADERS, DEBTOR_EXPORT_COLUMN_WIDTHS, buildDebtorExportRows(debtorRows)]
        : tab === 'tariff_change'
          ? [TARIFF_CHANGE_EXPORT_HEADERS, TARIFF_CHANGE_EXPORT_COLUMN_WIDTHS, buildTariffChangeExportRows(adjustmentRows)]
          : [REFUND_EXPORT_HEADERS, REFUND_EXPORT_COLUMN_WIDTHS, buildRefundExportRows(adjustmentRows)];
      const sheet = XLSX.utils.aoa_to_sheet([[...headers], ...rows]);
      sheet['!cols'] = widths.map((wch) => ({ wch }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, TAB_LABELS[tab].slice(0, 31));
      XLSX.writeFile(workbook, getReportFilename(tab, dateFrom, dateTo));
    } catch (error: any) {
      setExportError(error?.message || "Faylni yuklab bo'lmadi.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Hisobotlar</h1>
          <p className="mt-1 text-sm text-gray-500">Qarzdorlar, kurs o&apos;zgartirganlar va pul qaytarish so&apos;rovlari.</p>
        </div>
        <Link href="/dashboard/analytics" className="text-sm font-medium text-blue-600 hover:text-blue-700">
          &larr; Tahlil
        </Link>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <div className="overflow-x-auto">
            <div className="inline-flex min-w-max rounded-md shadow-sm">
              {visibleTabs.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTab(option)}
                  className={`border border-gray-300 px-3 py-1.5 text-sm font-medium ${
                    tab === option ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  } ${index === 0 ? 'rounded-l-md' : 'border-l-0'} ${index === visibleTabs.length - 1 ? 'rounded-r-md' : ''}`}
                >
                  {TAB_LABELS[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-xs text-gray-500">
              {tab === 'debtors' ? "Birinchi to'lov (dan)" : "So'rov sanasi (dan)"}
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={`mt-1 ${inputClass}`} />
            </label>
            <label className="flex flex-col text-xs text-gray-500">
              gacha
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={`mt-1 ${inputClass}`} />
            </label>
            <label className="flex flex-col text-xs text-gray-500">
              Sotuvchi
              <select value={managerUserId} onChange={(event) => setManagerUserId(event.target.value)} className={`mt-1 min-w-[160px] ${inputClass}`}>
                <option value="">Barchasi</option>
                {optionsQuery.data?.managers.map((manager) => (
                  <option key={manager.id} value={manager.id}>{manager.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-gray-500">
              Kurs
              <select
                value={courseId}
                onChange={(event) => {
                  setCourseId(event.target.value);
                  setTariffId('');
                }}
                className={`mt-1 min-w-[180px] ${inputClass}`}
              >
                <option value="">Barcha kurslar</option>
                {optionsQuery.data?.courses.map((course) => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs text-gray-500">
              Tarif
              <select
                value={tariffId}
                onChange={(event) => setTariffId(event.target.value)}
                disabled={!courseId}
                className={`mt-1 min-w-[140px] disabled:bg-gray-100 disabled:text-gray-500 ${inputClass}`}
              >
                <option value="">Barcha tariflar</option>
                {tariffOptions.map((tariff) => (
                  <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
                ))}
              </select>
            </label>
            {tab !== 'debtors' && (
              <label className="flex flex-col text-xs text-gray-500">
                Holat
                <select value={status} onChange={(event) => setStatus(event.target.value as AdjustmentStatusFilter)} className={`mt-1 ${inputClass}`}>
                  <option value="">Hammasi</option>
                  <option value="pending">Kutilmoqda</option>
                  <option value="approved">Tasdiqlangan</option>
                  <option value="rejected">Rad etilgan</option>
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Tozalash
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || activeQuery.isLoading || activeRows.length === 0}
              className="ml-auto rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {exporting ? 'Tayyorlanmoqda...' : 'Excel yuklab olish'}
            </button>
          </div>
          {exportError && <p className="text-sm text-red-600">{exportError}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Soni', value: String(activeRows.length) },
          { label: 'Kelishuv', value: formatAmount(totals.agreement) },
          { label: "To'langan", value: formatAmount(totals.paid) },
          { label: 'Qarz', value: formatAmount(totals.debt) },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-gray-900">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="p-4 sm:p-5">
          {activeQuery.error ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{activeQuery.error.message}</p>
          ) : activeQuery.isLoading ? (
            <LoadingBlock message="Yuklanmoqda..." />
          ) : activeRows.length === 0 ? (
            <p className="text-sm text-gray-600">Tanlangan filtrlar bo&apos;yicha ma&apos;lumot topilmadi.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                {tab === 'debtors' ? (
                  <>
                    <thead className="bg-gray-50">
                      <tr>
                        {DEBTOR_EXPORT_HEADERS.map((header) => <th key={header} className={thClass}>{header}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {debtorRows.map((row, index) => (
                        <tr key={`${row.customerNumber}-${index}`}>
                          <td className={`whitespace-nowrap ${tdClass}`}>{row.customerNumber}</td>
                          <td className={tdClass}>{row.customerName}</td>
                          <td className={`whitespace-nowrap ${tdClass}`}>{row.managerLabel}</td>
                          <td className={tdClass}>{formatCourseBundle(row.courseName, row.tariffName)}</td>
                          <td className={`whitespace-nowrap ${tdClass}`}>{formatTashkentDate(row.firstPaymentDate)}</td>
                          <td className={tdNumClass}>{formatAmount(row.agreementAmount)}</td>
                          <td className={tdNumClass}>{formatAmount(row.paidAmount)}</td>
                          <td className={`${tdNumClass} font-semibold text-red-600`}>{formatAmount(row.debtAmount)}</td>
                          <td className={`whitespace-nowrap ${tdClass}`}>{formatTashkentDate(row.lastPaymentDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead className="bg-gray-50">
                      <tr>
                        <th className={thClass}>So&apos;rov sanasi</th>
                        <th className={thClass}>Mijoz</th>
                        <th className={thClass}>Sotuvchi</th>
                        <th className={thClass}>Birinchi to&apos;lov</th>
                        <th className={thClass}>{tab === 'tariff_change' ? "Kursdan → Kursga" : 'Kurs / Tarif'}</th>
                        <th className={thClass}>Kelishuv</th>
                        <th className={thClass}>To&apos;langan</th>
                        <th className={thClass}>Qarz</th>
                        {tab === 'refund' && <th className={thClass}>Qaytariladigan</th>}
                        <th className={thClass}>Holat</th>
                        <th className={thClass}>Javob vaqti</th>
                        <th className={thClass}>Ko&apos;rib chiqdi</th>
                        <th className={thClass}>Izoh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {adjustmentRows.map((row, index) => (
                        <tr key={`${row.customerNumber}-${index}`}>
                          <td className={`whitespace-nowrap ${tdClass}`}>{formatTashkentDateTime(row.requestDate)}</td>
                          <td className={tdClass}>
                            <p className="whitespace-nowrap">{row.customerNumber}</p>
                            <p className="text-gray-500">{row.customerName}</p>
                          </td>
                          <td className={`whitespace-nowrap ${tdClass}`}>{row.managerLabel}</td>
                          <td className={`whitespace-nowrap ${tdClass}`}>{formatTashkentDate(row.firstPaymentDate)}</td>
                          <td className={tdClass}>
                            {tab === 'tariff_change' ? (
                              <div className="space-y-0.5">
                                <p className="text-gray-500">{formatCourseBundle(row.fromCourseName, row.fromTariffName)}</p>
                                <p className="font-medium text-gray-900">&rarr; {formatCourseBundle(row.toCourseName, row.toTariffName)}</p>
                              </div>
                            ) : (
                              formatCourseBundle(row.fromCourseName, row.fromTariffName)
                            )}
                          </td>
                          <td className={tdNumClass}>
                            {formatAmount(row.agreementAmount)}
                            {tab === 'tariff_change' && row.newAgreementAmount != null && row.newAgreementAmount !== row.agreementAmount && (
                              <p className="font-medium text-gray-900">&rarr; {formatAmount(row.newAgreementAmount)}</p>
                            )}
                          </td>
                          <td className={tdNumClass}>{formatAmount(row.paidAmount)}</td>
                          <td className={tdNumClass}>{formatAmount(row.debtAmount)}</td>
                          {tab === 'refund' && <td className={tdNumClass}>{formatAmount(row.requestedAmount)}</td>}
                          <td className={`whitespace-nowrap px-3 py-2 text-sm font-medium ${statusClass(row.status)}`}>{getAdjustmentStatusLabel(row.status)}</td>
                          <td className={`whitespace-nowrap ${tdClass}`}><ResponseCell row={row} /></td>
                          <td className={`whitespace-nowrap ${tdClass}`}>{row.reviewedByLabel || '-'}</td>
                          <td className={`max-w-xs ${tdClass}`}>
                            {row.reason || '-'}
                            {row.reviewNote && <p className="mt-0.5 text-gray-500">Javob: {row.reviewNote}</p>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
