'use client';

import { getCurrentMonthToDateRange, getPreviousMonthRange, getPreviousWeekRange, getTashkentToday, type ExtendedDashboardRange as DashboardRange } from '@/lib/date-range';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import { useDashboardAiPageContext } from '@/contexts/dashboard-ai-context';
import LoadingBlock from '@/components/dashboard/loading-block';
import {
  BONUS_DETAIL_EXPORT_COLUMN_WIDTHS,
  BONUS_DETAIL_EXPORT_HEADERS,
  buildBonusDetailExportRows,
} from './bonus-detail-export';
import { formatSom } from '@/lib/format';
import { IconArrowLeft, IconCalendar, IconCalendarCheck, IconCash, IconCircleCheck, IconDownload, IconListDetails, IconUsers } from '@tabler/icons-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { UserAvatar } from '@/components/ui/user-avatar';

const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);

const RANGE_OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: 'today', label: 'Bugun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
  { value: 'last_week', label: "O'tgan hafta" },
  { value: 'last_month', label: "O'tgan oy" },
  { value: 'custom', label: 'Ixtiyoriy' },
];

const ADJUSTMENT_STATUS_BADGE: Record<string, string> = {
  pending: 'badge-amber',
  approved: 'badge-green',
  rejected: 'badge-red',
};

