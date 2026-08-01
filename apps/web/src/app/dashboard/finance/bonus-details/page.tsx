'use client';

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

type DashboardRange = 'today' | 'week' | 'month' | 'last_week' | 'last_month' | 'custom';
const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);

function getTashkentToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function getPreviousWeekRange() {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
  local.setHours(0, 0, 0, 0);
  const day = local.getDay();
  const daysSinceMonday = (day + 6) % 7;
  const currentWeekMonday = new Date(local);
  currentWeekMonday.setDate(local.getDate() - daysSinceMonday);
  const previousWeekMonday = new Date(currentWeekMonday);
  previousWeekMonday.setDate(currentWeekMonday.getDate() - 7);
  const previousWeekSunday = new Date(currentWeekMonday);
  previousWeekSunday.setDate(currentWeekMonday.getDate() - 1);

  const toIso = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dayValue = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${dayValue}`;
  };

  return {
    dateFrom: toIso(previousWeekMonday),
    dateTo: toIso(previousWeekSunday),
  };
}

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

function getCurrentMonthRange() {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
  local.setHours(0, 0, 0, 0);
  const monthStart = new Date(local.getFullYear(), local.getMonth(), 1);

  const toIso = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const dayValue = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${dayValue}`;
  };

  return {
    dateFrom: toIso(monthStart),
    dateTo: toIso(local),
  };
}

function getPreviousMonthRange() {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tashkent' }));
  const year = local.getFullYear();
  const month = local.getMonth();
  const previousMonthStart = new Date(year, month - 1, 1);
  const previousMonthEnd = new Date(year, month, 0);

  const toIso = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  return {
    dateFrom: toIso(previousMonthStart),
    dateTo: toIso(previousMonthEnd),
  };
}

