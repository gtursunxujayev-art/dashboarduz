'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type DashboardRange = 'today' | 'week' | 'month' | 'custom';

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

function formatAmount(value: number | null | undefined): string {
  return `${new Intl.NumberFormat('ru-RU').format(value ?? 0)} so'm`;
}

function formatCompactAmount(value: number | null | undefined): string {
  const safe = Number(value || 0);
  const abs = Math.abs(safe);
  if (abs >= 1_000_000_000) {
    return `${(safe / 1_000_000_000).toFixed(1)} mlrd`;
  }
  if (abs >= 1_000_000) {
    return `${(safe / 1_000_000).toFixed(1)} mln`;
  }
  if (abs >= 1_000) {
    return `${(safe / 1_000).toFixed(1)} ming`;
  }
  return `${Math.round(safe)}`;
}

function getTrendMeta(direction?: string) {
  if (direction === 'up') {
    return {
      badgeClass: 'bg-emerald-100 text-emerald-800',
      label: "O'sish",
      sign: '+',
    };
  }
  if (direction === 'down') {
    return {
      badgeClass: 'bg-red-100 text-red-800',
      label: 'Pasayish',
      sign: '',
    };
  }
  return {
    badgeClass: 'bg-gray-100 text-gray-700',
    label: "O'zgarish yo'q",
    sign: '',
  };
}

function getIncomeStatusBadge(status: string) {
  if (status === 'pending_refund') {
    return {
      label: "Sariq: Qaytarish so'rovi",
      className: 'bg-yellow-100 text-yellow-800',
    };
  }
  if (status === 'refunded') {
    return {
      label: 'Qizil: Qaytarilgan',
      className: 'bg-red-100 text-red-800',
    };
  }
  return {
    label: 'Aktiv',
    className: 'bg-emerald-100 text-emerald-800',
  };
}

