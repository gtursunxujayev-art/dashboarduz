'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/contexts/auth-context';
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

function formatAmount(value?: number | null): string {
  return `${new Intl.NumberFormat('ru-RU').format(value ?? 0)} so'm`;
}

function formatDate(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
}

export default function CourseSalesPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isTashkiliyOnly = Boolean(
    roles.includes('Tashkiliy')
      && !roles.includes('Admin')
      && !roles.includes('Manager')
      && !roles.includes('Agent')
      && !roles.includes('Finance'),
  );

  const [range, setRange] = useState<DashboardRange>('today');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [courseId, setCourseId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [subTariffId, setSubTariffId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  const optionsQuery = trpc.courseSales.options.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });

  const courses = useMemo(() => optionsQuery.data?.courses || [], [optionsQuery.data]);
  const selectedCourse = useMemo(
    () => (courses as any[]).find((course: any) => course.id === courseId) || null,
    [courseId, courses],
  );
  const tariffOptions = useMemo(
    () => (selectedCourse?.tariffs as any[]) || [],
    [selectedCourse],
  );
  const subTariffOptions = useMemo(() => {
    if (!selectedCourse) {
      return [];
    }
    if (tariffId) {
      const selectedTariff = tariffOptions.find((tariff: any) => tariff.id === tariffId);
      return selectedTariff?.subTariffs || [];
    }
    const map = new Map<string, { id: string; name: string }>();
    for (const tariff of tariffOptions) {
      for (const subTariff of tariff.subTariffs || []) {
        if (!map.has(subTariff.id)) {
          map.set(subTariff.id, subTariff);
        }
      }
    }
    return Array.from(map.values());
  }, [selectedCourse, tariffId, tariffOptions]);

  useEffect(() => {
    if (!courseId && (courses as any[]).length > 0) {
      setCourseId((courses as any[])[0].id);
    }
  }, [courseId, courses]);

  useEffect(() => {
    setTariffId('');
    setSubTariffId('');
    setPage(1);
  }, [courseId]);

  useEffect(() => {
    if (!tariffId) {
      return;
    }
    if (!tariffOptions.some((tariff: any) => tariff.id === tariffId)) {
      setTariffId('');
      setSubTariffId('');
    }
  }, [tariffId, tariffOptions]);

  useEffect(() => {
    if (!subTariffId) {
      return;
    }
    if (!subTariffOptions.some((subTariff: any) => subTariff.id === subTariffId)) {
      setSubTariffId('');
    }
  }, [subTariffId, subTariffOptions]);

  useEffect(() => {
    setPage(1);
  }, [courseId, tariffId, subTariffId, range, dateFrom, dateTo, searchQuery]);

  const summaryQuery = trpc.courseSales.summary.useQuery(
    {
      courseId: courseId || '00000000-0000-0000-0000-000000000000',
      tariffId: tariffId || undefined,
      subTariffId: subTariffId || undefined,
      range,
      dateFrom: range === 'custom' ? dateFrom : undefined,
      dateTo: range === 'custom' ? dateTo : undefined,
    },
    {
      enabled: Boolean(courseId),
      retry: 1,
      refetchInterval: 3 * 60 * 1000,
    },
  );

  const customersQuery = trpc.courseSales.customers.useQuery(
    {
      courseId: courseId || '00000000-0000-0000-0000-000000000000',
      tariffId: tariffId || undefined,
      subTariffId: subTariffId || undefined,
      query: searchQuery || undefined,
      page,
      limit,
    },
    {
      enabled: Boolean(courseId),
      retry: 1,
      keepPreviousData: true,
      refetchInterval: 3 * 60 * 1000,
    },
  );

  const summary = summaryQuery.data?.totals;
  const customers = customersQuery.data?.rows || [];
  const pagination = {
    page: customersQuery.data?.page || 1,
    totalPages: customersQuery.data?.totalPages || 1,
    total: customersQuery.data?.total || 0,
  };

  const applySearch = () => setSearchQuery(searchInput.trim());
  const clearSearch = () => {
    setSearchInput('');
    setSearchQuery('');
  };

  const exportFilteredList = () => {
    const data = customers.map((row: any) => ({
      'Mijoz raqami': row.customerNumber,
      Ism: row.customerName,
      Telegram: row.telegramUsername || '-',
      "Mas'ul agent": row.managerLabel,
      Kurs: row.courseName || '-',
      Tarif: row.tariffName || '-',
      Subtarif: row.subTariffName || '-',
      Kelishuv: row.agreementAmount || 0,
      "To'langan": row.paidAmount || 0,
      Qarz: row.debtAmount || 0,
      "Oxirgi faollik": formatDate(row.lastActivityAt),
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Kurslar_sotuvi');
    XLSX.writeFile(workbook, `kurslar-sotuvi-${Date.now()}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Kurslar sotuvi</h1>
          <p className="mt-1 text-sm text-gray-500">
            Kurs, tarif va subtarif bo&apos;yicha joriy mijozlar hamda sotuv ko&apos;rsatkichlari.
          </p>
        </div>
        {courseId && (
          <Link
            href={`/dashboard/course-sales/${courseId}`}
            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            Batafsil
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link
          href="/dashboard/course-sales/intensive"
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
        >
          <p className="text-sm font-semibold text-gray-900">Intensiv sahifasi</p>
          <p className="mt-1 text-xs text-gray-500">Intensiv bo&apos;yicha sotilgan, to&apos;langan va qarz holati.</p>
        </Link>
        <Link
          href="/dashboard/course-sales/online"
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
        >
          <p className="text-sm font-semibold text-gray-900">Online sahifasi</p>
          <p className="mt-1 text-xs text-gray-500">Online kurslar bo&apos;yicha joriy ko&apos;rsatkichlar.</p>
        </Link>
        <Link
          href="/dashboard/course-sales/offline"
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
        >
          <p className="text-sm font-semibold text-gray-900">Oflayn sahifasi</p>
          <p className="mt-1 text-xs text-gray-500">Oflayn kurslar bo&apos;yicha joriy ko&apos;rsatkichlar.</p>
        </Link>
      </div>

      <div className="rounded-lg bg-white p-5 shadow">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_180px_180px_1fr_1fr]">
          <select
            value={range}
            onChange={(event) => setRange(event.target.value as DashboardRange)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
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
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
          />
          <input
            type="date"
            value={dateTo}
            disabled={range !== 'custom'}
            onChange={(event) => setDateTo(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
          />

          <select
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Kurs tanlang</option>
            {(courses as any[]).map((course: any) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>

          <select
            value={tariffId}
            onChange={(event) => setTariffId(event.target.value)}
            disabled={!courseId}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
          >
            <option value="">Barcha tariflar</option>
            {tariffOptions.map((tariff: any) => (
              <option key={tariff.id} value={tariff.id}>
                {tariff.name}
              </option>
            ))}
          </select>

          <select
            value={subTariffId}
            onChange={(event) => setSubTariffId(event.target.value)}
            disabled={!courseId}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
          >
            <option value="">Barcha subtariflar</option>
            {subTariffOptions.map((subTariff: any) => (
              <option key={subTariff.id} value={subTariff.id}>
                {subTariff.name}
              </option>
            ))}
          </select>

          <div className="md:col-span-2 flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Mijoz raqami yoki ism"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            />
            <button
              type="button"
              onClick={applySearch}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Qidirish
            </button>
            <button
              type="button"
              onClick={clearSearch}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Tozalash
            </button>
          </div>
        </div>
      </div>

      {summaryQuery.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {summaryQuery.error.message || "Kurslar sotuvi ma'lumotini yuklashda xatolik."}
        </div>
      )}

      {!courseId ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Iltimos, avval kursni tanlang.
        </div>
      ) : (
        <>
          <div className={`grid grid-cols-1 gap-3 ${isTashkiliyOnly ? 'md:grid-cols-2 xl:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-4'}`}>
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Jami mijozlar</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.currentCustomerCount ?? 0}</p>
            </div>

            {!isTashkiliyOnly && (
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-gray-500">Kelishuv summasi</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {formatAmount(summary?.currentAgreementAmount ?? summary?.rangeAgreementAmount)}
                </p>
              </div>
            )}

            {!isTashkiliyOnly && (
              <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs uppercase tracking-wide text-gray-500">Tushum</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {formatAmount(summary?.currentIncomeAmount ?? summary?.rangeIncomeAmount)}
                </p>
              </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Joriy qarz</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{formatAmount(summary?.currentDebtAmount)}</p>
            </div>
          </div>

          <div className="rounded-lg bg-white p-4 shadow">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Tariflar taqsimoti</h2>
              <p className="text-xs text-gray-500">Tanlangan kurs bo&apos;yicha joriy mijozlar soni</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-8">
              {(summaryQuery.data?.tariffDistribution || []).map((item: any) => (
                <button
                  key={item.tariffId}
                  type="button"
                  onClick={() => setTariffId((current) => (current === item.tariffId ? '' : item.tariffId))}
                  className={`rounded-md border px-3 py-2 text-left transition ${
                    tariffId === item.tariffId || item.isSelected
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <p className="truncate text-xs text-gray-500">{item.tariffName}</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{item.customerCount}</p>
                </button>
              ))}
            </div>
          </div>

          {tariffId && (summaryQuery.data?.subTariffDistribution?.length || 0) > 0 && (
            <div className="rounded-lg bg-white p-4 shadow">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Subtariflar taqsimoti</h2>
                <p className="text-xs text-gray-500">Tanlangan tarif bo&apos;yicha joriy mijozlar soni</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-8">
                {(summaryQuery.data?.subTariffDistribution || []).map((item: any) => (
                  <button
                    key={item.subTariffId}
                    type="button"
                    onClick={() => setSubTariffId((current) => (current === item.subTariffId ? '' : item.subTariffId))}
                    className={`rounded-md border px-3 py-2 text-left transition ${
                      subTariffId === item.subTariffId || item.isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <p className="truncate text-xs text-gray-500">{item.subTariffName}</p>
                    <p className="mt-1 text-base font-semibold text-gray-900">{item.customerCount}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg bg-white p-5 shadow">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900">Mijozlar ro&apos;yxati</h2>
              <button
                type="button"
                onClick={exportFilteredList}
                disabled={customers.length === 0}
                className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Filtrlangan ro&apos;yxatni yuklab olish
              </button>
            </div>

            {customersQuery.isLoading ? (
              <p className="text-sm text-gray-600">Mijozlar yuklanmoqda...</p>
            ) : customers.length === 0 ? (
              <p className="text-sm text-gray-600">Tanlangan filtrlar bo&apos;yicha mijoz topilmadi.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mijoz raqami</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Ism</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Telegram</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mas&apos;ul agent</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kurs / Tarif / Subtarif</th>
                      {!isTashkiliyOnly && (
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kelishuv</th>
                      )}
                      {!isTashkiliyOnly && (
                        <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">To&apos;langan</th>
                      )}
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Qarz</th>
                      <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Oxirgi faollik</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {customers.map((row: any) => (
                      <tr key={row.saleId}>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.customerNumber}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.customerName}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.telegramUsername || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.managerLabel}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                          {[row.courseName, row.tariffName, row.subTariffName].filter(Boolean).join(' / ') || '-'}
                        </td>
                        {!isTashkiliyOnly && (
                          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.agreementAmount)}</td>
                        )}
                        {!isTashkiliyOnly && (
                          <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.paidAmount)}</td>
                        )}
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.debtAmount)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatDate(row.lastActivityAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-600">Jami: {pagination.total}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={pagination.page <= 1}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Oldingi
                </button>
                <span className="text-sm text-gray-600">
                  {pagination.page} / {pagination.totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Keyingi
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