function formatAmount(value: number | null | undefined): string {
  return `${new Intl.NumberFormat('ru-RU').format(value ?? 0)} so'm`;
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
      return getCurrentMonthRange();
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
    () => agentSummary.length || new Set(bonusRows.map((row: any) => row.managerUserId)).size,
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
        setOperationMessage(`${operationMonth}: ${formatAmount(result.totalBonusAmount)} hisoblandi.`);
      } else if (action === 'finalize') {
        const result = await finalizeMonth.mutateAsync({ month: operationMonth });
        setOperationMessage(`${operationMonth} yakunlandi: ${formatAmount(result.totalBonusAmount)}.`);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Bonus tafsiloti</h1>
          <p className="mt-1 text-sm text-gray-500">
            Bonus hisobiga ta'sir qilayotgan qatorlar (debug ustunlari bilan).
          </p>
        </div>
        <Link
          href="/dashboard/finance"
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Moliya sahifasiga qaytish
        </Link>
      </div>

      {!isAgentOnly ? (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Bonus oyini yakunlash</h2>
              <p className="mt-1 text-sm text-gray-500">Yakunlangan oylar snapshot bo&apos;lib saqlanadi; keyingi o&apos;zgarishlar tuzatish yaratadi.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input type="month" value={operationMonth} onChange={(event) => setOperationMonth(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
              {isAdmin ? (
                <>
                  <button type="button" onClick={() => void runMonthAction('preview')} className="rounded-md border border-blue-300 px-3 py-2 text-sm text-blue-700">Ko&apos;rib chiqish</button>
                  <button type="button" onClick={() => void runMonthAction('finalize')} className="rounded-md bg-blue-600 px-3 py-2 text-sm text-white">Yakunlash</button>
                  <button type="button" onClick={() => void runMonthAction('reconcile')} className="rounded-md border border-amber-300 px-3 py-2 text-sm text-amber-700">Qayta solishtirish</button>
                </>
              ) : null}
            </div>
          </div>
          {operationMessage ? <p className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">{operationMessage}</p> : null}
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {(bonusOperationsQuery.data?.snapshots || []).slice(0, 6).map((snapshot) => (
              <div key={snapshot.id} className="rounded-md border border-gray-200 p-3 text-sm">
                <p className="font-medium text-gray-900">{snapshot.month}</p>
                <p className="text-gray-600">{formatAmount(snapshot.totalBonusAmount)}</p>
                <p className="text-xs text-emerald-700">Yakunlangan</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!isAgentOnly && (bonusOperationsQuery.data?.adjustments.length || 0) > 0 ? (
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold text-gray-900">Bonus tuzatishlari</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50"><tr>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Manba oy</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Agent</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Farq</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Holat</th>
                <th className="px-3 py-2 text-left text-xs uppercase text-gray-500">Amal</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {bonusOperationsQuery.data?.adjustments.map((adjustment) => (
                  <tr key={adjustment.id}>
                    <td className="px-3 py-2 text-sm text-gray-700">{adjustment.sourceMonth}</td>
                    <td className="px-3 py-2 text-sm text-gray-700">{adjustment.agentUserId}</td>
                    <td className={`px-3 py-2 text-sm font-medium ${adjustment.deltaAmount < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatAmount(adjustment.deltaAmount)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700">{adjustment.status}</td>
                    <td className="px-3 py-2 text-sm">
                      {isAdmin && adjustment.status === 'pending' ? (
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void handleReviewAdjustment(adjustment.id, 'approve')} className="text-emerald-700">Tasdiqlash</button>
                          <button type="button" onClick={() => void handleReviewAdjustment(adjustment.id, 'reject')} className="text-red-700">Rad etish</button>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg bg-white p-6 shadow">
        <div className={`grid grid-cols-1 gap-3 ${isAgentOnly ? 'md:grid-cols-[180px_180px_180px_1fr]' : 'md:grid-cols-[180px_180px_180px_1fr_1fr]'}`}>
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as DashboardRange)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="today">Bugun</option>
            <option value="week">Hafta</option>
            <option value="month">Oy</option>
            <option value="last_week">O'tgan hafta</option>
            <option value="last_month">O'tgan oy</option>
            <option value="custom">Ixtiyoriy</option>
          </select>

          <input
            type="date"
            value={range === 'custom' ? dateFrom : effectiveDateRange.dateFrom}
            disabled={range !== 'custom'}
            onChange={(event) => setDateFrom(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
          />
          <input
            type="date"
            value={range === 'custom' ? dateTo : effectiveDateRange.dateTo}
            disabled={range !== 'custom'}
            onChange={(event) => setDateTo(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
          />

          <select
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Barcha kurslar</option>
            {courseOptions.map((course: any) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>

          {!isAgentOnly && (
            <select
              value={managerUserId}
              onChange={(event) => setManagerUserId(event.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Barcha agentlar</option>
              {managerOptions.map((manager: any) => (
                <option key={manager.id} value={manager.id}>
                  {manager.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {bonusDetailsQuery.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {bonusDetailsQuery.error.message || "Bonus tafsilotlarini yuklashda xatolik."}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Agentlar</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{bonusAgentCount}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Filtr bo'yicha tushum</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{formatAmount(summaryTotals?.incomeAmount ?? bonusTotals?.incomeAmount)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Yopilgan tushum (kelishuv)</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{formatAmount(summaryTotals?.closedAgreementAmount)}</p>
        </div>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Agentlar bo'yicha bonuslar</h2>
          <p className="mt-1 text-sm text-gray-500">
            Tushum, yopilgan tushum va bonuslar kesimi (tanlangan davr bo'yicha).
          </p>
        </div>
        {bonusDetailsQuery.isLoading ? (
          <LoadingBlock message="Yuklanmoqda..." />
        ) : agentSummary.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Agent</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Yopilgan tushum</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Jami bonus</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Online</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Offline</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Intensiv</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Qo'shimcha xizmat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {agentSummary.map((row: any) => (
                  <tr key={row.managerUserId}>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.managerLabel}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.incomeAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.closedAgreementAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">{formatAmount(row.totalBonusAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.bonusByCategory?.online)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.bonusByCategory?.offline)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.bonusByCategory?.intensive)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.bonusByCategory?.additional_service)}</td>
                  </tr>
                ))}
                {summaryTotals && (
                  <tr className="bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">Jami</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">{formatAmount(summaryTotals.incomeAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">{formatAmount(summaryTotals.closedAgreementAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">{formatAmount(summaryTotals.totalBonusAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">{formatAmount(summaryTotals.bonusByCategory?.online)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">{formatAmount(summaryTotals.bonusByCategory?.offline)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">{formatAmount(summaryTotals.bonusByCategory?.intensive)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">{formatAmount(summaryTotals.bonusByCategory?.additional_service)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-600">Tanlangan filtr bo'yicha agentlar kesimi topilmadi.</p>
        )}
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">Bonus qatorlari tafsiloti</h2>
          <button
            type="button"
            onClick={() => void handleDownloadBonusDetails()}
            disabled={exportBonusDetails.isLoading}
            className="inline-flex items-center rounded-md border border-blue-300 bg-white px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exportBonusDetails.isLoading ? 'Tayyorlanmoqda...' : 'XLS yuklab olish'}
          </button>
        </div>
        {exportError ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{exportError}</p> : null}
        {exportSuccess ? <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{exportSuccess}</p> : null}
        {bonusDetailsQuery.isLoading ? (
          <LoadingBlock message="Yuklanmoqda..." />
        ) : bonusRows.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Sana</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Turi</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mijoz</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Agent</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kurs/Tarif/Subtarif</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kelishuv summasi</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Qolgan qarz</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Hisoblangan bonus</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Debug: Kategoriya</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Debug: Fakt</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Debug: Foiz</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Debug: Fallback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {bonusRows.map((row: any) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {new Date(row.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {row.type === 'repayment' ? "Qarzdorlik to'lovi" : 'Yangi sotuv'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {row.customerNumber} - {row.customerName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.managerLabel}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {[row.courseName, row.tariffName, row.subTariffName].filter(Boolean).join(' / ') || '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.agreementAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.paymentAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.remainingDebtAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm font-medium text-gray-900">
                      {row.isLastPayment ? formatAmount(row.calculatedBonus) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-700">{row.bonusDebug?.category || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-700">{row.bonusDebug?.closedCount ?? '-'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-700">
                      {row.bonusDebug?.appliedPercent == null ? '-' : `${row.bonusDebug.appliedPercent}%`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-700">{row.bonusDebug?.usedFallback ? 'ha' : 'yo\'q'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-600">Tanlangan filtr bo'yicha bonus tafsiloti topilmadi.</p>
        )}
      </div>
    </div>
  );
}
