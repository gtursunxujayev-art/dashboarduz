'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  IconAlertCircle,
  IconCalendar,
  IconCash,
  IconClock,
  IconDownload,
  IconFileText,
  IconListNumbers,
  IconX,
} from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';
import { FilterPill, pillControlClass } from '@/components/dashboard/filter-pill';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
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
  formatResponseDuration,
  getAdjustmentStatusLabel,
  getReportFilename,
  type AdjustmentReportRow,
  type DebtorReportRow,
  type ReportTab,
} from './reports-export';
import { formatCourseBundle, formatSomUz, formatTashkentDate, formatTashkentTimestamp } from '@/lib/format';
import { type AdjustmentStatus } from '@dashboarduz/shared';

type AdjustmentStatusFilter = '' | AdjustmentStatus;

const TAB_LABELS: Record<ReportTab, string> = {
  debtors: 'Qarzdorlar',
  tariff_change: "Kurs o'zgartirganlar",
  refund: "Pul qaytarish so'raganlar",
};

const thClass = 'text-left';
const thNumClass = 'text-right';
const tdClass = 'text-sm';
const tdNumClass = 'tabular whitespace-nowrap text-right text-sm';
/** Money columns of the debtor table (Kelishuv, To'langan, Qarz). */
const DEBTOR_MONEY_HEADERS = new Set<string>(['Kelishuv', "To'langan", 'Qarz']);

function pendingMinutes(requestDate: Date | string): number {
  return Math.max(Math.round((Date.now() - new Date(requestDate).getTime()) / 60_000), 0);
}

function statusClass(status: string): string {
  if (status === 'approved') return 'badge-green';
  if (status === 'rejected') return 'badge-red';
  return 'badge-amber';
}

