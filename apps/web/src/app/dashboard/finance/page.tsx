'use client';

import { IconAlertTriangle, IconArrowRight, IconBook, IconCalendar, IconCash, IconListDetails, IconMinus, IconReceiptRefund, IconRepeat, IconReportMoney, IconShoppingCart, IconTrendingDown, IconTrendingUp, IconUserDollar, IconUserExclamation, IconUsers } from '@tabler/icons-react';
import { getIncomeStatusBadge } from '@/components/dashboard/income-status-badge';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useAuth } from '@/contexts/auth-context';
import { useDashboardAiPageContext } from '@/contexts/dashboard-ai-context';
import { type ExtendedDashboardRange as DashboardRange, getPreviousMonthRange, getPreviousWeekRange, getTashkentDateShift, getTashkentToday } from '@/lib/date-range';
import { formatSom } from '@/lib/format';
import { trpc } from '@/lib/trpc';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AGENT_ROLES, formatCompactAmount, getTrendMeta } from './_components/finance-helpers';

const RANGE_OPTIONS: { value: DashboardRange; label: string }[] = [
  { value: 'today', label: 'Bugun' },
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Oy' },
  { value: 'last_week', label: "O'tgan hafta" },
  { value: 'last_month', label: "O'tgan oy" },
  { value: 'custom', label: 'Ixtiyoriy' },
];
const CHART_TICK = { fontSize: 11, fill: 'rgb(var(--gray-500))' };
const CHART_TOOLTIP_STYLE = { borderRadius: 10, border: '1px solid rgb(var(--gray-200))', background: 'rgb(var(--surface))', fontSize: 12 };

