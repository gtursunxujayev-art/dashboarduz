'use client';

import { IconAlertTriangle, IconArrowRight, IconBook, IconListDetails, IconReceiptRefund, IconReportMoney, IconUserDollar, IconUsers } from '@tabler/icons-react';
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
import { ComparisonCard, FinanceHero, ForecastPanel } from './_components/finance-cockpit';
import { FinanceFilterBar } from './_components/finance-filter-bar';
import { AGENT_ROLES } from './_components/finance-helpers';

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

      {financeQuery.error && (
        <div className="alert alert-error">
          {financeQuery.error.message || 'Moliya ma\'lumotlarini yuklashda xatolik.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <FinanceHero
          totalIncomeAmount={totals?.totalIncomeAmount}
          newSalesCount={totals?.newSalesCount}
          repaymentCount={totals?.repaymentCount}
          debtorsCount={totals?.debtorsCount}
          dateFrom={effectiveDateRange.dateFrom}
          dateTo={effectiveDateRange.dateTo}
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:auto-rows-fr xl:grid-cols-1">
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
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ComparisonCard title="Bu oy (hozirgacha) vs o'tgan oy (shu sana)" data={comparisons?.monthToDateVsLastMonthToDate} />
        <ComparisonCard title="Bu oy (hozirgacha) vs o'tgan yil shu oy" data={comparisons?.monthToDateVsLastYearSameMonth} />
        <ComparisonCard title="YTD: Bu yil vs O‘tgan yil" data={comparisons?.ytdVsLastYearYtd} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ForecastPanel
          title="Oy yakuni prognozi"
          description={<>Hozirgi kunlik sur&apos;at asosida oy oxiri prognozi.</>}
          block={forecast?.monthEnd}
          currentLabel="Hozirgacha"
          data={monthSeries}
          labelFormatter={(label: any) => `${label}-kun`}
        />
        <ForecastPanel
          title="Yil yakuni prognozi"
          description="YTD dinamikasi va yil oxirigacha prognoz."
          block={forecast?.yearEnd}
          currentLabel="YTD"
          data={yearSeries}
        />
      </div>

      <section className="panel">
        <div className="panel-header items-start">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <IconUserDollar className="h-[18px] w-[18px]" stroke={1.6} />
            </span>
            <div className="min-w-0">
              <h2 className="section-title">Agentlar maoshi</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Tanlangan davr bo'yicha umumiy maosh, fiks, KPI, qo'shimcha bonus va asosiy bonus.
              </p>
            </div>
          </div>
          {salaryByAgent.length ? <span className="badge badge-neutral tabular">{salaryByAgent.length}</span> : null}
        </div>
        <div className="panel-body space-y-5">
          <div className="grid grid-cols-1 overflow-hidden rounded-[16px] bg-gray-50 sm:grid-cols-2 xl:grid-cols-4">
            <div className="bg-blue-50 p-4">
              <p className="caption text-blue-700">Hisoblangan maosh</p>
              <p className="tabular mt-2 text-xl font-semibold text-blue-900">{formatSom(salaryTotals?.salary)}</p>
              <p className="tabular mt-1 text-xs text-blue-700">
                {effectiveDateRange.dateFrom} - {effectiveDateRange.dateTo}
              </p>
            </div>
            <div className="border-t border-gray-200/70 p-4 sm:border-l sm:border-t-0">
              <p className="caption">Fiks maosh</p>
              <p className="tabular mt-2 text-xl font-semibold text-gray-900">{formatSom(salaryTotals?.fixedSalary)}</p>
            </div>
            <div className="border-t border-gray-200/70 p-4 xl:border-l xl:border-t-0">
              <p className="caption">Asosiy bonus</p>
              <p className="tabular mt-2 text-xl font-semibold text-gray-900">{formatSom(salaryTotals?.bonus)}</p>
            </div>
            <div className="border-t border-gray-200/70 p-4 sm:border-l xl:border-t-0">
              <p className="caption">Qo'shimcha bonuslar</p>
              <p className="tabular mt-2 text-xl font-semibold text-gray-900">{formatSom(salaryTotals?.planBonus)}</p>
              <p className="tabular mt-1 text-xs text-gray-500">KPI: {formatSom(salaryTotals?.kpi)}</p>
            </div>
          </div>

          {salaryQuery.isLoading ? (
            <LoadingBlock />
          ) : salaryByAgent.length ? (
            <div className="-mx-2 overflow-x-auto sm:-mx-3">
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
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section className="panel">
          <div className="panel-header">
            <div className="flex items-center gap-2.5">
              <h2 className="section-title">Kurslar bo'yicha tushum</h2>
              {incomeByCourse.length ? <span className="badge badge-neutral tabular">{incomeByCourse.length}</span> : null}
            </div>
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
                        <td>
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500" aria-hidden="true">
                              <IconBook className="h-4 w-4" stroke={1.8} />
                            </span>
                            <span className="font-medium text-gray-900">{row.courseName}</span>
                          </div>
                        </td>
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
        </section>

        <section className="panel">
          <div className="panel-header">
            <div className="flex items-center gap-2.5">
              <h2 className="section-title">Agentlar bo'yicha tushum</h2>
              {incomeByAgent.length ? <span className="badge badge-neutral tabular">{incomeByAgent.length}</span> : null}
            </div>
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
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2.5">
            <h2 className="section-title">So'nggi tushumlar</h2>
            {recentIncomes.length ? <span className="badge badge-neutral tabular">{recentIncomes.length}</span> : null}
          </div>
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
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <UserAvatar name={income.managerLabel || '?'} size="sm" />
                          <span>{income.managerLabel}</span>
                        </div>
                      </td>
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
      </section>

      <section className="panel flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
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
      </section>
    </div>
  );
}