function getCurrentWeekRange() {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
  local.setHours(0, 0, 0, 0);
  const day = local.getDay();
  const daysSinceMonday = (day + 6) % 7;
  const currentWeekMonday = new Date(local);
  currentWeekMonday.setDate(local.getDate() - daysSinceMonday);

  const toIso = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dayValue = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${dayValue}`;
  };

  return {
    dateFrom: toIso(currentWeekMonday),
    dateTo: toIso(local),
  };
}

export default function FinanceBonusDetailsPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isAgentOnly = roles.some((role) => AGENT_ROLES.has(role))
    && !roles.includes('Admin')
    && !roles.includes('Manager')
    && !roles.includes('TeamLeader')
    && !roles.includes('Finance');
  const isAdmin = roles.includes('Admin');

  const [range, setRange] = useState<DashboardRange>('month');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [courseId, setCourseId] = useState('');
  const [managerUserId, setManagerUserId] = useState('');
  const [operationMonth, setOperationMonth] = useState(() => getPreviousMonthRange().dateFrom.slice(0, 7));
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  const effectiveDateRange = useMemo(() => {
    if (range === 'today') {
      const today = getTashkentToday();
      return { dateFrom: today, dateTo: today };
    }
    if (range === 'week') {
      return getCurrentWeekRange();
    }
    if (range === 'month') {
      return getCurrentMonthToDateRange();
    }
    if (range === 'last_week') {
      return getPreviousWeekRange();
    }
    if (range === 'last_month') {
      return getPreviousMonthRange();
    }
    if (range === 'custom') {
      return { dateFrom, dateTo };
    }
    return { dateFrom, dateTo };
  }, [range, dateFrom, dateTo]);

  const filters = useMemo(() => ({
    range: 'custom' as const,
    dateFrom: effectiveDateRange.dateFrom,
    dateTo: effectiveDateRange.dateTo,
    courseId: courseId || undefined,
    managerUserId: isAgentOnly ? undefined : (managerUserId || undefined),
  }), [effectiveDateRange, courseId, managerUserId, isAgentOnly]);

  const financeOptionsQuery = trpc.dashboard.financeSummary.useQuery(filters, {
    retry: 1,
    refetchInterval: 5 * 60 * 1000,
  });

  const bonusDetailsQuery = trpc.dashboard.bonusIncomeDetails.useQuery(filters, {
    retry: 1,
    refetchInterval: 5 * 60 * 1000,
  });
  const exportBonusDetails = trpc.dashboard.exportBonusIncomeDetails.useMutation();
  const bonusOperationsQuery = trpc.bonus.getBonusOperations.useQuery(undefined, {
    enabled: !isAgentOnly,
    retry: false,
  });
  const previewMonth = trpc.bonus.previewBonusMonth.useMutation();
  const finalizeMonth = trpc.bonus.finalizeBonusMonth.useMutation();
  const reconcileMonth = trpc.bonus.reconcileBonusMonth.useMutation();
  const reviewAdjustment = trpc.bonus.reviewBonusAdjustment.useMutation();

  const courseOptions = useMemo(() => financeOptionsQuery.data?.courseOptions || [], [financeOptionsQuery.data]);
  const managerOptions = useMemo(() => financeOptionsQuery.data?.managerOptions || [], [financeOptionsQuery.data]);
  const bonusRows = useMemo(() => bonusDetailsQuery.data?.rows || [], [bonusDetailsQuery.data]);
  const bonusTotals = bonusDetailsQuery.data?.totals;
  const summaryTotals = bonusDetailsQuery.data?.summaryTotals;
  const agentSummary = useMemo(() => bonusDetailsQuery.data?.agentSummary || [], [bonusDetailsQuery.data]);
  const bonusAgentCount = useMemo(
    () => agentSummary.length || new Set(bonusRows.map((row) => row.managerUserId)).size,
    [agentSummary, bonusRows],
  );

  const aiPageContext = useMemo(() => ({
    pageKey: '/dashboard/finance/bonus-details',
    rangeMode: range,
    dateFrom: effectiveDateRange.dateFrom,
    dateTo: effectiveDateRange.dateTo,
    filters: {
      courseId: courseId || null,
      managerUserId: managerUserId || null,
      isAgentOnly,
    },
    metrics: {
      agentCount: bonusAgentCount,
      incomeAmount: summaryTotals?.incomeAmount ?? bonusTotals?.incomeAmount ?? 0,
      closedAgreementAmount: summaryTotals?.closedAgreementAmount ?? 0,
      totalBonusAmount: summaryTotals?.totalBonusAmount ?? bonusTotals?.bonusAmount ?? 0,
      rowCount: bonusRows.length,
    },
  }), [
    range,
    effectiveDateRange.dateFrom,
    effectiveDateRange.dateTo,
    courseId,
    managerUserId,
    isAgentOnly,
    bonusAgentCount,
    summaryTotals?.incomeAmount,
    summaryTotals?.closedAgreementAmount,
    summaryTotals?.totalBonusAmount,
    bonusTotals?.incomeAmount,
    bonusTotals?.bonusAmount,
    bonusRows.length,
  ]);
  useDashboardAiPageContext(aiPageContext);

  const runMonthAction = async (action: 'preview' | 'finalize' | 'reconcile') => {
    setOperationMessage(null);
    try {
      if (action === 'preview') {
        const result = await previewMonth.mutateAsync({ month: operationMonth });
        setOperationMessage(`${operationMonth}: ${formatSom(result.totalBonusAmount)} hisoblandi.`);
      } else if (action === 'finalize') {
        const result = await finalizeMonth.mutateAsync({ month: operationMonth });
        setOperationMessage(`${operationMonth} yakunlandi: ${formatSom(result.totalBonusAmount)}.`);
      } else {
        const result = await reconcileMonth.mutateAsync({ month: operationMonth });
        setOperationMessage(`${result.pendingCount} ta kutilayotgan tuzatish yangilandi.`);
      }
      await Promise.all([bonusOperationsQuery.refetch(), bonusDetailsQuery.refetch()]);
    } catch (error: any) {
      setOperationMessage(error?.message || 'Amal bajarilmadi.');
    }
  };

  const handleReviewAdjustment = async (adjustmentId: string, action: 'approve' | 'reject') => {
    const note = action === 'reject' ? window.prompt('Rad etish sababini kiriting:') : undefined;
    if (action === 'reject' && !note?.trim()) return;
    try {
      await reviewAdjustment.mutateAsync({ adjustmentId, action, note: note || undefined });
      await Promise.all([bonusOperationsQuery.refetch(), bonusDetailsQuery.refetch()]);
    } catch (error: any) {
      setOperationMessage(error?.message || 'Tuzatishni ko\'rib chiqishda xatolik.');
    }
  };

  const handleDownloadBonusDetails = async () => {
    setExportError(null);
    setExportSuccess(null);

    try {
      const result = await exportBonusDetails.mutateAsync(filters);
      if (!result.rows.length) {
        setExportError("Tanlangan filtr bo'yicha yuklab olish uchun bonus qatorlari topilmadi.");
        return;
      }

      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.aoa_to_sheet([
        [...BONUS_DETAIL_EXPORT_HEADERS],
        ...buildBonusDetailExportRows(result.rows),
      ]);
      worksheet['!cols'] = BONUS_DETAIL_EXPORT_COLUMN_WIDTHS.map((width) => ({ wch: width }));

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Bonus tafsiloti');
      const workbookBuffer = XLSX.write(workbook, { bookType: 'xls', type: 'array' });
      const blob = new Blob([workbookBuffer], { type: 'application/vnd.ms-excel' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `bonus-tafsiloti-${effectiveDateRange.dateFrom}-${effectiveDateRange.dateTo}.xls`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setExportSuccess(`${result.totalCount} ta qator yuklab olindi.`);
    } catch (error: any) {
      setExportError(error?.message || "Bonus tafsilotlarini yuklab olishda xatolik yuz berdi.");
    }
  };


  return (
    <div className="space-y-6">
      <PageHeader
        title="Bonus tafsiloti"
        description="Bonus hisobiga ta'sir qilayotgan qatorlar (debug ustunlari bilan)."
        actions={(
          <>
            <Link href="/dashboard/finance" className="btn btn-secondary inline-flex">
              <IconArrowLeft className="h-4 w-4" stroke={1.8} />
              Moliya sahifasiga qaytish
            </Link>
            <button
              type="button"
              onClick={() => void handleDownloadBonusDetails()}
              disabled={exportBonusDetails.isLoading}
              className="btn btn-primary inline-flex"
            >
              <IconDownload className="h-4 w-4" stroke={1.8} />
              {exportBonusDetails.isLoading ? 'Tayyorlanmoqda...' : 'XLS yuklab olish'}
            </button>
          </>
        )}
      />

      {exportError ? <p className="alert alert-error">{exportError}</p> : null}
      {exportSuccess ? <p className="alert alert-success">{exportSuccess}</p> : null}

      <div className="panel p-3 sm:p-4">
        <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center">
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="segmented" role="group" aria-label="Davr">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRange(option.value)}
                  aria-pressed={range === option.value}
                  className={range === option.value ? 'segmented-item segmented-item-active' : 'segmented-item'}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className={isAgentOnly ? 'grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3' : 'grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4'}>
            <div className="relative">
              <IconCalendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
              <input
                type="date"
                value={range === 'custom' ? dateFrom : effectiveDateRange.dateFrom}
                disabled={range !== 'custom'}
                onChange={(event) => setDateFrom(event.target.value)}
                className="field pl-9"
              />
            </div>
            <div className="relative">
              <IconCalendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" stroke={1.8} />
              <input
                type="date"
                value={range === 'custom' ? dateTo : effectiveDateRange.dateTo}
                disabled={range !== 'custom'}
                onChange={(event) => setDateTo(event.target.value)}
                className="field pl-9"
              />
            </div>

            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className="field"
            >
              <option value="">Barcha kurslar</option>
              {courseOptions.map((course) => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>

            {!isAgentOnly && (
              <select
                value={managerUserId}
                onChange={(event) => setManagerUserId(event.target.value)}
                className="field"
              >
                <option value="">Barcha agentlar</option>
                {managerOptions.map((manager) => (
                  <option key={manager.id} value={manager.id}>{manager.label}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {bonusDetailsQuery.error && (
        <div className="alert alert-error">
          {bonusDetailsQuery.error.message || "Bonus tafsilotlarini yuklashda xatolik."}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Agentlar" value={bonusAgentCount} icon={IconUsers} />
        <StatTile label="Filtr bo'yicha tushum" value={formatSom(summaryTotals?.incomeAmount ?? bonusTotals?.incomeAmount)} icon={IconCash} tone="blue" />
        <StatTile label="Yopilgan tushum (kelishuv)" value={formatSom(summaryTotals?.closedAgreementAmount)} icon={IconCircleCheck} tone="green" />
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2 className="section-title">Agentlar bo'yicha bonuslar</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Tushum, yopilgan tushum va bonuslar kesimi (tanlangan davr bo'yicha).
            </p>
          </div>
        </div>
        <div className="p-2 sm:p-3">
          {bonusDetailsQuery.isLoading ? (
            <LoadingBlock message="Yuklanmoqda..." className="m-2" />
          ) : agentSummary.length ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left">Agent</th>
                    <th className="text-right">Tushum</th>
                    <th className="text-right">Yopilgan tushum</th>
                    <th className="text-right">Jami bonus</th>
                    <th className="text-right">Online</th>
                    <th className="text-right">Offline</th>
                    <th className="text-right">Intensiv</th>
                    <th className="text-right">Qo'shimcha xizmat</th>
                  </tr>
                </thead>
                <tbody>
                  {agentSummary.map((row) => (
                    <tr key={row.managerUserId}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <UserAvatar name={row.managerLabel || '?'} size="sm" />
                          <span className="whitespace-nowrap font-medium text-gray-900">{row.managerLabel}</span>
                        </div>
                      </td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.incomeAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.closedAgreementAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right font-semibold text-gray-900">{formatSom(row.totalBonusAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.bonusByCategory?.online)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.bonusByCategory?.offline)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.bonusByCategory?.intensive)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.bonusByCategory?.additional_service)}</td>
                    </tr>
                  ))}
                </tbody>
                {summaryTotals && (
                  <tfoot>
                    <tr>
                      <td className="whitespace-nowrap">Jami</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(summaryTotals.incomeAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(summaryTotals.closedAgreementAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(summaryTotals.totalBonusAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(summaryTotals.bonusByCategory?.online)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(summaryTotals.bonusByCategory?.offline)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(summaryTotals.bonusByCategory?.intensive)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(summaryTotals.bonusByCategory?.additional_service)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : (
            <EmptyState icon={IconUsers} title="Tanlangan filtr bo'yicha agentlar kesimi topilmadi." className="m-2" />
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="section-title">Bonus qatorlari tafsiloti</h2>
          {bonusRows.length ? <span className="badge badge-neutral tabular">{bonusRows.length}</span> : null}
        </div>
        <div className="p-2 sm:p-3">
          {bonusDetailsQuery.isLoading ? (
            <LoadingBlock message="Yuklanmoqda..." className="m-2" />
          ) : bonusRows.length ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left">Sana</th>
                    <th className="text-left">Turi</th>
                    <th className="text-left">Mijoz</th>
                    <th className="text-left">Agent</th>
                    <th className="text-left">Kurs/Tarif/Subtarif</th>
                    <th className="text-right">Kelishuv summasi</th>
                    <th className="text-right">Tushum</th>
                    <th className="text-right">Qolgan qarz</th>
                    <th className="text-right">Hisoblangan bonus</th>
                    <th className="text-left">Debug: Kategoriya</th>
                    <th className="text-right">Debug: Fakt</th>
                    <th className="text-right">Debug: Foiz</th>
                    <th className="text-left">Debug: Fallback</th>
                  </tr>
                </thead>
                <tbody>
                  {bonusRows.map((row) => (
                    <tr key={row.id}>
                      <td className="tabular whitespace-nowrap text-gray-600">
                        {new Date(row.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={row.type === 'repayment' ? 'badge badge-amber' : 'badge badge-blue'}>
                          {row.type === 'repayment' ? "Qarzdorlik to'lovi" : 'Yangi sotuv'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap font-medium text-gray-900">
                        {row.customerNumber} - {row.customerName}
                      </td>
                      <td className="whitespace-nowrap">{row.managerLabel}</td>
                      <td className="whitespace-nowrap">
                        {[row.courseName, row.tariffName, row.subTariffName].filter(Boolean).join(' / ') || '-'}
                      </td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.agreementAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.paymentAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.remainingDebtAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right font-semibold text-gray-900">
                        {row.isLastPayment ? formatSom(row.calculatedBonus) : '-'}
                      </td>
                      <td className="whitespace-nowrap text-xs text-gray-500">{row.bonusDebug?.category || '-'}</td>
                      <td className="tabular whitespace-nowrap text-right text-xs text-gray-500">{row.bonusDebug?.closedCount ?? '-'}</td>
                      <td className="tabular whitespace-nowrap text-right text-xs text-gray-500">
                        {row.bonusDebug?.appliedPercent == null ? '-' : `${row.bonusDebug.appliedPercent}%`}
                      </td>
                      <td className="whitespace-nowrap text-xs text-gray-500">{row.bonusDebug?.usedFallback ? 'ha' : 'yo\'q'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={IconListDetails} title="Tanlangan filtr bo'yicha bonus tafsiloti topilmadi." className="m-2" />
          )}
        </div>
      </div>

      {!isAgentOnly ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="panel">
            <div className="panel-header items-start">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
                  <IconCalendarCheck className="h-[18px] w-[18px]" stroke={1.8} />
                </span>
                <div className="min-w-0">
                  <h2 className="section-title">Bonus oyini yakunlash</h2>
                  <p className="mt-0.5 text-sm text-gray-500">Yakunlangan oylar snapshot bo&apos;lib saqlanadi; keyingi o&apos;zgarishlar tuzatish yaratadi.</p>
                </div>
              </div>
            </div>
            <div className="panel-body space-y-4">
              <div className="flex flex-wrap gap-2">
                <input type="month" value={operationMonth} onChange={(event) => setOperationMonth(event.target.value)} className="field w-auto flex-1 sm:flex-none" />
                {isAdmin ? (
                  <>
                    <button type="button" onClick={() => void runMonthAction('preview')} className="btn btn-soft">Ko&apos;rib chiqish</button>
                    <button type="button" onClick={() => void runMonthAction('finalize')} className="btn btn-primary">Yakunlash</button>
                    <button type="button" onClick={() => void runMonthAction('reconcile')} className="btn btn-warning-soft">Qayta solishtirish</button>
                  </>
                ) : null}
              </div>
              {operationMessage ? <p className="alert alert-info">{operationMessage}</p> : null}
              {(bonusOperationsQuery.data?.snapshots || []).length > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(bonusOperationsQuery.data?.snapshots || []).slice(0, 6).map((snapshot) => (
                    <div key={snapshot.id} className="panel-inset flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="tabular font-medium text-gray-900">{snapshot.month}</p>
                        <p className="tabular text-gray-600">{formatSom(snapshot.totalBonusAmount)}</p>
                      </div>
                      <span className="badge badge-green">Yakunlangan</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {(bonusOperationsQuery.data?.adjustments.length || 0) > 0 ? (
            <div className="panel">
              <div className="panel-header">
                <h2 className="section-title">Bonus tuzatishlari</h2>
                <span className="badge badge-neutral tabular">{bonusOperationsQuery.data?.adjustments.length}</span>
              </div>
              <div className="p-2 sm:p-3">
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead><tr>
                      <th className="text-left">Manba oy</th>
                      <th className="text-left">Agent</th>
                      <th className="text-right">Farq</th>
                      <th className="text-left">Holat</th>
                      <th className="text-left">Amal</th>
                    </tr></thead>
                    <tbody>
                      {bonusOperationsQuery.data?.adjustments.map((adjustment) => (
                        <tr key={adjustment.id}>
                          <td className="tabular whitespace-nowrap">{adjustment.sourceMonth}</td>
                          <td>{adjustment.agentUserId}</td>
                          <td className={adjustment.deltaAmount < 0 ? 'tabular whitespace-nowrap text-right font-medium text-red-700' : 'tabular whitespace-nowrap text-right font-medium text-emerald-700'}>{formatSom(adjustment.deltaAmount)}</td>
                          <td><span className={`badge ${ADJUSTMENT_STATUS_BADGE[adjustment.status] || 'badge-neutral'}`}>{adjustment.status}</span></td>
                          <td>
                            {isAdmin && adjustment.status === 'pending' ? (
                              <div className="flex gap-2">
                                <button type="button" onClick={() => void handleReviewAdjustment(adjustment.id, 'approve')} className="btn btn-sm btn-success">Tasdiqlash</button>
                                <button type="button" onClick={() => void handleReviewAdjustment(adjustment.id, 'reject')} className="btn btn-sm btn-danger-soft">Rad etish</button>
                              </div>
                            ) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
