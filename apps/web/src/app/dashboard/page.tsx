'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { trpc } from '@/lib/trpc';
import MultiSelectDropdown from '@/components/dashboard/multi-select-dropdown';

type DashboardRange = 'today' | 'week' | 'month' | 'custom';
const RANGE_OPTIONS: DashboardRange[] = ['today', 'week', 'month', 'custom'];

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

function formatAmount(value?: number | null): string {
  return `${new Intl.NumberFormat('ru-RU').format(value ?? 0)} so'm`;
}

function formatDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) {
    return '-';
  }
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${hours} soat ${minutes} daqiqa ${remainingSeconds} soniya`;
}

function formatDurationCompact(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) {
    return '-';
  }
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  return `${hours} soat ${minutes} daqiqa`;
}

function renderMetricValue(value?: number | null, suffix = ''): string {
  if (value === null || value === undefined) {
    return '-';
  }
  return `${value}${suffix}`;
}

function getRangeLabel(range: DashboardRange): string {
  if (range === 'week') {
    return 'Hafta';
  }
  if (range === 'month') {
    return 'Oy';
  }
  if (range === 'custom') {
    return 'Ixtiyoriy';
  }
  return 'Bugun';
}

export default function DashboardPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const [range, setRange] = useState<DashboardRange>('today');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [pipelineIds, setPipelineIds] = useState<string[]>([]);
  const isAdmin = Boolean(roles.includes('Admin'));
  const isAgentOnly = Boolean(
    roles.includes('Agent')
      && !roles.includes('Admin')
      && !roles.includes('Manager')
      && !roles.includes('Finance'),
  );
  const hasFinanceRole = Boolean(roles.includes('Finance'));
  const showSalarySection = isAgentOnly || hasFinanceRole;
  const isFinanceOnly = Boolean(
    hasFinanceRole
      && !roles.includes('Admin')
      && !roles.includes('Manager')
      && !roles.includes('Agent'),
  );
  const isTashkiliyOnly = Boolean(
    roles.includes('Tashkiliy')
      && !roles.includes('Admin')
      && !roles.includes('Manager')
      && !roles.includes('Agent')
      && !roles.includes('Finance'),
  );

  const amoPipelinesQuery = trpc.integrations.getAmoCRMPipelines.useQuery(undefined, {
    retry: false,
    enabled: isAdmin && !isFinanceOnly,
  });

  const pipelineOptions = useMemo(() => {
    const pipelines = amoPipelinesQuery.data?.pipelines || [];
    return pipelines.map((pipeline: any) => ({
      id: pipeline.id,
      label: pipeline.name,
    }));
  }, [amoPipelinesQuery.data]);

  useEffect(() => {
    if (!amoPipelinesQuery.data || !isAdmin || isFinanceOnly) {
      return;
    }

    if (amoPipelinesQuery.data.hasExplicitSelection) {
      setPipelineIds(amoPipelinesQuery.data.selectedPipelineIds);
      return;
    }

    setPipelineIds((amoPipelinesQuery.data.pipelines || []).map((pipeline: any) => pipeline.id));
  }, [amoPipelinesQuery.data, isAdmin, isFinanceOnly]);

  const summaryQuery = trpc.dashboard.summary.useQuery(
    {
      range,
      pipelineIds: isAdmin ? pipelineIds : undefined,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
    },
    {
      enabled: !isFinanceOnly,
      retry: 1,
      refetchInterval: 5 * 60 * 1000,
    },
  );

  const financeSummaryQuery = trpc.dashboard.financeSummary.useQuery(
    {
      range,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
    },
    {
      enabled: isFinanceOnly,
      retry: 1,
      refetchInterval: 5 * 60 * 1000,
    },
  );
  const salarySummaryQuery = trpc.dashboard.salarySummary.useQuery(undefined, {
    enabled: showSalarySection,
    retry: 1,
    refetchInterval: 5 * 60 * 1000,
  });
  const [rangeLoadProgress, setRangeLoadProgress] = useState(0);
  const [rangeLoadElapsedMs, setRangeLoadElapsedMs] = useState(0);
  const [rangeLoadVisible, setRangeLoadVisible] = useState(false);

  const activeRangeQueryFetching = isFinanceOnly ? financeSummaryQuery.isFetching : summaryQuery.isFetching;
  const expectedLoadMs = useMemo(() => {
    if (range === 'today') return 2200;
    if (range === 'week') return 3400;
    if (range === 'month') return 7000;
    const from = new Date(`${dateFrom}T00:00:00`);
    const to = new Date(`${dateTo}T23:59:59`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return 5000;
    }
    const dayDiff = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000));
    return Math.min(12000, Math.max(3200, dayDiff * 190));
  }, [range, dateFrom, dateTo]);

  useEffect(() => {
    if (activeRangeQueryFetching) {
      setRangeLoadVisible(true);
      setRangeLoadProgress((previous) => (previous > 0 ? previous : 6));
      const startedAt = Date.now();

      const interval = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        setRangeLoadElapsedMs(elapsed);
        const linearPercent = Math.min(92, Math.round((elapsed / expectedLoadMs) * 100));
        setRangeLoadProgress((previous) => {
          if (linearPercent > previous) {
            return linearPercent;
          }
          return Math.min(95, previous + 1);
        });
      }, 140);

      return () => window.clearInterval(interval);
    }

    setRangeLoadProgress((previous) => (previous > 0 ? 100 : 0));
    const doneTimer = window.setTimeout(() => {
      setRangeLoadVisible(false);
      setRangeLoadProgress(0);
      setRangeLoadElapsedMs(0);
    }, 320);

    return () => window.clearTimeout(doneTimer);
  }, [activeRangeQueryFetching, expectedLoadMs]);

  const estimatedRemainingSeconds = Math.max(
    1,
    Math.ceil(Math.max(0, expectedLoadMs - rangeLoadElapsedMs) / 1000),
  );

  const stats = summaryQuery.data?.summary;
  const sellerPerformance = useMemo(
    () => summaryQuery.data?.sellerPerformance ?? [],
    [summaryQuery.data?.sellerPerformance],
  );
  const financeTotals = financeSummaryQuery.data?.totals;
  const incomeByCourse = financeSummaryQuery.data?.incomeByCourse || [];
  const salaryByAgent = salarySummaryQuery.data?.byAgent || [];
  const salaryCurrentUser = salarySummaryQuery.data?.currentUser;
  const salaryTotals = salarySummaryQuery.data?.totals;
  const salaryModeLabel = salarySummaryQuery.data?.bonusMode === 'on_debt_closed'
    ? "Bonus rejimi: Sotuv yopilganda (qarz 0 bo'lganda)"
    : "Bonus rejimi: Tushum (har bir to'lovdan)";
  const formatPercent = (value?: number) => `${(value ?? 0).toFixed(1)}%`;
  const agentTalkDurationSeconds = useMemo(() => {
    if (!isAgentOnly) {
      return null;
    }

    return sellerPerformance.reduce((sum: number, seller: any) => {
      const seconds = typeof seller?.talkedSeconds === 'number' ? seller.talkedSeconds : 0;
      return sum + Math.max(0, seconds);
    }, 0);
  }, [isAgentOnly, sellerPerformance]);

  const metricCards = isTashkiliyOnly
    ? [
        {
          title: 'Yangi sotuvlar',
          value: String(stats?.newSalesCount ?? 0),
          subtitle: "Tanlangan davr bo'yicha",
          extra: null,
        },
        {
          title: 'Sotuv - Onlayn',
          value: String(stats?.onlineSalesCount ?? 0),
          subtitle: "Soni",
          extra: null,
        },
        {
          title: 'Sotuv - Oflayn',
          value: String(stats?.offlineSalesCount ?? 0),
          subtitle: "Soni",
          extra: null,
        },
        {
          title: 'Sotuv - Intensiv',
          value: String(stats?.intensiveSalesCount ?? 0),
          subtitle: "Soni",
          extra: null,
        },
        {
          title: 'Yangi lidlar',
          value: String(stats?.totalLeads ?? 0),
          subtitle: "Tanlangan davr bo'yicha",
          extra: null,
        },
        {
          title: 'Sifatli lidlar',
          value: String(stats?.qualifiedLeads ?? 0),
          subtitle: `${formatPercent(stats?.qualifiedLeadSharePercent)} ulush`,
          extra: null,
        },
        {
          title: 'Sifatsiz lidlar',
          value: String(stats?.nonQualifiedLeads ?? 0),
          subtitle: `${formatPercent(stats?.nonQualifiedLeadSharePercent)} ulush`,
          extra: null,
        },
        {
          title: 'Konversiya',
          value: `${(stats?.conversionPercent ?? 0).toFixed(1)}%`,
          subtitle: 'Sotuv / lid',
          extra: null,
        },
      ]
    : [
        {
          title: 'Sotuv shartnomasi',
          value: String(stats?.newSalesCount ?? 0),
          subtitle: formatAmount(stats?.newSalesAgreementAmount),
          extra: null,
        },
        {
          title: 'Sotuv - Onlayn',
          value: String(stats?.onlineSalesCount ?? 0),
          subtitle: formatAmount(stats?.onlineSalesAgreementAmount),
          extra: null,
        },
        {
          title: 'Sotuv - Oflayn',
          value: String(stats?.offlineSalesCount ?? 0),
          subtitle: formatAmount(stats?.offlineSalesAgreementAmount),
          extra: null,
        },
        {
          title: 'Sotuv - Intensiv',
          value: String(stats?.intensiveSalesCount ?? 0),
          subtitle: formatAmount(stats?.intensiveSalesAgreementAmount),
          extra: null,
        },
        {
          title: 'Tushum',
          value: formatAmount(stats?.totalIncomeAmount),
          subtitle: 'Tanlangan davr bo\'yicha',
          extra: null,
        },
        {
          title: 'Follow-up',
          value: String(stats?.followUpCount ?? 0),
          subtitle: 'Yakunlangan vazifalar',
          extra: null,
        },
        {
          title: 'Yozuvlar',
          value: String(stats?.noteCount ?? 0),
          subtitle: "Lid bo'yicha yozuvlar",
          extra: null,
        },
        {
          title: "Bosqich o'zgarishi",
          value: String(stats?.stageChangeCount ?? 0),
          subtitle: "CRM status o'zgarishlari",
          extra: null,
        },
        ...(isAgentOnly
          ? [{
              title: "Qo'ng'iroqlar",
              value: `${stats?.totalCalls ?? 0} ta`,
              subtitle: "Jami qo'ng'iroq soni",
              extra: `Davomiylik: ${formatDurationCompact(agentTalkDurationSeconds)}`,
            }]
          : []),
      ];

  const financeCards = [
    {
      title: 'Jami tushum',
      value: formatAmount(financeTotals?.totalIncomeAmount),
    },
    {
      title: 'Yangi sotuvlar',
      value: String(financeTotals?.newSalesCount ?? 0),
    },
    {
      title: 'Qayta to\'lovlar',
      value: String(financeTotals?.repaymentCount ?? 0),
    },
    {
      title: 'Qarzdor mijozlar',
      value: String(financeTotals?.debtorsCount ?? 0),
    },
    {
      title: 'Jami qarzdorlik',
      value: formatAmount(financeTotals?.totalDebtAmount),
    },
  ];
  const salarySection = showSalarySection ? (
    <div className="rounded-lg bg-white shadow">
      <div className="px-4 py-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium leading-6 text-gray-900">Maosh (joriy oy)</h3>
            <p className="mt-1 text-sm text-gray-500">{salaryModeLabel}</p>
          </div>
        </div>

        {salarySummaryQuery.error && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {salarySummaryQuery.error.message || 'Maosh ma\'lumotini yuklashda xatolik.'}
          </div>
        )}

        {salarySummaryQuery.isLoading ? (
          <p className="text-sm text-gray-600">Maosh ma'lumotlari yuklanmoqda...</p>
        ) : isAgentOnly ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">Fiks maosh</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryCurrentUser?.fixedSalary)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">KPI</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryCurrentUser?.kpiAmount)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">Bonus</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryCurrentUser?.bonusAmount)}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">Jami maosh</p>
              <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryCurrentUser?.totalSalary)}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Jami fiks maosh</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryTotals?.fixedSalary)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Jami KPI</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryTotals?.kpi)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Jami bonus</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryTotals?.bonus)}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-sm text-gray-500">Jami maosh to'lovi</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(salaryTotals?.salary)}</p>
              </div>
            </div>

            {salaryByAgent.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Agent</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Fiks</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">KPI</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Bonus</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Jami</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {salaryByAgent.map((row: any) => (
                      <tr key={row.userId}>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.name}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.fixedSalary)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.kpiAmount)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.bonusAmount)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm font-semibold text-gray-900">{formatAmount(row.totalSalary)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-600">Joriy oy bo'yicha agent maoshi topilmadi.</p>
            )}
          </div>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow">
        <div className="px-3 py-2 sm:px-5 sm:py-4">
          <div className="space-y-2">
            {rangeLoadVisible && (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[11px] font-medium text-blue-700 sm:text-xs">
                    {activeRangeQueryFetching
                      ? `Yuklanmoqda: ${rangeLoadProgress}%`
                      : 'Yangilandi'}
                  </p>
                  {activeRangeQueryFetching && (
                    <p className="text-[11px] text-blue-600 sm:text-xs">
                      Taxminan {estimatedRemainingSeconds} soniya
                    </p>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-[width] duration-200 ease-out"
                    style={{ width: `${Math.max(0, Math.min(100, rangeLoadProgress))}%` }}
                  />
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <div className="inline-flex min-w-max rounded-md shadow-sm">
                {RANGE_OPTIONS.map((option, index) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setRange(option)}
                    className={`border border-gray-300 px-2.5 py-1 text-xs font-medium sm:px-3 sm:py-1.5 sm:text-sm ${
                      range === option ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                    } ${index === 0 ? 'rounded-l-md' : ''} ${
                      index === RANGE_OPTIONS.length - 1 ? 'rounded-r-md' : ''
                    } ${index !== 0 ? 'border-l-0' : ''}`}
                  >
                    {getRangeLabel(option)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-[170px_170px_1fr]">
              <input
                type="date"
                value={dateFrom}
                disabled={range !== 'custom'}
                onChange={(event) => setDateFrom(event.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 sm:px-3 sm:py-1.5 sm:text-sm"
              />
              <input
                type="date"
                value={dateTo}
                disabled={range !== 'custom'}
                onChange={(event) => setDateTo(event.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 sm:px-3 sm:py-1.5 sm:text-sm"
              />

              {!isFinanceOnly && isAdmin && (
                <MultiSelectDropdown
                  label="Pipeline filtri"
                  options={pipelineOptions}
                  selectedIds={pipelineIds}
                  onChange={setPipelineIds}
                  placeholder="Pipeline tanlang"
                  disabled={amoPipelinesQuery.isLoading}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg bg-white shadow">
        <div className="px-4 py-3 sm:px-5 sm:py-4">
          <div className="flex items-center">
            <div className="flex-shrink-0 rounded-md bg-gray-100 p-2">
              <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="ml-4">
                <h3 className="text-base font-medium leading-6 text-gray-900">
                Xush kelibsiz, {user?.email?.split('@')[0] || user?.phone || 'Foydalanuvchi'}!
              </h3>
              <p className="mt-0.5 text-sm text-gray-500">
                {isFinanceOnly
                  ? "Moliya panelida tanlangan davr bo'yicha tushum, qarzdorlar va kurs kesimidagi tushum ko'rinadi."
                  : "Barcha bo'limlar tepadagi bitta filtr bilan ishlaydi."}
              </p>
            </div>
          </div>
        </div>
      </div>

      {isFinanceOnly ? (
        <div className="space-y-6">
          {financeSummaryQuery.error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {financeSummaryQuery.error.message || 'Moliya paneli ma\'lumotlarini yuklashda xatolik.'}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {financeCards.map((card) => (
              <div
                key={card.title}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
              >
                <p className="text-sm text-gray-500">{card.title}</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{card.value}</p>
              </div>
            ))}
          </div>

          {salarySection}

          <div className="rounded-lg bg-white shadow">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="mb-4 text-lg font-medium leading-6 text-gray-900">Kurslar bo'yicha tushum</h3>
              {financeSummaryQuery.isLoading ? (
                <p className="text-sm text-gray-600">Yuklanmoqda...</p>
              ) : incomeByCourse.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kurs</th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Sotuvlar</th>
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {incomeByCourse.map((row: any) => (
                        <tr key={row.courseName}>
                          <td className="px-3 py-2 text-sm text-gray-900">{row.courseName}</td>
                          <td className="px-3 py-2 text-sm text-gray-700">{row.count}</td>
                          <td className="px-3 py-2 text-sm text-gray-700">{formatAmount(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-gray-600">Tanlangan davr uchun tushum ma'lumoti topilmadi.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {metricCards.map((card) => (
              <div
                key={card.title}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
              >
                <p className="text-sm text-gray-500">{card.title}</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{card.value}</p>
                <p className="mt-2 text-sm text-gray-600">{card.subtitle}</p>
                {card.extra ? (
                  <p className="mt-1 text-sm font-medium text-gray-700">{card.extra}</p>
                ) : null}
              </div>
            ))}
          </div>

          {salarySection}

          <div className="grid grid-cols-1 gap-6">
            <div className="rounded-lg bg-white shadow">
              <div className="px-4 py-5 sm:p-6">
                <h3 className="mb-4 text-lg font-medium leading-6 text-gray-900">Sotuvchilar</h3>
                {summaryQuery.isLoading ? (
                  <p className="text-sm text-gray-600">Sotuvchilar ma'lumoti yuklanmoqda...</p>
                ) : sellerPerformance.length ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Ism</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Sotuv</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Follow-up</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Yozuvlar</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Bosqich o'zgarishi</th>
                          {!isTashkiliyOnly && (
                            <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Shartnoma summasi</th>
                          )}
                          {!isTashkiliyOnly && (
                            <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum summasi</th>
                          )}
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Suhbat vaqti</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {sellerPerformance.map((seller: any) => (
                          <tr key={seller.userId}>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{seller.name}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                              {renderMetricValue(seller.sales)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                              {renderMetricValue(seller.followUpCount)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                              {renderMetricValue(seller.noteCount)}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                              {renderMetricValue(seller.stageChangeCount)}
                            </td>
                            {!isTashkiliyOnly && (
                              <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                                {seller.agreementsAmount === null || seller.agreementsAmount === undefined
                                  ? '-'
                                  : formatAmount(seller.agreementsAmount)}
                              </td>
                            )}
                            {!isTashkiliyOnly && (
                              <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                                {seller.incomeAmount === null || seller.incomeAmount === undefined
                                  ? '-'
                                  : formatAmount(seller.incomeAmount)}
                              </td>
                            )}
                            <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                              {formatDuration(seller.talkedSeconds)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600">Tanlangan filtrlar bo'yicha sotuvchi ma'lumoti topilmadi.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}