function ResponseCell({ row }: { row: AdjustmentReportRow }) {
  if (row.responseMinutes == null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-amber-700">
        <IconClock className="h-3.5 w-3.5" stroke={1.8} aria-hidden="true" />
        Kutilmoqda ({formatResponseDuration(pendingMinutes(row.requestDate))})
      </span>
    );
  }
  return <span className="tabular">{formatResponseDuration(row.responseMinutes)}</span>;
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
      <PageHeader
        title="Hisobotlar"
        description={<>Qarzdorlar, kurs o&apos;zgartirganlar va pul qaytarish so&apos;rovlari.</>}
        actions={(
          <>
            <Link href="/dashboard/analytics" className="btn btn-ghost">
              &larr; Tahlil
            </Link>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || activeQuery.isLoading || activeRows.length === 0}
              className="btn btn-primary"
            >
              <IconDownload className="h-4 w-4" stroke={1.8} aria-hidden="true" />
              {exporting ? 'Tayyorlanmoqda...' : 'Excel yuklab olish'}
            </button>
          </>
        )}
      >
        <div className="space-y-4">
          <div className="tabs" role="tablist" aria-label="Hisobotlar">
            {visibleTabs.map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                onClick={() => setTab(option)}
                aria-selected={tab === option}
                className={`tab ${tab === option ? 'tab-active' : ''}`}
              >
                {TAB_LABELS[option]}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterPill icon={IconCalendar} label={tab === 'debtors' ? "Birinchi to'lov (dan)" : "So'rov sanasi (dan)"}>
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={`${pillControlClass} w-[9.5rem] flex-none`} />
            </FilterPill>
            <FilterPill label="gacha">
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={`${pillControlClass} w-[9.5rem] flex-none`} />
            </FilterPill>
            <FilterPill label="Sotuvchi">
              <select value={managerUserId} onChange={(event) => setManagerUserId(event.target.value)} className={`${pillControlClass} max-w-[12rem]`}>
                <option value="">Barchasi</option>
                {optionsQuery.data?.managers.map((manager) => (
                  <option key={manager.id} value={manager.id}>{manager.label}</option>
                ))}
              </select>
            </FilterPill>
            <FilterPill label="Kurs">
              <select
                value={courseId}
                onChange={(event) => {
                  setCourseId(event.target.value);
                  setTariffId('');
                }}
                className={`${pillControlClass} max-w-[14rem]`}
              >
                <option value="">Barcha kurslar</option>
                {optionsQuery.data?.courses.map((course) => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </select>
            </FilterPill>
            <FilterPill label="Tarif" className={courseId ? '' : 'opacity-70'}>
              <select
                value={tariffId}
                onChange={(event) => setTariffId(event.target.value)}
                disabled={!courseId}
                className={`${pillControlClass} max-w-[12rem]`}
              >
                <option value="">Barcha tariflar</option>
                {tariffOptions.map((tariff) => (
                  <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
                ))}
              </select>
            </FilterPill>
            {tab !== 'debtors' && (
              <FilterPill label="Holat">
                <select value={status} onChange={(event) => setStatus(event.target.value as AdjustmentStatusFilter)} className={`${pillControlClass} max-w-[10rem]`}>
                  <option value="">Hammasi</option>
                  <option value="pending">Kutilmoqda</option>
                  <option value="approved">Tasdiqlangan</option>
                  <option value="rejected">Rad etilgan</option>
                </select>
              </FilterPill>
            )}
            <button
              type="button"
              onClick={clearFilters}
              className="btn btn-ghost"
            >
              <IconX className="h-4 w-4" stroke={1.8} aria-hidden="true" />
              Tozalash
            </button>
          </div>
        </div>
      </PageHeader>

      {exportError && <p className="alert alert-error">{exportError}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Soni', value: String(activeRows.length), icon: IconListNumbers, tone: 'neutral' as const },
          { label: 'Kelishuv', value: formatSomUz(totals.agreement), icon: IconFileText, tone: 'blue' as const },
          { label: "To'langan", value: formatSomUz(totals.paid), icon: IconCash, tone: 'green' as const },
          { label: 'Qarz', value: formatSomUz(totals.debt), icon: IconAlertCircle, tone: 'red' as const },
        ].map((card) => (
          <StatTile key={card.label} label={card.label} value={card.value} icon={card.icon} tone={card.tone} />
        ))}
      </div>

      <section className="panel" role="tabpanel" aria-label={TAB_LABELS[tab]}>
        <div className="panel-header pb-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="section-title">{TAB_LABELS[tab]}</h2>
            <span className="badge badge-neutral tabular">{activeRows.length}</span>
          </div>
        </div>
        <div className="p-2 sm:p-3">
          {activeQuery.error ? (
            <p className="alert alert-error">{activeQuery.error.message}</p>
          ) : activeQuery.isLoading ? (
            <LoadingBlock message="Yuklanmoqda..." />
          ) : activeRows.length === 0 ? (
            <EmptyState title={<>Tanlangan filtrlar bo&apos;yicha ma&apos;lumot topilmadi.</>} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                {tab === 'debtors' ? (
                  <>
                    <thead>
                      <tr>
                        {DEBTOR_EXPORT_HEADERS.map((header) => (
                          <th key={header} className={DEBTOR_MONEY_HEADERS.has(header) ? thNumClass : thClass}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {debtorRows.map((row, index) => (
                        <tr key={`${row.customerNumber}-${index}`}>
                          <td className={`tabular whitespace-nowrap ${tdClass}`}>{row.customerNumber}</td>
                          <td className={tdClass}>
                            <div className="flex items-center gap-2.5">
                              <UserAvatar name={row.customerName || row.customerNumber || '?'} size="sm" />
                              <span className="font-medium text-gray-900">{row.customerName}</span>
                            </div>
                          </td>
                          <td className={`whitespace-nowrap ${tdClass}`}>{row.managerLabel}</td>
                          <td className={tdClass}>{formatCourseBundle(row.courseName, row.tariffName)}</td>
                          <td className={`tabular whitespace-nowrap ${tdClass}`}>{formatTashkentDate(row.firstPaymentDate, '')}</td>
                          <td className={tdNumClass}>{formatSomUz(row.agreementAmount)}</td>
                          <td className={tdNumClass}>{formatSomUz(row.paidAmount)}</td>
                          <td className={`${tdNumClass} font-semibold text-red-600`}>{formatSomUz(row.debtAmount)}</td>
                          <td className={`tabular whitespace-nowrap ${tdClass}`}>{formatTashkentDate(row.lastPaymentDate, '')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <th className={thClass}>So&apos;rov sanasi</th>
                        <th className={thClass}>Mijoz</th>
                        <th className={thClass}>Sotuvchi</th>
                        <th className={thClass}>Birinchi to&apos;lov</th>
                        <th className={thClass}>{tab === 'tariff_change' ? "Kursdan → Kursga" : 'Kurs / Tarif'}</th>
                        <th className={thNumClass}>Kelishuv</th>
                        <th className={thNumClass}>To&apos;langan</th>
                        <th className={thNumClass}>Qarz</th>
                        {tab === 'refund' && <th className={thNumClass}>Qaytariladigan</th>}
                        <th className={thClass}>Holat</th>
                        <th className={thClass}>Javob vaqti</th>
                        <th className={thClass}>Ko&apos;rib chiqdi</th>
                        <th className={thClass}>Izoh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adjustmentRows.map((row, index) => (
                        <tr key={`${row.customerNumber}-${index}`}>
                          <td className={`tabular whitespace-nowrap ${tdClass}`}>{formatTashkentTimestamp(row.requestDate, { withSeconds: false })}</td>
                          <td className={tdClass}>
                            <div className="flex items-center gap-2.5">
                              <UserAvatar name={row.customerName || row.customerNumber || '?'} size="sm" />
                              <div className="min-w-0">
                                <p className="tabular whitespace-nowrap font-medium text-gray-900">{row.customerNumber}</p>
                                <p className="text-gray-500">{row.customerName}</p>
                              </div>
                            </div>
                          </td>
                          <td className={`whitespace-nowrap ${tdClass}`}>{row.managerLabel}</td>
                          <td className={`tabular whitespace-nowrap ${tdClass}`}>{formatTashkentDate(row.firstPaymentDate, '')}</td>
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
                            {formatSomUz(row.agreementAmount)}
                            {tab === 'tariff_change' && row.newAgreementAmount != null && row.newAgreementAmount !== row.agreementAmount && (
                              <p className="font-medium text-gray-900">&rarr; {formatSomUz(row.newAgreementAmount)}</p>
                            )}
                          </td>
                          <td className={tdNumClass}>{formatSomUz(row.paidAmount)}</td>
                          <td className={tdNumClass}>{formatSomUz(row.debtAmount)}</td>
                          {tab === 'refund' && <td className={`${tdNumClass} font-medium text-gray-900`}>{formatSomUz(row.requestedAmount)}</td>}
                          <td className={`whitespace-nowrap ${tdClass}`}>
                            <span className={`badge ${statusClass(row.status)}`}>{getAdjustmentStatusLabel(row.status)}</span>
                          </td>
                          <td className={`whitespace-nowrap ${tdClass}`}><ResponseCell row={row} /></td>
                          <td className={`whitespace-nowrap ${tdClass}`}>{row.reviewedByLabel || '-'}</td>
                          <td className={`min-w-[14rem] max-w-xs ${tdClass}`}>
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
      </section>
    </div>
  );
}
