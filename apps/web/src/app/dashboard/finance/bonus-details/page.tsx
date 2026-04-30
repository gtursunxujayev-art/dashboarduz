'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type DashboardRange = 'today' | 'week' | 'month' | 'last_week' | 'last_month' | 'custom';

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
  const isAgentOnly = roles.includes('Agent')
    && !roles.includes('Admin')
    && !roles.includes('Manager')
    && !roles.includes('TeamLeader')
    && !roles.includes('Finance');

  const [range, setRange] = useState<DashboardRange>('month');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [courseId, setCourseId] = useState('');
  const [managerUserId, setManagerUserId] = useState('');

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
          <p className="text-sm text-gray-600">Yuklanmoqda...</p>
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
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Bonus qatorlari tafsiloti</h2>
        </div>
        {bonusDetailsQuery.isLoading ? (
          <p className="text-sm text-gray-600">Yuklanmoqda...</p>
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