export default function FinancePage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const canSeeRefundAnalytics = roles.includes('Admin') || roles.includes('Finance');
  const isAgentOnly = roles.some((role) => AGENT_ROLES.has(role))
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
    if (range === 'last_week') {
      return getPreviousWeekRange();
    }
    if (range === 'last_month') {
      return getPreviousMonthRange();
    }
    if (range === 'custom') {
      return { dateFrom, dateTo };
    }
    if (range === 'today') {
      const today = getTashkentToday();
      return { dateFrom: today, dateTo: today };
    }
    if (range === 'week') {
      return { dateFrom: getTashkentDateShift(-6), dateTo: getTashkentToday() };
    }
    return { dateFrom: getTashkentDateShift(-29), dateTo: getTashkentToday() };
  }, [range, dateFrom, dateTo]);

  const financeQueryInput = useMemo(() => ({
    range: (range === 'last_week' || range === 'last_month') ? 'custom' : range,
    dateFrom: range === 'custom' || range === 'last_week' || range === 'last_month' ? effectiveDateRange.dateFrom : undefined,
    dateTo: range === 'custom' || range === 'last_week' || range === 'last_month' ? effectiveDateRange.dateTo : undefined,
    courseId: courseId || undefined,
    managerUserId: isAgentOnly ? undefined : (managerUserId || undefined),
  }), [range, effectiveDateRange, courseId, isAgentOnly, managerUserId]);

  const financeQuery = trpc.dashboard.financeSummary.useQuery(
    financeQueryInput,
    {
      retry: 1,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: 5 * 60 * 1000,
    },
  );

  const salaryQuery = trpc.dashboard.salarySummary.useQuery(
    {
      range: (range === 'last_week' || range === 'last_month') ? 'custom' : range,
      dateFrom: effectiveDateRange.dateFrom,
      dateTo: effectiveDateRange.dateTo,
      managerUserId: isAgentOnly ? undefined : (managerUserId || undefined),
      prorateFixedSalary: true,
    },
    {
      enabled: financeQuery.isSuccess,
      retry: 1,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchInterval: 5 * 60 * 1000,
    },
  );

  const totals = financeQuery.data?.totals;
  const managerOptions = useMemo(() => financeQuery.data?.managerOptions || [], [financeQuery.data]);
  const courseOptions = useMemo(() => financeQuery.data?.courseOptions || [], [financeQuery.data]);
  const recentIncomes = useMemo(() => financeQuery.data?.recentIncomes || [], [financeQuery.data]);
  const incomeByCourse = useMemo(() => financeQuery.data?.incomeByCourse || [], [financeQuery.data]);
  const incomeByAgent = useMemo(() => financeQuery.data?.incomeByAgent || [], [financeQuery.data]);
  const comparisons = financeQuery.data?.comparisons;
  const forecast = financeQuery.data?.forecast;
  const monthSeries = useMemo(() => forecast?.monthSeries || [], [forecast]);
  const yearSeries = useMemo(() => forecast?.yearSeries || [], [forecast]);
  const salaryTotals = salaryQuery.data?.totals;
  const salaryByAgent = useMemo(() => salaryQuery.data?.byAgent || [], [salaryQuery.data]);

  const aiPageContext = useMemo(() => ({
    pageKey: '/dashboard/finance',
    rangeMode: range,
    dateFrom: effectiveDateRange.dateFrom,
    dateTo: effectiveDateRange.dateTo,
    filters: {
      courseId: courseId || null,
      managerUserId: managerUserId || null,
      isAgentOnly,
    },
    metrics: {
      totalIncomeAmount: totals?.totalIncomeAmount ?? 0,
      totalDebtAmount: totals?.totalDebtAmount ?? 0,
      debtorsCount: totals?.debtorsCount ?? 0,
      newSalesCount: totals?.newSalesCount ?? 0,
      repaymentCount: totals?.repaymentCount ?? 0,
      refundAmount: totals?.refundAmount ?? 0,
      salaryAfterAttendance: salaryTotals?.salaryAfterAttendance ?? 0,
      salaryByAgentCount: salaryByAgent.length,
      courseBreakdownCount: incomeByCourse.length,
      agentBreakdownCount: incomeByAgent.length,
    },
  }), [
    range,
    effectiveDateRange.dateFrom,
    effectiveDateRange.dateTo,
    courseId,
    managerUserId,
    isAgentOnly,
    totals?.totalIncomeAmount,
    totals?.totalDebtAmount,
    totals?.debtorsCount,
    totals?.newSalesCount,
    totals?.repaymentCount,
    totals?.refundAmount,
    salaryTotals?.salaryAfterAttendance,
    salaryByAgent.length,
    incomeByCourse.length,
    incomeByAgent.length,
  ]);
  useDashboardAiPageContext(aiPageContext);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Moliya"
        description="Kurs, agent va sana bo'yicha tushum hamda qarzdorlik tahlili."
      >
        {isAgentOnly && (
          <p className="alert alert-info">
            Agent rejimi: bu sahifada faqat o'zingizga tegishli moliyaviy ma'lumotlar ko'rsatiladi.
          </p>
        )}
      </PageHeader>

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

          <div className={`grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 ${isAgentOnly ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
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
              {courseOptions.map((course: any) => (
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
                {managerOptions.map((manager: any) => (
                  <option key={manager.id} value={manager.id}>{manager.label}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {financeQuery.error && (
        <div className="alert alert-error">
          {financeQuery.error.message || 'Moliya ma\'lumotlarini yuklashda xatolik.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile label="Jami tushum" value={formatSom(totals?.totalIncomeAmount)} icon={IconCash} tone="blue" />
        <StatTile label="Yangi sotuvlar" value={totals?.newSalesCount ?? 0} icon={IconShoppingCart} />
        <StatTile label="Qayta to'lovlar" value={totals?.repaymentCount ?? 0} icon={IconRepeat} />
        <StatTile label="Qarzdorlar" value={totals?.debtorsCount ?? 0} icon={IconUserExclamation} tone="amber" />
        <StatTile label="Jami qarzdorlik" value={formatSom(totals?.totalDebtAmount)} icon={IconAlertTriangle} tone="amber" />
        {canSeeRefundAnalytics && (
          <StatTile
            label="Qaytarilgan tushum"
            value={formatSom(totals?.refundAmount)}
            hint={`${totals?.refundCount ?? 0} ta qaytarish`}
            icon={IconReceiptRefund}
            tone="red"
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[
          { title: "Bu oy (hozirgacha) vs o'tgan oy (shu sana)", data: comparisons?.monthToDateVsLastMonthToDate },
          { title: "Bu oy (hozirgacha) vs o'tgan yil shu oy", data: comparisons?.monthToDateVsLastYearSameMonth },
          { title: 'YTD: Bu yil vs O‘tgan yil', data: comparisons?.ytdVsLastYearYtd },
        ].map((item) => {
          const trend = getTrendMeta(item.data?.direction);
          const TrendIcon = item.data?.direction === 'up' ? IconTrendingUp : item.data?.direction === 'down' ? IconTrendingDown : IconMinus;
          return (
            <div key={item.title} className="panel flex flex-col p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13px] font-medium text-gray-500">{item.title}</p>
                <span className={`badge ${trend.badgeClass}`}>
                  <TrendIcon className="h-3.5 w-3.5" stroke={2} />
                  {trend.label}
                </span>
              </div>
              <div className="mt-3 space-y-1">
                <p className="text-sm text-gray-600">Joriy: <span className="tabular font-semibold text-gray-900">{formatSom(item.data?.currentValue)}</span></p>
                <p className="text-sm text-gray-600">Taqqoslash: <span className="tabular font-semibold text-gray-900">{formatSom(item.data?.previousValue)}</span></p>
              </div>
              <p className="tabular mt-auto border-t border-gray-100 pt-3 text-sm font-semibold text-gray-900">
                {trend.sign}{formatSom(item.data?.diffAmount)} ({trend.sign}{Number(item.data?.diffPercent || 0).toFixed(2)}%)
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {[
          {
            key: 'month',
            title: 'Oy yakuni prognozi',
            description: <>Hozirgi kunlik sur&apos;at asosida oy oxiri prognozi.</>,
            block: forecast?.monthEnd,
            currentLabel: 'Hozirgacha',
            data: monthSeries,
            labelFormatter: (label: any) => `${label}-kun`,
          },
          {
            key: 'year',
            title: 'Yil yakuni prognozi',
            description: 'YTD dinamikasi va yil oxirigacha prognoz.',
            block: forecast?.yearEnd,
            currentLabel: 'YTD',
            data: yearSeries,
            labelFormatter: undefined,
          },
        ].map((chart) => (
          <div key={chart.key} className="panel">
            <div className="panel-header items-start">
              <div className="min-w-0">
                <h2 className="section-title">{chart.title}</h2>
                <p className="mt-0.5 text-sm text-gray-500">{chart.description}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Prognoz</p>
                <p className="tabular text-lg font-semibold text-gray-900">{formatSom(chart.block?.projectedTotal)}</p>
              </div>
            </div>
            <div className="panel-body space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="panel-inset px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="h-2 w-2 rounded-full bg-[#3964f3]" aria-hidden="true" />
                    {chart.currentLabel}
                  </p>
                  <p className="tabular mt-0.5 text-sm font-semibold text-gray-900">{formatSom(chart.block?.currentToDate)}</p>
                </div>
                <div className="panel-inset px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                    Qolgan potensial
                  </p>
                  <p className="tabular mt-0.5 text-sm font-semibold text-gray-900">{formatSom(chart.block?.remainingAmount)}</p>
                </div>
              </div>

              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chart.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--gray-200))" vertical={false} />
                    <XAxis dataKey="label" tick={CHART_TICK} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(value) => formatCompactAmount(value)} tick={CHART_TICK} axisLine={false} tickLine={false} width={64} />
                    <Tooltip
                      formatter={(value: any, name: string) => [formatSom(Number(value || 0)), name === 'actual' ? 'Amaldagi' : 'Prognoz']}
                      labelFormatter={chart.labelFormatter}
                      contentStyle={CHART_TOOLTIP_STYLE}
                    />
                    <Line type="monotone" dataKey="actual" name="actual" stroke="#3964f3" strokeWidth={2.5} dot={false} connectNulls={false} />
                    <Line type="monotone" dataKey="forecast" name="forecast" stroke="#F59E0B" strokeWidth={2} dot={false} strokeDasharray="6 4" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h2 className="section-title">Agentlar maoshi</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Tanlangan davr bo'yicha umumiy maosh, fiks, KPI, qo'shimcha bonus va asosiy bonus.
            </p>
          </div>
        </div>
        <div className="panel-body space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[12px] bg-blue-50 p-4">
              <p className="text-[13px] font-medium text-blue-700">Hisoblangan maosh</p>
              <p className="tabular mt-1 text-xl font-semibold text-blue-900">{formatSom(salaryTotals?.salary)}</p>
              <p className="tabular mt-1 text-xs text-blue-700">
                {effectiveDateRange.dateFrom} - {effectiveDateRange.dateTo}
              </p>
            </div>
            <div className="panel-inset">
              <p className="text-[13px] font-medium text-gray-500">Fiks maosh</p>
              <p className="tabular mt-1 text-xl font-semibold text-gray-900">{formatSom(salaryTotals?.fixedSalary)}</p>
            </div>
            <div className="panel-inset">
              <p className="text-[13px] font-medium text-gray-500">Asosiy bonus</p>
              <p className="tabular mt-1 text-xl font-semibold text-gray-900">{formatSom(salaryTotals?.bonus)}</p>
            </div>
            <div className="panel-inset">
              <p className="text-[13px] font-medium text-gray-500">Qo'shimcha bonuslar</p>
              <p className="tabular mt-1 text-xl font-semibold text-gray-900">{formatSom(salaryTotals?.planBonus)}</p>
              <p className="tabular mt-1 text-xs text-gray-500">KPI: {formatSom(salaryTotals?.kpi)}</p>
            </div>
          </div>

          {salaryQuery.isLoading ? (
            <LoadingBlock />
          ) : salaryByAgent.length ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left">Agent</th>
                    <th className="text-right">Umumiy maosh</th>
                    <th className="text-right">Fiks</th>
                    <th className="text-right">KPI</th>
                    <th className="text-right">Qo'shimcha bonus</th>
                    <th className="text-right">Asosiy bonus</th>
                  </tr>
                </thead>
                <tbody>
                  {salaryByAgent.map((row: any) => (
                    <tr key={row.userId}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <UserAvatar name={row.name || '?'} size="sm" />
                          <span className="whitespace-nowrap font-medium text-gray-900">{row.name}</span>
                        </div>
                      </td>
                      <td className="tabular whitespace-nowrap text-right font-semibold text-gray-900">{formatSom(row.totalSalary)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.fixedSalary)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.kpiAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.planBonusAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.bonusAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={IconUserDollar} title="Tanlangan filtr bo'yicha maosh ma'lumoti topilmadi." />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="panel">
          <div className="panel-header">
            <h2 className="section-title">Kurslar bo'yicha tushum</h2>
            {incomeByCourse.length ? <span className="badge badge-neutral tabular">{incomeByCourse.length}</span> : null}
          </div>
          <div className="p-2 sm:p-3">
            {financeQuery.isLoading ? (
              <LoadingBlock className="m-2" />
            ) : incomeByCourse.length ? (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-left">Kurs</th>
                      <th className="text-right">Soni</th>
                      <th className="text-right">Tushum</th>
                      <th className="text-right">Shartnoma</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomeByCourse.map((row: any) => (
                      <tr key={row.courseName}>
                        <td className="font-medium text-gray-900">{row.courseName}</td>
                        <td className="tabular text-right">{row.count}</td>
                        <td className="tabular whitespace-nowrap text-right font-semibold text-gray-900">{formatSom(row.amount)}</td>
                        <td className="tabular whitespace-nowrap text-right">{formatSom(row.agreementAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={IconBook} title="Tanlangan filtr bo'yicha kurs tushumi topilmadi." className="m-2" />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 className="section-title">Agentlar bo'yicha tushum</h2>
            {incomeByAgent.length ? <span className="badge badge-neutral tabular">{incomeByAgent.length}</span> : null}
          </div>
          <div className="p-2 sm:p-3">
            {financeQuery.isLoading ? (
              <LoadingBlock className="m-2" />
            ) : incomeByAgent.length ? (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-left">Agent</th>
                      <th className="text-right">Soni</th>
                      <th className="text-right">Tushum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomeByAgent.map((row: any) => (
                      <tr key={row.agent}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <UserAvatar name={row.agent || '?'} size="sm" />
                            <span className="font-medium text-gray-900">{row.agent}</span>
                          </div>
                        </td>
                        <td className="tabular text-right">{row.count}</td>
                        <td className="tabular whitespace-nowrap text-right font-semibold text-gray-900">{formatSom(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={IconUsers} title="Tanlangan filtr bo'yicha agent tushumi topilmadi." className="m-2" />
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2 className="section-title">So'nggi tushumlar</h2>
          {recentIncomes.length ? <span className="badge badge-neutral tabular">{recentIncomes.length}</span> : null}
        </div>
        <div className="p-2 sm:p-3">
          {financeQuery.isLoading ? (
            <LoadingBlock className="m-2" />
          ) : recentIncomes.length ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left">Sana</th>
                    <th className="text-left">Turi</th>
                    <th className="text-left">Mijoz</th>
                    <th className="text-left">Agent</th>
                    <th className="text-left">Kurs/Tarif</th>
                    <th className="text-left">Holat</th>
                    <th className="text-right">To'lov</th>
                    <th className="text-right">Qoldiq qarz</th>
                  </tr>
                </thead>
                <tbody>
                  {recentIncomes.map((income: any) => (
                    <tr key={income.id}>
                      <td className="tabular whitespace-nowrap text-gray-600">
                        {new Date(income.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={income.type === 'repayment' ? 'badge badge-amber' : 'badge badge-blue'}>
                          {income.type === 'repayment' ? 'Qarzdorlik' : 'Yangi sotuv'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap font-medium text-gray-900">
                        {income.customerNumber} - {income.customerName}
                      </td>
                      <td className="whitespace-nowrap">{income.managerLabel}</td>
                      <td className="whitespace-nowrap">
                        {[income.courseName, income.tariffName].filter(Boolean).join(' / ') || '-'}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className={`badge ${getIncomeStatusBadge(income.lifecycleStatus, { darkMode: false }).className}`}>
                          {getIncomeStatusBadge(income.lifecycleStatus, { darkMode: false }).label}
                        </span>
                      </td>
                      <td className="tabular whitespace-nowrap text-right font-semibold text-gray-900">{formatSom(income.paymentAmount)}</td>
                      <td className="tabular whitespace-nowrap text-right">{formatSom(income.remainingDebtAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={IconReportMoney} title="Tanlangan filtr bo'yicha tushum yo'q." className="m-2" />
          )}
        </div>
      </div>

      <div className="panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
            <IconListDetails className="h-5 w-5" stroke={1.6} />
          </span>
          <div className="min-w-0">
            <h2 className="section-title">Bonus tafsiloti</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Bonus tafsilotini alohida sahifada ko&apos;ring (real-time debug ustunlari bilan).
            </p>
          </div>
        </div>
        <Link href="/dashboard/finance/bonus-details" className="btn btn-soft inline-flex flex-shrink-0">
          Bonus tafsilotiga o&apos;tish
          <IconArrowRight className="h-4 w-4" stroke={1.8} />
        </Link>
      </div>
    </div>
  );
}