export default function FinancePage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const canSeeRefundAnalytics = roles.includes('Admin') || roles.includes('Finance');
  const [range, setRange] = useState<DashboardRange>('month');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [courseId, setCourseId] = useState('');
  const [managerUserId, setManagerUserId] = useState('');

  const financeQuery = trpc.dashboard.financeSummary.useQuery(
    {
      range,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
      courseId: courseId || undefined,
      managerUserId: managerUserId || undefined,
    },
    {
      retry: 1,
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Moliya</h1>
        <p className="mt-1 text-sm text-gray-500">
          Kurs, agent va sana bo'yicha tushum hamda qarzdorlik tahlili.
        </p>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_180px_180px_1fr_1fr]">
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as DashboardRange)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="today">Bugun</option>
            <option value="week">Hafta</option>
            <option value="month">Oy</option>
            <option value="custom">Ixtiyoriy</option>
          </select>

          <input
            type="date"
            value={dateFrom}
            disabled={range !== 'custom'}
            onChange={(event) => setDateFrom(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
          />
          <input
            type="date"
            value={dateTo}
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
        </div>
      </div>

      {financeQuery.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {financeQuery.error.message || 'Moliya ma\'lumotlarini yuklashda xatolik.'}
        </div>
      )}

      <div className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${canSeeRefundAnalytics ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Jami tushum</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(totals?.totalIncomeAmount)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Yangi sotuvlar</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{totals?.newSalesCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Qayta to'lovlar</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{totals?.repaymentCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Qarzdorlar</p>
          <p className="mt-2 text-2xl font-semibold text-amber-700">{totals?.debtorsCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Jami qarzdorlik</p>
          <p className="mt-2 text-2xl font-semibold text-amber-700">{formatAmount(totals?.totalDebtAmount)}</p>
        </div>
        {canSeeRefundAnalytics && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">Qaytarilgan tushum</p>
            <p className="mt-2 text-2xl font-semibold text-red-700">{formatAmount(totals?.refundAmount)}</p>
            <p className="mt-1 text-xs text-gray-500">{totals?.refundCount ?? 0} ta qaytarish</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {[
          {
            title: "Bu oy (hozirgacha) vs o'tgan oy (shu sana)",
            data: comparisons?.monthToDateVsLastMonthToDate,
          },
          {
            title: "Bu oy (hozirgacha) vs o'tgan yil shu oy",
            data: comparisons?.monthToDateVsLastYearSameMonth,
          },
          {
            title: 'YTD: Bu yil vs O‘tgan yil',
            data: comparisons?.ytdVsLastYearYtd,
          },
        ].map((item) => {
          const trend = getTrendMeta(item.data?.direction);
          return (
            <div key={item.title} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-500">{item.title}</p>
              <div className="mt-3 space-y-1">
                <p className="text-sm text-gray-600">Joriy: <span className="font-semibold text-gray-900">{formatAmount(item.data?.currentValue)}</span></p>
                <p className="text-sm text-gray-600">Taqqoslash: <span className="font-semibold text-gray-900">{formatAmount(item.data?.previousValue)}</span></p>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${trend.badgeClass}`}>
                  {trend.label}
                </span>
                <span className="text-sm font-semibold text-gray-900">
                  {trend.sign}{formatAmount(item.data?.diffAmount)} ({trend.sign}{Number(item.data?.diffPercent || 0).toFixed(2)}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Oy yakuni prognozi</h2>
              <p className="mt-1 text-sm text-gray-500">
                Hozirgi kunlik sur&apos;at asosida oy oxiri prognozi.
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Prognoz</p>
              <p className="text-sm font-semibold text-gray-900">{formatAmount(forecast?.monthEnd?.projectedTotal)}</p>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">Hozirgacha</p>
              <p className="text-sm font-semibold text-gray-900">{formatAmount(forecast?.monthEnd?.currentToDate)}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">Qolgan potensial</p>
              <p className="text-sm font-semibold text-gray-900">{formatAmount(forecast?.monthEnd?.remainingAmount)}</p>
            </div>
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(value) => formatCompactAmount(value)} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: any, name: string) => [formatAmount(Number(value || 0)), name === 'actual' ? 'Amaldagi' : 'Prognoz']}
                  labelFormatter={(label) => `${label}-kun`}
                />
                <Line type="monotone" dataKey="actual" name="actual" stroke="#2563EB" strokeWidth={2.5} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="forecast" name="forecast" stroke="#F59E0B" strokeWidth={2} dot={false} strokeDasharray="6 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Yil yakuni prognozi</h2>
              <p className="mt-1 text-sm text-gray-500">
                YTD dinamikasi va yil oxirigacha prognoz.
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Prognoz</p>
              <p className="text-sm font-semibold text-gray-900">{formatAmount(forecast?.yearEnd?.projectedTotal)}</p>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">YTD</p>
              <p className="text-sm font-semibold text-gray-900">{formatAmount(forecast?.yearEnd?.currentToDate)}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs text-gray-500">Qolgan potensial</p>
              <p className="text-sm font-semibold text-gray-900">{formatAmount(forecast?.yearEnd?.remainingAmount)}</p>
            </div>
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yearSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(value) => formatCompactAmount(value)} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: any, name: string) => [formatAmount(Number(value || 0)), name === 'actual' ? 'Amaldagi' : 'Prognoz']}
                />
                <Line type="monotone" dataKey="actual" name="actual" stroke="#2563EB" strokeWidth={2.5} dot={false} connectNulls={false} />
                <Line type="monotone" dataKey="forecast" name="forecast" stroke="#F59E0B" strokeWidth={2} dot={false} strokeDasharray="6 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold text-gray-900">Kurslar bo'yicha tushum</h2>
          {financeQuery.isLoading ? (
            <p className="mt-3 text-sm text-gray-600">Yuklanmoqda...</p>
          ) : incomeByCourse.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kurs</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Soni</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Shartnoma</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {incomeByCourse.map((row: any) => (
                    <tr key={row.courseName}>
                      <td className="px-3 py-2 text-sm text-gray-900">{row.courseName}</td>
                      <td className="px-3 py-2 text-sm text-gray-700">{row.count}</td>
                      <td className="px-3 py-2 text-sm text-gray-700">{formatAmount(row.amount)}</td>
                      <td className="px-3 py-2 text-sm text-gray-700">{formatAmount(row.agreementAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-600">Tanlangan filtr bo'yicha kurs tushumi topilmadi.</p>
          )}
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold text-gray-900">Agentlar bo'yicha tushum</h2>
          {financeQuery.isLoading ? (
            <p className="mt-3 text-sm text-gray-600">Yuklanmoqda...</p>
          ) : incomeByAgent.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Agent</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Soni</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {incomeByAgent.map((row: any) => (
                    <tr key={row.agent}>
                      <td className="px-3 py-2 text-sm text-gray-900">{row.agent}</td>
                      <td className="px-3 py-2 text-sm text-gray-700">{row.count}</td>
                      <td className="px-3 py-2 text-sm text-gray-700">{formatAmount(row.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-600">Tanlangan filtr bo'yicha agent tushumi topilmadi.</p>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold text-gray-900">So'nggi tushumlar</h2>
        {financeQuery.isLoading ? (
          <p className="mt-3 text-sm text-gray-600">Yuklanmoqda...</p>
        ) : recentIncomes.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Sana</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Turi</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mijoz</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Agent</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kurs/Tarif</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Holat</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">To'lov</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Qoldiq qarz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {recentIncomes.map((income: any) => (
                  <tr key={income.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {new Date(income.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {income.type === 'repayment' ? 'Qarzdorlik' : 'Yangi sotuv'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {income.customerNumber} - {income.customerName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{income.managerLabel}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {[income.courseName, income.tariffName].filter(Boolean).join(' / ') || '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getIncomeStatusBadge(income.lifecycleStatus).className}`}>
                        {getIncomeStatusBadge(income.lifecycleStatus).label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(income.paymentAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(income.remainingDebtAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-600">Tanlangan filtr bo'yicha tushum yo'q.</p>
        )}
      </div>
    </div>
  );
}


