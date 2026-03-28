'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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
  const [isCourseEditorModalOpen, setIsCourseEditorModalOpen] = useState(false);
  const [courseEditorCustomerId, setCourseEditorCustomerId] = useState('');
  const [editingSaleIncomeId, setEditingSaleIncomeId] = useState('');
  const [courseEditCourseId, setCourseEditCourseId] = useState('');
  const [courseEditTariffId, setCourseEditTariffId] = useState('');
  const [courseEditSubTariffId, setCourseEditSubTariffId] = useState('');

  const optionsQuery = trpc.courseSales.options.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  const editorOptionsQuery = trpc.customerIncome.customerEditorOptions.useQuery(undefined, {
    retry: false,
    enabled: isAdmin,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
  const deleteCustomerCourseMutation = trpc.customerIncome.deleteCustomerCourse.useMutation();
  const updateCustomerCourseSaleMutation = trpc.customerIncome.updateCustomerCourseSale.useMutation();
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
  const editorCourses = useMemo(() => editorOptionsQuery.data || [], [editorOptionsQuery.data]);
  const courseEditorCustomer = useMemo(
    () => customers.find((row: any) => row.customerId === courseEditorCustomerId) || null,
    [customers, courseEditorCustomerId],
  );
  const editTariffOptions = useMemo(() => {
    if (!courseEditCourseId) {
      return [];
    }
    const courseOption = editorCourses.find((item: any) => item.id === courseEditCourseId);
    return Array.isArray(courseOption?.tariffs) ? courseOption.tariffs : [];
  }, [editorCourses, courseEditCourseId]);
  const editSubTariffOptions = useMemo(() => {
    if (!courseEditTariffId) {
      return [];
    }
    const tariffOption = editTariffOptions.find((item: any) => item.id === courseEditTariffId);
    return Array.isArray(tariffOption?.subTariffs) ? tariffOption.subTariffs : [];
  }, [courseEditTariffId, editTariffOptions]);
  const pagination = {
    page: customersQuery.data?.page || 1,
    totalPages: customersQuery.data?.totalPages || 1,
    total: customersQuery.data?.total || 0,
  };

  useEffect(() => {
    if (!courseEditCourseId) {
      setCourseEditTariffId('');
      setCourseEditSubTariffId('');
      return;
    }
    if (courseEditTariffId && !editTariffOptions.some((item: any) => item.id === courseEditTariffId)) {
      setCourseEditTariffId('');
      setCourseEditSubTariffId('');
    }
  }, [courseEditCourseId, courseEditTariffId, editTariffOptions]);

  useEffect(() => {
    if (!courseEditTariffId) {
      setCourseEditSubTariffId('');
      return;
    }
    if (courseEditSubTariffId && !editSubTariffOptions.some((item: any) => item.id === courseEditSubTariffId)) {
      setCourseEditSubTariffId('');
    }
  }, [courseEditTariffId, courseEditSubTariffId, editSubTariffOptions]);

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

  const resolveCourseDeleteAction = (
    currentEntry: { saleIncomeId: string; label: string },
    allEntries: Array<{ saleIncomeId: string; label: string }>,
  ): { action: 'delete' | 'refund' | 'relink'; targetSaleIncomeId?: string } | null => {
    const choice = window.prompt(
      "Kursni o'chirish varianti:\n1) Daromadni boshqa kursga o'tkazish\n2) Refund so'rovi yaratish\n3) Daromadni izsiz o'chirish\n\n1, 2 yoki 3 kiriting:",
      '3',
    );
    if (!choice) return null;
    if (choice === '3') return { action: 'delete' };
    if (choice === '2') return { action: 'refund' };
    if (choice !== '1') {
      window.alert("Noto'g'ri tanlov. 1, 2 yoki 3 ni kiriting.");
      return null;
    }
    const targetEntries = allEntries.filter((entry) => entry.saleIncomeId !== currentEntry.saleIncomeId);
    if (!targetEntries.length) {
      window.alert("Daromadni o'tkazish uchun mijozda boshqa aktiv kurs yo'q.");
      return null;
    }
    const targetPrompt = targetEntries.map((entry, index) => `${index + 1}) ${entry.label}`).join('\n');
    const selectedTargetRaw = window.prompt(`Daromad qaysi kursga o'tkazilsin?\n${targetPrompt}\n\nRaqamini kiriting:`, '1');
    if (!selectedTargetRaw) return null;
    const selectedTargetIndex = Number(selectedTargetRaw) - 1;
    const selectedTarget = targetEntries[selectedTargetIndex];
    if (!selectedTarget) {
      window.alert("Noto'g'ri kurs tanlandi.");
      return null;
    }
    return { action: 'relink', targetSaleIncomeId: selectedTarget.saleIncomeId };
  };

  const handleDeleteCustomerCourse = async (
    currentEntry: { saleIncomeId: string; label: string },
    allEntries: Array<{ saleIncomeId: string; label: string }>,
  ) => {
    const confirmed = window.confirm(`"${currentEntry.label}" kursi uchun amalni davom ettirasizmi?`);
    if (!confirmed) {
      return;
    }

    const actionPayload = resolveCourseDeleteAction(currentEntry, allEntries);
    if (!actionPayload) return;

    setActionError(null);
    setActionSuccess(null);

    try {
      setDeletingCourseSaleId(currentEntry.saleIncomeId);
      const result = await deleteCustomerCourseMutation.mutateAsync({
        saleIncomeId: currentEntry.saleIncomeId,
        action: actionPayload.action,
        targetSaleIncomeId: actionPayload.targetSaleIncomeId,
      });
      await Promise.all([detailQuery.refetch(), customersQuery.refetch()]);
      if (result.mode === 'refund') {
        setActionSuccess("Refund so'rovi yaratildi va moliya tasdig'iga yuborildi.");
      } else if (result.mode === 'relink') {
        setActionSuccess(`Daromad boshqa kursga o'tkazildi. O'chirilgan yozuvlar: ${result.deletedCount}.`);
      } else {
        setActionSuccess(`Kurs o'chirildi. O'chirilgan yozuvlar: ${result.deletedCount}.`);
      }
    } catch (error: any) {
      setActionError(error?.message || "Mijoz kursini o'chirib bo'lmadi.");
    } finally {
      setDeletingCourseSaleId('');
    }
  };

  const openCourseEditorModal = (customerId: string) => {
    setActionError(null);
    setActionSuccess(null);
    setCourseEditorCustomerId(customerId);
    setIsCourseEditorModalOpen(true);
    setEditingSaleIncomeId('');
    setCourseEditCourseId('');
    setCourseEditTariffId('');
    setCourseEditSubTariffId('');
  };

  const closeCourseEditorModal = () => {
    setIsCourseEditorModalOpen(false);
    setCourseEditorCustomerId('');
    setEditingSaleIncomeId('');
    setCourseEditCourseId('');
    setCourseEditTariffId('');
    setCourseEditSubTariffId('');
  };

  const startCourseChange = (entry: any) => {
    setEditingSaleIncomeId(entry.saleIncomeId);
    setCourseEditCourseId('');
    setCourseEditTariffId('');
    setCourseEditSubTariffId('');
  };

  const handleSaveCourseChange = async () => {
    setActionError(null);
    setActionSuccess(null);

    if (!editingSaleIncomeId) {
      setActionError("Tahrirlanadigan kurs topilmadi.");
      return;
    }
    if (!courseEditCourseId) {
      setActionError('Yangi kursni tanlang.');
      return;
    }

    try {
      await updateCustomerCourseSaleMutation.mutateAsync({
        saleIncomeId: editingSaleIncomeId,
        newCourseId: courseEditCourseId,
        newTariffId: courseEditTariffId || undefined,
        newSubTariffId: courseEditSubTariffId || undefined,
      });
      await Promise.all([detailQuery.refetch(), customersQuery.refetch()]);
      setActionSuccess("Mijoz kursi muvaffaqiyatli yangilandi.");
      setEditingSaleIncomeId('');
      setCourseEditCourseId('');
      setCourseEditTariffId('');
      setCourseEditSubTariffId('');
    } catch (error: any) {
      setActionError(error?.message || "Mijoz kursini yangilab bo'lmadi.");
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
                            <div key={entry.saleIncomeId} className="flex items-center gap-2">
                              <span className="truncate">{entry.label}</span>
                            </div>
                          ))}
                          {isAdmin && (
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={() => openCourseEditorModal(row.customerId)}
                                className="rounded border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                              >
                                Tahrirlash
                              </button>
                            </div>
                          )}
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

      {isAdmin && isCourseEditorModalOpen && courseEditorCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Mijoz kurslarini tahrirlash</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {courseEditorCustomer.customerNumber} - {courseEditorCustomer.customerName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCourseEditorModal}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Yopish
                </button>
              </div>
            </div>

            <div className="max-h-[75vh] space-y-4 overflow-auto px-6 py-5">
              {(Array.isArray(courseEditorCustomer.customerCourses) && courseEditorCustomer.customerCourses.length
                ? courseEditorCustomer.customerCourses
                : [{
                    saleIncomeId: courseEditorCustomer.saleId,
                    label: [courseEditorCustomer.courseName, courseEditorCustomer.tariffName, courseEditorCustomer.subTariffName]
                      .filter(Boolean)
                      .join(' / ') || '-',
                    entryDate: courseEditorCustomer.entryDate,
                    remainingDebtAmount: courseEditorCustomer.debtAmount || 0,
                  }]).map((entry: any) => (
                <div key={entry.saleIncomeId} className="rounded-md border border-gray-200 bg-gray-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{entry.label}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Sana: {formatDate(entry.entryDate)} | Joriy qarz: {formatAmount(entry.remainingDebtAmount || 0)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startCourseChange(entry)}
                        className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                      >
                        Kursni o&apos;zgartirish
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomerCourse(entry, courseEditorCustomer.customerCourses || [])}
                        disabled={deletingCourseSaleId === entry.saleIncomeId}
                        className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingCourseSaleId === entry.saleIncomeId ? "O'chirilmoqda..." : "Kursni o'chirish"}
                      </button>
                    </div>
                  </div>

                  {editingSaleIncomeId === entry.saleIncomeId && (
                    <div className="mt-4 space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div>
                          <label className="block text-xs font-medium uppercase text-gray-600">Yangi kurs</label>
                          <select
                            value={courseEditCourseId}
                            onChange={(event) => setCourseEditCourseId(event.target.value)}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                          >
                            <option value="">Kurs tanlang</option>
                            {editorCourses.map((courseOption: any) => (
                              <option key={courseOption.id} value={courseOption.id}>
                                {courseOption.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium uppercase text-gray-600">Yangi tarif</label>
                          <select
                            value={courseEditTariffId}
                            onChange={(event) => setCourseEditTariffId(event.target.value)}
                            disabled={!courseEditCourseId}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                          >
                            <option value="">Tarif tanlanmagan</option>
                            {editTariffOptions.map((tariffOption: any) => (
                              <option key={tariffOption.id} value={tariffOption.id}>
                                {tariffOption.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium uppercase text-gray-600">Yangi subtarif</label>
                          <select
                            value={courseEditSubTariffId}
                            onChange={(event) => setCourseEditSubTariffId(event.target.value)}
                            disabled={!courseEditTariffId || !editSubTariffOptions.length}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                          >
                            <option value="">Subtarif tanlanmagan</option>
                            {editSubTariffOptions.map((subTariffOption: any) => (
                              <option key={subTariffOption.id} value={subTariffOption.id}>
                                {subTariffOption.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={handleSaveCourseChange}
                          disabled={updateCustomerCourseSaleMutation.isLoading}
                          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {updateCustomerCourseSaleMutation.isLoading ? 'Saqlanmoqda...' : "O'zgarishni saqlash"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSaleIncomeId('');
                            setCourseEditCourseId('');
                            setCourseEditTariffId('');
                            setCourseEditSubTariffId('');
                          }}
                          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Bekor qilish
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
