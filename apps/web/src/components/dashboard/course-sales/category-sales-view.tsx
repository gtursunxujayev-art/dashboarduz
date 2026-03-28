'use client';

import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/contexts/auth-context';
import { trpc } from '@/lib/trpc';

type CourseTypeCategory = 'online' | 'offline' | 'intensive';

const CATEGORY_LABELS: Record<CourseTypeCategory, string> = {
  online: 'Online',
  offline: 'Oflayn',
  intensive: 'Intensiv',
};

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

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

type CourseTypeSalesViewProps = {
  category: CourseTypeCategory;
  title?: string;
  description?: string;
};

export default function CourseTypeSalesView({
  category,
  title,
  description,
}: CourseTypeSalesViewProps) {
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

  const [courseId, setCourseId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [subTariffId, setSubTariffId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [deletingCourseSaleId, setDeletingCourseSaleId] = useState('');

  const optionsQuery = trpc.courseSales.typeOptions.useQuery(
    { category },
    {
      retry: false,
      staleTime: 60_000,
    },
  );
  const deleteCustomerCourseMutation = trpc.customerIncome.deleteCustomerCourse.useMutation();

  const courses = useMemo(() => optionsQuery.data?.courses || [], [optionsQuery.data]);
  const selectedCourse = useMemo(
    () => (courses as any[]).find((course: any) => course.id === courseId) || null,
    [courseId, courses],
  );
  const scopeCourses = useMemo(
    () => (courseId ? (courses as any[]).filter((course: any) => course.id === courseId) : (courses as any[])),
    [courseId, courses],
  );

  const tariffOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; subTariffs: Array<{ id: string; name: string }> }>();
    for (const course of scopeCourses) {
      for (const tariff of course.tariffs || []) {
        if (!map.has(tariff.id)) {
          map.set(tariff.id, tariff);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [scopeCourses]);

  const subTariffOptions = useMemo(() => {
    if (tariffId) {
      const selectedTariff = tariffOptions.find((tariff) => tariff.id === tariffId);
      return (selectedTariff?.subTariffs || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    }
    const map = new Map<string, { id: string; name: string }>();
    for (const tariff of tariffOptions) {
      for (const subTariff of tariff.subTariffs || []) {
        if (!map.has(subTariff.id)) {
          map.set(subTariff.id, subTariff);
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [tariffId, tariffOptions]);

  useEffect(() => {
    if (!courseId) {
      return;
    }
    if (!(courses as any[]).some((course: any) => course.id === courseId)) {
      setCourseId('');
    }
  }, [courseId, courses]);

  useEffect(() => {
    if (!tariffId) {
      return;
    }
    if (!tariffOptions.some((tariff) => tariff.id === tariffId)) {
      setTariffId('');
      setSubTariffId('');
    }
  }, [tariffId, tariffOptions]);

  useEffect(() => {
    if (!subTariffId) {
      return;
    }
    if (!subTariffOptions.some((subTariff) => subTariff.id === subTariffId)) {
      setSubTariffId('');
    }
  }, [subTariffId, subTariffOptions]);

  useEffect(() => {
    setPage(1);
  }, [courseId, tariffId, subTariffId, searchQuery]);

  const summaryQuery = trpc.courseSales.typeSummary.useQuery(
    {
      category,
      courseId: courseId || undefined,
      tariffId: tariffId || undefined,
      subTariffId: subTariffId || undefined,
    },
    {
      retry: 1,
      refetchInterval: 3 * 60 * 1000,
    },
  );

  const customersQuery = trpc.courseSales.typeCustomers.useQuery(
    {
      category,
      courseId: courseId || undefined,
      tariffId: tariffId || undefined,
      subTariffId: subTariffId || undefined,
      query: searchQuery || undefined,
      page,
      limit,
    },
    {
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
    XLSX.utils.book_append_sheet(workbook, sheet, 'Kurs_turi_sotuvi');
    XLSX.writeFile(workbook, `kurs-turi-${toSlug(category)}-${Date.now()}.xlsx`);
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
      await Promise.all([summaryQuery.refetch(), customersQuery.refetch()]);
      setActionSuccess(`Kurs o'chirildi. O'chirilgan yozuvlar: ${result.deletedCount}.`);
    } catch (error: any) {
      setActionError(error?.message || "Mijoz kursini o'chirib bo'lmadi.");
    } finally {
      setDeletingCourseSaleId('');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{title || `${CATEGORY_LABELS[category]} sotuvi`}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {description || `${CATEGORY_LABELS[category]} turidagi kurslar bo'yicha joriy mijozlar va sotuv ko'rsatkichlari.`}
        </p>
      </div>

      <div className="rounded-lg bg-white p-5 shadow">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_2fr]">
          <select
            value={courseId}
            onChange={(event) => {
              setCourseId(event.target.value);
              setTariffId('');
              setSubTariffId('');
            }}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Barcha kurslar</option>
            {(courses as any[]).map((course: any) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>

          <select
            value={tariffId}
            onChange={(event) => {
              setTariffId(event.target.value);
              setSubTariffId('');
            }}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Barcha tariflar</option>
            {tariffOptions.map((tariff) => (
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
            {subTariffOptions.map((subTariff) => (
              <option key={subTariff.id} value={subTariff.id}>
                {subTariff.name}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
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
          {summaryQuery.error.message || "Ma'lumotlarni yuklashda xatolik."}
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

      <div className={`grid grid-cols-1 gap-3 ${isTashkiliyOnly ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-2 xl:grid-cols-6'}`}>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Sotilganlar soni</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.soldCount ?? 0}</p>
          <p className="mt-1 text-xs text-gray-500">Jami mijozlar: {summary?.customerCount ?? 0}</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">To'liq to'langanlar</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.fullyPaidCount ?? 0}</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Qarzdorlar</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.debtorsCount ?? 0}</p>
        </div>

        {!isTashkiliyOnly && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500">Kelishuv summasi</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{formatAmount(summary?.agreementAmount)}</p>
          </div>
        )}

        {!isTashkiliyOnly && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500">To'langan summasi</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{formatAmount(summary?.paidAmount)}</p>
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Qolgan qarz</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{formatAmount(summary?.remainingDebtAmount)}</p>
        </div>
      </div>

      <div className="rounded-lg bg-white p-5 shadow">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Mijozlar ro'yxati</h2>
          <button
            type="button"
            onClick={exportFilteredList}
            disabled={customers.length === 0}
            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Filtrlangan ro'yxatni yuklab olish
          </button>
        </div>

        {customersQuery.isLoading ? (
          <p className="text-sm text-gray-600">Mijozlar yuklanmoqda...</p>
        ) : customers.length === 0 ? (
          <p className="text-sm text-gray-600">Tanlangan filtrlar bo'yicha mijoz topilmadi.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mijoz raqami</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Ism</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Telegram</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mas'ul agent</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kurs / Tarif / Subtarif</th>
                  {!isTashkiliyOnly && (
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kelishuv</th>
                  )}
                  {!isTashkiliyOnly && (
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">To'langan</th>
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
    </div>
  );
}
