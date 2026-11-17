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
import { IconAdjustments, IconArrowLeft, IconCalendarCheck, IconCash, IconCheck, IconCircleCheck, IconCoins, IconDownload, IconListDetails, IconUsers, IconX } from '@tabler/icons-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { FinanceFilterBar } from '../_components/finance-filter-bar';
import { AgentBonusCards } from './agent-bonus-cards';

const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);

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


  const adjustments = bonusOperationsQuery.data?.adjustments || [];
  const snapshots = bonusOperationsQuery.data?.snapshots || [];

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
      >
        <FinanceFilterBar
          range={range}
          onRangeChange={setRange}
          dateFrom={dateFrom}
          dateTo={dateTo}
          effectiveDateFrom={effectiveDateRange.dateFrom}
          effectiveDateTo={effectiveDateRange.dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          courseId={courseId}
          onCourseChange={setCourseId}
          courseOptions={courseOptions}
          showManagerFilter={!isAgentOnly}
          managerUserId={managerUserId}
          onManagerChange={setManagerUserId}
          managerOptions={managerOptions}
        />
      </PageHeader>

      {exportError ? <p className="alert alert-error">{exportError}</p> : null}
      {exportSuccess ? <p className="alert alert-success">{exportSuccess}</p> : null}

      {bonusDetailsQuery.error && (
        <div className="alert alert-error">
          {bonusDetailsQuery.error.message || "Bonus tafsilotlarini yuklashda xatolik."}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Jami bonus" value={formatSom(summaryTotals?.totalBonusAmount ?? bonusTotals?.bonusAmount)} icon={IconCoins} tone="blue" />
        <StatTile label="Agentlar" value={bonusAgentCount} icon={IconUsers} />
        <StatTile label="Filtr bo'yicha tushum" value={formatSom(summaryTotals?.incomeAmount ?? bonusTotals?.incomeAmount)} icon={IconCash} />
        <StatTile label="Yopilgan tushum (kelishuv)" value={formatSom(summaryTotals?.closedAgreementAmount)} icon={IconCircleCheck} tone="green" />
      </div>

      <div className={!isAgentOnly ? 'grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]' : 'grid grid-cols-1 gap-6'}>
        <section className="panel">
          <div className="panel-header">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h2 className="section-title">Agentlar bo'yicha bonuslar</h2>
                {agentSummary.length ? <span className="badge badge-neutral tabular">{agentSummary.length}</span> : null}
              </div>
              <p className="mt-0.5 text-sm text-gray-500">
                Tushum, yopilgan tushum va bonuslar kesimi (tanlangan davr bo'yicha).
              </p>
            </div>
          </div>
          <div className="panel-body">
            {bonusDetailsQuery.isLoading ? (
              <LoadingBlock message="Yuklanmoqda..." />
            ) : agentSummary.length ? (
              <AgentBonusCards agents={agentSummary} lines={bonusRows} totals={summaryTotals} />
            ) : (
              <EmptyState icon={IconUsers} title="Tanlangan filtr bo'yicha agentlar kesimi topilmadi." />
            )}
          </div>
        </section>

        {!isAgentOnly ? (
          <aside className="panel xl:sticky xl:top-20">
            <div className="panel-header items-start">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <IconCalendarCheck className="h-[18px] w-[18px]" stroke={1.6} />
                </span>
                <div className="min-w-0">
                  <h2 className="section-title">Bonus oyini yakunlash</h2>
                  <p className="mt-0.5 text-sm text-gray-500">Yakunlangan oylar snapshot bo&apos;lib saqlanadi; keyingi o&apos;zgarishlar tuzatish yaratadi.</p>
                </div>
              </div>
            </div>
            <div className="panel-body space-y-4">
              <input type="month" value={operationMonth} onChange={(event) => setOperationMonth(event.target.value)} className="field tabular" />
              {isAdmin ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-1">
                  <button type="button" onClick={() => void runMonthAction('finalize')} className="btn btn-primary">Yakunlash</button>
                  <button type="button" onClick={() => void runMonthAction('preview')} className="btn btn-soft">Ko&apos;rib chiqish</button>
                  <button type="button" onClick={() => void runMonthAction('reconcile')} className="btn btn-warning-soft">Qayta solishtirish</button>
                </div>
              ) : null}
              {operationMessage ? <p className="alert alert-info">{operationMessage}</p> : null}
              {snapshots.length > 0 && (
                <ul className="divide-y divide-gray-100 rounded-[16px] bg-gray-50 px-4">
                  {snapshots.slice(0, 6).map((snapshot) => (
                    <li key={snapshot.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="tabular font-medium text-gray-900">{snapshot.month}</p>
                        <p className="tabular text-gray-600">{formatSom(snapshot.totalBonusAmount)}</p>
                      </div>
                      <span className="badge badge-green">Yakunlangan</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        ) : null}
      </div>

      {!isAgentOnly && adjustments.length > 0 ? (
        <section className="panel">
          <div className="panel-header">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <IconAdjustments className="h-[18px] w-[18px]" stroke={1.6} />
              </span>
              <h2 className="section-title">Bonus tuzatishlari</h2>
              <span className="badge badge-neutral tabular">{adjustments.length}</span>
            </div>
          </div>
          <div className="p-2 sm:p-3">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr>
                  <th className="text-left">Manba oy</th>
                  <th className="text-left">Agent</th>
                  <th className="text-right">Farq</th>
                  <th className="text-left">Holat</th>
                  <th className="text-right">Amal</th>
                </tr></thead>
                <tbody>
                  {adjustments.map((adjustment) => (
                    <tr key={adjustment.id}>
                      <td className="tabular whitespace-nowrap">{adjustment.sourceMonth}</td>
                      <td className="font-medium text-gray-900">{adjustment.agentUserId}</td>
                      <td className={adjustment.deltaAmount < 0 ? 'tabular whitespace-nowrap text-right font-medium text-red-700' : 'tabular whitespace-nowrap text-right font-medium text-emerald-700'}>{formatSom(adjustment.deltaAmount)}</td>
                      <td><span className={`badge ${ADJUSTMENT_STATUS_BADGE[adjustment.status] || 'badge-neutral'}`}>{adjustment.status}</span></td>
                      <td className="text-right">
                        {isAdmin && adjustment.status === 'pending' ? (
                          <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => void handleReviewAdjustment(adjustment.id, 'approve')} className="btn btn-sm btn-success">
                              <IconCheck className="h-4 w-4" stroke={1.8} />
                              Tasdiqlash
                            </button>
                            <button type="button" onClick={() => void handleReviewAdjustment(adjustment.id, 'reject')} className="btn btn-sm btn-danger-soft">
                              <IconX className="h-4 w-4" stroke={1.8} />
                              Rad etish
                            </button>
                          </div>
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <h2 className="section-title">Bonus qatorlari tafsiloti</h2>
            {bonusRows.length ? <span className="badge badge-neutral tabular">{bonusRows.length}</span> : null}
          </div>
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
                    <th className="bg-gray-50 text-left">Debug: Kategoriya</th>
                    <th className="bg-gray-50 text-right">Debug: Fakt</th>
                    <th className="bg-gray-50 text-right">Debug: Foiz</th>
                    <th className="bg-gray-50 text-left">Debug: Fallback</th>
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
                      <td className="whitespace-nowrap bg-gray-50/60 text-xs text-gray-500">{row.bonusDebug?.category || '-'}</td>
                      <td className="tabular whitespace-nowrap bg-gray-50/60 text-right text-xs text-gray-500">{row.bonusDebug?.closedCount ?? '-'}</td>
                      <td className="tabular whitespace-nowrap bg-gray-50/60 text-right text-xs text-gray-500">
                        {row.bonusDebug?.appliedPercent == null ? '-' : `${row.bonusDebug.appliedPercent}%`}
                      </td>
                      <td className="whitespace-nowrap bg-gray-50/60 text-xs text-gray-500">{row.bonusDebug?.usedFallback ? 'ha' : 'yo\'q'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={IconListDetails} title="Tanlangan filtr bo'yicha bonus tafsiloti topilmadi." className="m-2" />
          )}
        </div>
      </section>
    </div>
  );
}
