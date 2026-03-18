'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

type DebtFilter = 'all' | 'with_debt' | 'without_debt';

function formatAmount(value: number): string {
  return value.toLocaleString('en-US');
}

function formatDate(value: string | Date | null): string {
  if (!value) {
    return '-';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
}

export default function CustomersPage() {
  const [query, setQuery] = useState('');
  const [courseId, setCourseId] = useState('');
  const [debtFilter, setDebtFilter] = useState<DebtFilter>('all');

  const customersQuery = trpc.customerIncome.listCustomers.useQuery(
    {
      query: query.trim() || undefined,
      courseId: courseId || undefined,
      debtFilter,
      limit: 500,
    },
    {
      retry: false,
    },
  );

  const customers = useMemo(() => customersQuery.data?.customers || [], [customersQuery.data]);
  const courseOptions = useMemo(() => customersQuery.data?.courseOptions || [], [customersQuery.data]);
  const withDebtCount = customers.filter((customer: any) => customer.hasDebt).length;

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Mijozlar</h1>
          <p className="mt-1 text-sm text-gray-500">Kurs va qarzdorlik boвЂyicha filtrlangan mijozlar roвЂyxati.</p>
        </div>

        <div className="space-y-4 p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_280px_220px]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Raqam, ism yoki telegram boвЂyicha qidirish"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              value={debtFilter}
              onChange={(event) => setDebtFilter(event.target.value as DebtFilter)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">Barcha qarz holatlari</option>
              <option value="with_debt">Qarzdorlar</option>
              <option value="without_debt">Qarzsizlar</option>
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs uppercase text-gray-500">Jami mijozlar</p>
              <p className="text-lg font-semibold text-gray-900">{customers.length}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs uppercase text-gray-500">Qarzdor mijozlar</p>
              <p className="text-lg font-semibold text-amber-700">{withDebtCount}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-xs uppercase text-gray-500">Qarzsiz mijozlar</p>
              <p className="text-lg font-semibold text-green-700">{Math.max(customers.length - withDebtCount, 0)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="px-6 py-5">
          {customersQuery.isLoading ? (
            <p className="text-sm text-gray-600">Mijozlar yuklanmoqda...</p>
          ) : customersQuery.error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {customersQuery.error.message || 'Mijozlarni yuklab boвЂlmadi.'}
            </p>
          ) : customers.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Mijoz raqami</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Mijoz ismi</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Telegram</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Kurslar</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Qarz</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Jami toвЂlangan</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Oxirgi faollik</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {customers.map((customer: any) => (
                    <tr key={customer.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{customer.customerNumber}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{customer.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{customer.telegramUsername || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {Array.isArray(customer.courses) && customer.courses.length ? customer.courses.join(', ') : '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <span className={customer.hasDebt ? 'font-medium text-amber-700' : 'text-green-700'}>
                          {formatAmount(customer.totalDebtAmount || 0)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{formatAmount(customer.totalPaidAmount || 0)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{formatDate(customer.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-600">Tanlangan filtr boвЂyicha mijoz topilmadi.</p>
          )}
        </div>
      </div>
    </div>
  );
}

