'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

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

export default function FinancePage() {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Finance</h1>
        <p className="mt-1 text-sm text-gray-500">
          Income, debtors, and performance by course/agent with custom filters.
        </p>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_180px_180px_1fr_1fr]">
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as DashboardRange)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="custom">Custom</option>
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
            <option value="">All courses</option>
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
            <option value="">All agents</option>
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
          {financeQuery.error.message || 'Failed to load finance data.'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Total Income</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{formatAmount(totals?.totalIncomeAmount)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">New Sales</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{totals?.newSalesCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Repayments</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900">{totals?.repaymentCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Debitors</p>
          <p className="mt-2 text-2xl font-semibold text-amber-700">{totals?.debtorsCount ?? 0}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-gray-500">Total Debt</p>
          <p className="mt-2 text-2xl font-semibold text-amber-700">{formatAmount(totals?.totalDebtAmount)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold text-gray-900">Income by Course</h2>
          {financeQuery.isLoading ? (
            <p className="mt-3 text-sm text-gray-600">Loading...</p>
          ) : incomeByCourse.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Course</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Count</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Income</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Agreement</th>
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
            <p className="mt-3 text-sm text-gray-600">No course income data for selected filters.</p>
          )}
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold text-gray-900">Income by Agent</h2>
          {financeQuery.isLoading ? (
            <p className="mt-3 text-sm text-gray-600">Loading...</p>
          ) : incomeByAgent.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Agent</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Count</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Income</th>
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
            <p className="mt-3 text-sm text-gray-600">No agent income data for selected filters.</p>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <h2 className="text-lg font-semibold text-gray-900">Recent Income Records</h2>
        {financeQuery.isLoading ? (
          <p className="mt-3 text-sm text-gray-600">Loading...</p>
        ) : recentIncomes.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Customer</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Agent</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Course/Tariff</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Payment</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Debt left</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {recentIncomes.map((income: any) => (
                  <tr key={income.id}>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {new Date(income.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {income.type === 'repayment' ? 'Repayment' : 'New sale'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {income.customerNumber} - {income.customerName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{income.managerLabel}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {[income.courseName, income.tariffName].filter(Boolean).join(' / ') || '-'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(income.paymentAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(income.remainingDebtAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-gray-600">No income records for selected filters.</p>
        )}
      </div>
    </div>
  );
}
