'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/contexts/auth-context';
import { trpc } from '@/lib/trpc';

type DashboardRange = 'today' | 'week' | 'month' | 'custom';
type DetailTab = 'umumiy' | 'tariflar' | 'menejerlar' | 'mijozlar';

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

export default function CourseSalesDetailPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isAdmin = Boolean(roles.includes('Admin'));
  const isTashkiliyOnly = Boolean(
    roles.includes('Tashkiliy')
      && !roles.includes('Admin')
      && !roles.includes('Manager')
      && !roles.includes('Agent')
      && !roles.includes('Finance'),
  );

  const params = useParams<{ courseId: string }>();
  const courseId = String(params?.courseId || '');

  const [range, setRange] = useState<DashboardRange>('today');
  const [dateFrom, setDateFrom] = useState(getTashkentToday());
  const [dateTo, setDateTo] = useState(getTashkentToday());
  const [tariffId, setTariffId] = useState('');
  const [subTariffId, setSubTariffId] = useState('');
  const [tab, setTab] = useState<DetailTab>('umumiy');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [deletingCourseSaleId, setDeletingCourseSaleId] = useState('');

  const optionsQuery = trpc.courseSales.options.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  const deleteCustomerCourseMutation = trpc.customerIncome.deleteCustomerCourse.useMutation();
  const course = useMemo(
    () => (optionsQuery.data?.courses || []).find((item: any) => item.id === courseId) || null,
    [courseId, optionsQuery.data?.courses],
  );
  const tariffOptions = useMemo(() => course?.tariffs || [], [course]);
  const subTariffOptions = useMemo(() => {
    if (!course) {
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
  }, [course, tariffId, tariffOptions]);

  const detailQuery = trpc.courseSales.courseDetail.useQuery(
    {
      courseId,
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
      courseId,
      tariffId: tariffId || undefined,
      subTariffId: subTariffId || undefined,
      query: searchQuery || undefined,
      page,
      limit: 50,
    },
    {
      enabled: Boolean(courseId),
      retry: 1,
      keepPreviousData: true,
      refetchInterval: 3 * 60 * 1000,
    },
  );

  const summary = detailQuery.data?.summary;
  const tariffRows = detailQuery.data?.tariffRows || [];
  const managerRows = detailQuery.data?.managerRows || [];
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

  const exportCustomers = () => {
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
    XLSX.utils.book_append_sheet(workbook, sheet, 'Kurs_detal');
    XLSX.writeFile(workbook, `kurs-detali-${courseId}-${Date.now()}.xlsx`);
  };

  const handleDeleteCustomerCourse = async (saleIncomeId: string, label: string) => {
    const confirmed = window.confirm(`"${label}" kursini mijozdan o'chirmoqchimisiz?`);
    if (!confirmed) {
      return;
    }

    setActionError(null);
    setActionSuccess(null);

    try {
      setDeletingCourseSaleId(saleIncomeId);
      const result = await deleteCustomerCourseMutation.mutateAsync({ saleIncomeId });
      await Promise.all([detailQuery.refetch(), customersQuery.refetch()]);
      setActionSuccess(`Kurs o'chirildi. O'chirilgan yozuvlar: ${result.deletedCount}.`);
    } catch (error: any) {
      setActionError(error?.message || "Mijoz kursini o'chirib bo'lmadi.");
    } finally {
      setDeletingCourseSaleId('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {detailQuery.data?.course?.name || course?.name || 'Kurs detali'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Kurs bo&apos;yicha umumiy ko&apos;rsatkichlar, tariflar, menejerlar va mijozlar.
          </p>
        </div>
        <Link
          href="/dashboard/course-sales"
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Orqaga
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
            value={tariffId}
            onChange={(event) => {
              setTariffId(event.target.value);
              setSubTariffId('');
            }}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
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
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Barcha subtariflar</option>
            {subTariffOptions.map((subTariff: any) => (
              <option key={subTariff.id} value={subTariff.id}>
                {subTariff.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="rounded-lg bg-white p-2 shadow">
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'umumiy', label: 'Umumiy' },
            { key: 'tariflar', label: 'Tariflar' },
            { key: 'menejerlar', label: 'Menejerlar' },
            { key: 'mijozlar', label: 'Mijozlar' },
          ] as Array<{ key: DetailTab; label: string }>).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                tab === item.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {detailQuery.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {detailQuery.error.message || "Kurs detali ma'lumotini yuklashda xatolik."}
        </div>
      )}

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {actionSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {actionSuccess}
        </div>
      )}

      {tab === 'umumiy' && (
        <div className={`grid grid-cols-1 gap-3 ${isTashkiliyOnly ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2 xl:grid-cols-6'}`}>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500">Fakt sotuvlar</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.factSalesCount ?? 0}</p>
          </div>
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
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500">VIP ulushi</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.vipPercent ?? 0}%</p>
            <p className="mt-1 text-xs text-gray-500">VIP: {summary?.vipCount ?? 0} | Standart: {summary?.standartCount ?? 0}</p>
          </div>
        </div>
      )}

      {tab === 'tariflar' && (
        <div className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Tariflar kesimi</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tarif</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mijozlar</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Sotuvlar</th>
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kelishuv</th>}
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum</th>}
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Qarz</th>
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Yig&apos;im %</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {tariffRows.map((row: any) => (
                  <tr key={row.tariffId} className={row.isSelected ? 'bg-blue-50' : ''}>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.tariffName}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.customerCount}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.saleCount}</td>
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.agreementAmount)}</td>}
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.incomeAmount)}</td>}
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.debtAmount)}</td>
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.collectionPercent}%</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'menejerlar' && (
        <div className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Menejerlar kesimi</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Menejer</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mijozlar</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Sotuvlar</th>
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kelishuv</th>}
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum</th>}
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Qarz</th>
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Yig&apos;im %</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {managerRows.map((row: any) => (
                  <tr key={row.managerUserId}>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.managerLabel}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.customerCount}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.saleCount}</td>
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.agreementAmount)}</td>}
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.incomeAmount)}</td>}
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.debtAmount)}</td>
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.collectionPercent}%</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'mijozlar' && (
        <div className="rounded-lg bg-white p-5 shadow">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-gray-900">Mijozlar</h2>
            <button
              type="button"
              onClick={exportCustomers}
              disabled={customers.length === 0}
              className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Yuklab olish
            </button>
          </div>

          <div className="mb-3 flex gap-2">
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

          {customersQuery.isLoading ? (
            <p className="text-sm text-gray-600">Mijozlar yuklanmoqda...</p>
          ) : customers.length === 0 ? (
            <p className="text-sm text-gray-600">Tanlangan filtr bo&apos;yicha mijoz topilmadi.</p>
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
                    {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kelishuv</th>}
                    {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">To&apos;langan</th>}
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
                      <td className="px-3 py-2 text-sm text-gray-700">
                        <div className="space-y-1">
                          {(Array.isArray(row.customerCourses) && row.customerCourses.length ? row.customerCourses : [{
                            saleIncomeId: row.saleId,
                            label: [row.courseName, row.tariffName, row.subTariffName].filter(Boolean).join(' / ') || '-',
                          }]).map((entry: any) => (
                            <div key={entry.saleIncomeId} className="flex items-center justify-between gap-2">
                              <span className="truncate">{entry.label}</span>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCustomerCourse(entry.saleIncomeId, entry.label || "Kurs")}
                                  disabled={deletingCourseSaleId === entry.saleIncomeId}
                                  className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {deletingCourseSaleId === entry.saleIncomeId ? "O'chirilmoqda..." : "Kursni o'chirish"}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                      {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.agreementAmount)}</td>}
                      {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatAmount(row.paidAmount)}</td>}
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
      )}
    </div>
  );
}
