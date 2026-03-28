'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import * as XLSX from 'xlsx';

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

function sanitizeCustomerNumber(value: string): string {
  return value.replace(/\D/g, '');
}

function sanitizeTelegram(value: string): string {
  return value.replace(/\s+/g, '').replace(/[^A-Za-z0-9_@]/g, '');
}

export default function CustomersPage() {
  const { user } = useAuth();
  const roles = user?.roles || [];
  const isAdmin = Boolean(user?.roles?.includes('Admin'));
  const isTashkiliyOnly = Boolean(
    roles.includes('Tashkiliy')
      && !roles.includes('Admin')
      && !roles.includes('Manager')
      && !roles.includes('Agent')
      && !roles.includes('Finance'),
  );

  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [courseId, setCourseId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [subTariffId, setSubTariffId] = useState('');
  const [debtFilter, setDebtFilter] = useState<DebtFilter>('all');

  const [pageError, setPageError] = useState<string | null>(null);
  const [pageSuccess, setPageSuccess] = useState<string | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);

  const [bulkCourseId, setBulkCourseId] = useState('');
  const [bulkTariffId, setBulkTariffId] = useState('');
  const [bulkSubTariffId, setBulkSubTariffId] = useState('');

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newCustomerNumber, setNewCustomerNumber] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [newTelegram, setNewTelegram] = useState('');
  const [newCourseId, setNewCourseId] = useState('');
  const [newTariffId, setNewTariffId] = useState('');
  const [newSubTariffId, setNewSubTariffId] = useState('');

  const [isIdentityModalOpen, setIsIdentityModalOpen] = useState(false);
  const [identityCustomerId, setIdentityCustomerId] = useState('');
  const [identityCustomerNumber, setIdentityCustomerNumber] = useState('');
  const [identityCustomerName, setIdentityCustomerName] = useState('');
  const [deletingCourseSaleId, setDeletingCourseSaleId] = useState('');

  const customersQuery = trpc.customerIncome.listCustomers.useQuery(
    {
      query: query.trim() || undefined,
      courseId: courseId || undefined,
      tariffId: tariffId || undefined,
      subTariffId: subTariffId || undefined,
      debtFilter,
      limit: 500,
    },
    {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      keepPreviousData: true,
    },
  );

  const editorOptionsQuery = trpc.customerIncome.customerEditorOptions.useQuery(undefined, {
    retry: false,
    enabled: isAdmin,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const createCustomerOnlyMutation = trpc.customerIncome.createCustomerOnly.useMutation();
  const updateCustomerIdentityMutation = trpc.customerIncome.updateCustomerIdentity.useMutation();
  const updateCustomersCourseAssignmentMutation = trpc.customerIncome.updateCustomersCourseAssignment.useMutation();
  const deleteCustomersMutation = trpc.customerIncome.deleteCustomers.useMutation();
  const deleteCustomerCourseMutation = trpc.customerIncome.deleteCustomerCourse.useMutation();

  const customers = useMemo(() => customersQuery.data?.customers || [], [customersQuery.data]);
  const courseOptions = useMemo(() => customersQuery.data?.courseOptions || [], [customersQuery.data]);
  const catalogOptions = useMemo(() => customersQuery.data?.catalogOptions || [], [customersQuery.data]);
  const withDebtCount = customers.filter((customer: any) => customer.hasDebt).length;

  const filterTariffOptions = useMemo(() => {
    if (!courseId) {
      return [];
    }
    const course = (catalogOptions as any[]).find((item: any) => item.id === courseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [catalogOptions, courseId]);

  const filterSubTariffOptions = useMemo(() => {
    if (!tariffId) {
      return [];
    }
    const tariff = (filterTariffOptions as any[]).find((item: any) => item.id === tariffId);
    return Array.isArray(tariff?.subTariffs) ? tariff.subTariffs : [];
  }, [filterTariffOptions, tariffId]);

  const editorCourses = useMemo(() => editorOptionsQuery.data || [], [editorOptionsQuery.data]);

  const bulkTariffOptions = useMemo(() => {
    if (!bulkCourseId) {
      return [];
    }
    const course = editorCourses.find((item: any) => item.id === bulkCourseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [editorCourses, bulkCourseId]);

  const bulkSubTariffOptions = useMemo(() => {
    if (!bulkTariffId) {
      return [];
    }
    const tariff = bulkTariffOptions.find((item: any) => item.id === bulkTariffId);
    return Array.isArray(tariff?.subTariffs) ? tariff.subTariffs : [];
  }, [bulkTariffId, bulkTariffOptions]);

  const newTariffOptions = useMemo(() => {
    if (!newCourseId) {
      return [];
    }
    const course = editorCourses.find((item: any) => item.id === newCourseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [editorCourses, newCourseId]);

  const newSubTariffOptions = useMemo(() => {
    if (!newTariffId) {
      return [];
    }
    const tariff = newTariffOptions.find((item: any) => item.id === newTariffId);
    return Array.isArray(tariff?.subTariffs) ? tariff.subTariffs : [];
  }, [newTariffId, newTariffOptions]);

  useEffect(() => {
    if (!editMode) {
      setSelectedCustomerIds([]);
      setBulkCourseId('');
      setBulkTariffId('');
      setBulkSubTariffId('');
    }
  }, [editMode]);

  useEffect(() => {
    if (!courseId) {
      setTariffId('');
      setSubTariffId('');
      return;
    }
    if (
      tariffId
      && filterTariffOptions.length > 0
      && !filterTariffOptions.some((item: any) => item.id === tariffId)
    ) {
      setTariffId('');
      setSubTariffId('');
    }
  }, [courseId, tariffId, filterTariffOptions]);

  useEffect(() => {
    if (!tariffId) {
      setSubTariffId('');
      return;
    }
    if (
      subTariffId
      && filterSubTariffOptions.length > 0
      && !filterSubTariffOptions.some((item: any) => item.id === subTariffId)
    ) {
      setSubTariffId('');
    }
  }, [tariffId, subTariffId, filterSubTariffOptions]);

  useEffect(() => {
    if (!bulkCourseId) {
      setBulkTariffId('');
      setBulkSubTariffId('');
      return;
    }
    if (bulkTariffId && !bulkTariffOptions.some((item: any) => item.id === bulkTariffId)) {
      setBulkTariffId('');
      setBulkSubTariffId('');
    }
  }, [bulkCourseId, bulkTariffId, bulkTariffOptions]);

  useEffect(() => {
    if (!bulkTariffId) {
      setBulkSubTariffId('');
      return;
    }
    if (bulkSubTariffId && !bulkSubTariffOptions.some((item: any) => item.id === bulkSubTariffId)) {
      setBulkSubTariffId('');
    }
  }, [bulkTariffId, bulkSubTariffId, bulkSubTariffOptions]);

  useEffect(() => {
    if (!newCourseId) {
      setNewTariffId('');
      setNewSubTariffId('');
      return;
    }
    if (newTariffId && !newTariffOptions.some((item: any) => item.id === newTariffId)) {
      setNewTariffId('');
      setNewSubTariffId('');
    }
  }, [newCourseId, newTariffId, newTariffOptions]);

  useEffect(() => {
    if (!newTariffId) {
      setNewSubTariffId('');
      return;
    }
    if (newSubTariffId && !newSubTariffOptions.some((item: any) => item.id === newSubTariffId)) {
      setNewSubTariffId('');
    }
  }, [newTariffId, newSubTariffId, newSubTariffOptions]);

  const selectedCount = selectedCustomerIds.length;
  const allVisibleIds = useMemo(() => customers.map((customer: any) => customer.id), [customers]);
  const isAllSelected = allVisibleIds.length > 0 && allVisibleIds.every((id: string) => selectedCustomerIds.includes(id));

  const handleToggleCustomer = (customerId: string) => {
    setSelectedCustomerIds((prev) => (
      prev.includes(customerId) ? prev.filter((id) => id !== customerId) : [...prev, customerId]
    ));
  };

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedCustomerIds((prev) => prev.filter((id) => !allVisibleIds.includes(id)));
      return;
    }
    setSelectedCustomerIds((prev) => Array.from(new Set([...prev, ...allVisibleIds])));
  };

  const applySearch = () => {
    setQuery(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput('');
    setQuery('');
  };

  const handleRefresh = async () => {
    await customersQuery.refetch();
    if (isAdmin) {
      await editorOptionsQuery.refetch();
    }
  };

  const handleDownloadFilteredCustomers = () => {
    if (!customers.length) {
      setPageError("Yuklab olish uchun mijozlar ro'yxati bo'sh.");
      return;
    }

    const headers = [
      'Mijoz raqami',
      'Mijoz ismi',
      'Telegram',
      "Mas'ul agent",
      'Profil kurs',
      'Profil tarif',
      'Profil subtarif',
      'Kurslar',
      'Qarz',
      'Jami tolangan',
      'Oxirgi faollik',
    ];

    const rows = customers.map((customer: any) => ([
      customer.customerNumber || '',
      customer.name || '',
      customer.telegramUsername || '',
      customer.responsibleManagerLabel || '',
      customer.profileCourseName || '',
      customer.profileTariffName || '',
      customer.profileSubTariffName || '',
      Array.isArray(customer.courses) ? customer.courses.join(' | ') : '',
      customer.totalDebtAmount ?? 0,
      customer.totalPaidAmount ?? 0,
      formatDate(customer.lastActivityAt),
    ]));

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Mijozlar');
    const workbookBuffer = XLSX.write(workbook, { bookType: 'xls', type: 'array' });
    const blob = new Blob([workbookBuffer], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
    anchor.href = url;
    anchor.download = `mijozlar-${today}.xls`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleBulkAssign = async () => {
    setPageError(null);
    setPageSuccess(null);

    if (!selectedCustomerIds.length) {
      setPageError('Kamida bitta mijoz tanlang.');
      return;
    }

    try {
      const result = await updateCustomersCourseAssignmentMutation.mutateAsync({
        customerIds: selectedCustomerIds,
        courseId: bulkCourseId || null,
        tariffId: bulkTariffId || null,
        subTariffId: bulkSubTariffId || null,
      });
      setPageSuccess(`${result.updatedCount} ta mijoz uchun kurs/tarif yangilandi.`);
      await handleRefresh();
      setSelectedCustomerIds([]);
    } catch (error: any) {
      setPageError(error?.message || "Mijozlar uchun kursni o'zgartirib bo'lmadi.");
    }
  };

  const handleBulkDelete = async () => {
    setPageError(null);
    setPageSuccess(null);

    if (!selectedCustomerIds.length) {
      setPageError('Kamida bitta mijoz tanlang.');
      return;
    }

    const confirmed = window.confirm(
      `Tanlangan ${selectedCustomerIds.length} ta mijozni o'chirmoqchimisiz? Bu amal qaytarilmaydi.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      const result = await deleteCustomersMutation.mutateAsync({
        customerIds: selectedCustomerIds,
      });
      setPageSuccess(`${result.deletedCount} ta mijoz o'chirildi.`);
      await handleRefresh();
      setSelectedCustomerIds([]);
    } catch (error: any) {
      setPageError(error?.message || "Mijozlarni o'chirib bo'lmadi.");
    }
  };

  const resolveCourseDeleteAction = (
    currentEntry: { saleIncomeId: string; label: string },
    allEntries: Array<{ saleIncomeId: string; label: string }>,
  ): { action: 'delete' | 'refund' | 'relink'; targetSaleIncomeId?: string } | null => {
    const choice = window.prompt(
      "Kursni o'chirish varianti:\n1) Daromadni boshqa kursga o'tkazish\n2) Refund so'rovi yaratish\n3) Daromadni izsiz o'chirish\n\n1, 2 yoki 3 kiriting:",
      '3',
    );

    if (!choice) {
      return null;
    }

    if (choice === '3') {
      return { action: 'delete' };
    }
    if (choice === '2') {
      return { action: 'refund' };
    }
    if (choice !== '1') {
      window.alert("Noto'g'ri tanlov. 1, 2 yoki 3 ni kiriting.");
      return null;
    }

    const targetEntries = allEntries.filter((entry) => entry.saleIncomeId !== currentEntry.saleIncomeId);
    if (!targetEntries.length) {
      window.alert("Daromadni o'tkazish uchun mijozda boshqa aktiv kurs yo'q.");
      return null;
    }

    const targetPrompt = targetEntries
      .map((entry, index) => `${index + 1}) ${entry.label}`)
      .join('\n');
    const selectedTargetRaw = window.prompt(`Daromad qaysi kursga o'tkazilsin?\n${targetPrompt}\n\nRaqamini kiriting:`, '1');
    if (!selectedTargetRaw) {
      return null;
    }
    const selectedTargetIndex = Number(selectedTargetRaw) - 1;
    const selectedTarget = targetEntries[selectedTargetIndex];
    if (!selectedTarget) {
      window.alert("Noto'g'ri kurs tanlandi.");
      return null;
    }

    return {
      action: 'relink',
      targetSaleIncomeId: selectedTarget.saleIncomeId,
    };
  };

  const handleDeleteCustomerCourse = async (
    currentEntry: { saleIncomeId: string; label: string },
    allEntries: Array<{ saleIncomeId: string; label: string }>,
  ) => {
    setPageError(null);
    setPageSuccess(null);

    const confirmed = window.confirm(`"${currentEntry.label}" kursi uchun amalni davom ettirasizmi?`);
    if (!confirmed) {
      return;
    }

    const actionPayload = resolveCourseDeleteAction(currentEntry, allEntries);
    if (!actionPayload) {
      return;
    }

    try {
      setDeletingCourseSaleId(currentEntry.saleIncomeId);
      const result = await deleteCustomerCourseMutation.mutateAsync({
        saleIncomeId: currentEntry.saleIncomeId,
        action: actionPayload.action,
        targetSaleIncomeId: actionPayload.targetSaleIncomeId,
      });
      if (result.mode === 'refund') {
        setPageSuccess("Refund so'rovi yaratildi va moliya tasdig'iga yuborildi.");
      } else if (result.mode === 'relink') {
        setPageSuccess(`Daromad boshqa kursga o'tkazildi. O'chirilgan yozuvlar: ${result.deletedCount}.`);
      } else {
        setPageSuccess(`Kurs o'chirildi. O'chirilgan yozuvlar: ${result.deletedCount}.`);
      }
      await handleRefresh();
    } catch (error: any) {
      setPageError(error?.message || "Mijoz kursini o'chirib bo'lmadi.");
    } finally {
      setDeletingCourseSaleId('');
    }
  };

  const resetAddModal = () => {
    setNewCustomerNumber('');
    setNewCustomerName('');
    setNewTelegram('');
    setNewCourseId('');
    setNewTariffId('');
    setNewSubTariffId('');
  };

  const resetIdentityModal = () => {
    setIdentityCustomerId('');
    setIdentityCustomerNumber('');
    setIdentityCustomerName('');
  };

  const openIdentityModal = (customer: any) => {
    setPageError(null);
    setPageSuccess(null);
    setIdentityCustomerId(customer.id);
    setIdentityCustomerNumber(customer.customerNumber || '');
    setIdentityCustomerName(customer.name || '');
    setIsIdentityModalOpen(true);
  };

  const handleUpdateCustomerIdentity = async () => {
    setPageError(null);
    setPageSuccess(null);

    const customerNumber = sanitizeCustomerNumber(identityCustomerNumber);
    const name = identityCustomerName.trim();

    if (!identityCustomerId) {
      setPageError("Mijoz identifikatori topilmadi.");
      return;
    }

    if (!customerNumber) {
      setPageError("Mijoz raqami kiritilishi shart.");
      return;
    }

    if (!name) {
      setPageError("Mijoz ismi kiritilishi shart.");
      return;
    }

    try {
      await updateCustomerIdentityMutation.mutateAsync({
        customerId: identityCustomerId,
        customerNumber,
        name,
      });
      setPageSuccess("Mijoz raqami va ismi yangilandi.");
      setIsIdentityModalOpen(false);
      resetIdentityModal();
      await handleRefresh();
    } catch (error: any) {
      setPageError(error?.message || "Mijoz ma'lumotlarini yangilab bo'lmadi.");
    }
  };

  const handleCreateCustomerOnly = async () => {
    setPageError(null);
    setPageSuccess(null);

    const customerNumber = sanitizeCustomerNumber(newCustomerNumber);
    if (!customerNumber) {
      setPageError("Mijoz raqami kiritilishi shart.");
      return;
    }
    if (!newCustomerName.trim()) {
      setPageError("Mijoz ismi kiritilishi shart.");
      return;
    }

    try {
      await createCustomerOnlyMutation.mutateAsync({
        customerNumber,
        name: newCustomerName.trim(),
        telegramUsername: sanitizeTelegram(newTelegram) || undefined,
        courseId: newCourseId || undefined,
        tariffId: newTariffId || undefined,
        subTariffId: newSubTariffId || undefined,
      });
      setPageSuccess("Mijoz muvaffaqiyatli qo'shildi.");
      setIsAddModalOpen(false);
      resetAddModal();
      await handleRefresh();
    } catch (error: any) {
      setPageError(error?.message || "Mijozni qo'shib bo'lmadi.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">Mijozlar</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
            Kurs va qarzdorlik bo&apos;yicha filtrlangan mijozlar ro&apos;yxati.
          </p>
        </div>

        <div className="space-y-4 p-6">
          {pageError && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {pageError}
            </p>
          )}
          {pageSuccess && (
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">
              {pageSuccess}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                applySearch();
              }}
              className="flex gap-2 md:col-span-2"
            >
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Raqam yoki ism bo'yicha qidirish"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Qidirish
              </button>
              <button
                type="button"
                onClick={clearSearch}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Tozalash
              </button>
            </form>

            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="">Barcha kurslar</option>
              {courseOptions.map((course: any) => (
                <option key={course.id} value={course.id}>
                  {course.name}
                </option>
              ))}
            </select>

            <select
              value={tariffId}
              onChange={(event) => setTariffId(event.target.value)}
              disabled={!courseId}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
            >
              <option value="">Barcha tariflar</option>
              {filterTariffOptions.map((tariff: any) => (
                <option key={tariff.id} value={tariff.id}>
                  {tariff.name}
                </option>
              ))}
            </select>

            {filterSubTariffOptions.length > 0 && (
              <select
                value={subTariffId}
                onChange={(event) => setSubTariffId(event.target.value)}
                disabled={!tariffId}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
              >
                <option value="">Barcha subtariflar</option>
                {filterSubTariffOptions.map((subTariff: any) => (
                  <option key={subTariff.id} value={subTariff.id}>
                    {subTariff.name}
                  </option>
                ))}
              </select>
            )}

            <select
              value={debtFilter}
              onChange={(event) => setDebtFilter(event.target.value as DebtFilter)}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <option value="all">Barcha qarz holatlari</option>
              <option value="with_debt">Qarzdorlar</option>
              <option value="without_debt">Qarzsizlar</option>
            </select>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPageError(null);
                  setPageSuccess(null);
                  setEditMode((prev) => !prev);
                }}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  editMode
                    ? 'bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-200'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {editMode ? 'Tahrirlashni yopish' : "O'zgartirish"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPageError(null);
                  setPageSuccess(null);
                  resetAddModal();
                  setIsAddModalOpen(true);
                }}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Qo&apos;shish
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadFilteredCustomers}
              disabled={customersQuery.isLoading || customers.length === 0}
              className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
            >
              Filtrlangan ro&apos;yxatni yuklab olish
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Jami mijozlar</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">{customers.length}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Qarzdor mijozlar</p>
              <p className="text-lg font-semibold text-amber-700 dark:text-amber-300">{withDebtCount}</p>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-xs uppercase text-gray-500 dark:text-slate-400">Qarzsiz mijozlar</p>
              <p className="text-lg font-semibold text-green-700 dark:text-green-300">{Math.max(customers.length - withDebtCount, 0)}</p>
            </div>
          </div>

          {isAdmin && editMode && (
            <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
              <div className="text-sm text-blue-900 dark:text-blue-200">
                Tanlangan mijozlar: <strong>{selectedCount}</strong>
              </div>

              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <select
                  value={bulkCourseId}
                  onChange={(event) => setBulkCourseId(event.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Kursni tozalash</option>
                  {editorCourses.map((course: any) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>

                <select
                  value={bulkTariffId}
                  onChange={(event) => setBulkTariffId(event.target.value)}
                  disabled={!bulkCourseId}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                >
                  <option value="">Tarifni tozalash</option>
                  {bulkTariffOptions.map((tariff: any) => (
                    <option key={tariff.id} value={tariff.id}>
                      {tariff.name}
                    </option>
                  ))}
                </select>

                <select
                  value={bulkSubTariffId}
                  onChange={(event) => setBulkSubTariffId(event.target.value)}
                  disabled={!bulkTariffId || bulkSubTariffOptions.length === 0}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                >
                  <option value="">Subtarifni tozalash</option>
                  {bulkSubTariffOptions.map((subTariff: any) => (
                    <option key={subTariff.id} value={subTariff.id}>
                      {subTariff.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleBulkAssign}
                  disabled={selectedCount === 0 || updateCustomersCourseAssignmentMutation.isLoading}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {updateCustomersCourseAssignmentMutation.isLoading ? 'Saqlanmoqda...' : "Kursni o'zgartirish"}
                </button>
                <button
                  type="button"
                  onClick={handleBulkDelete}
                  disabled={selectedCount === 0 || deleteCustomersMutation.isLoading}
                  className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteCustomersMutation.isLoading ? "O'chirilmoqda..." : "Mijozlarni o'chirish"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="px-6 py-5">
          {customersQuery.isLoading ? (
            <p className="text-sm text-gray-600 dark:text-slate-300">Mijozlar yuklanmoqda...</p>
          ) : customersQuery.error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {customersQuery.error.message || "Mijozlarni yuklab bo'lmadi."}
            </p>
          ) : customers.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    {isAdmin && editMode && (
                      <th className="px-4 py-3 text-left">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={handleToggleSelectAll}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600"
                        />
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Mijoz raqami</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Mijoz ismi</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Telegram</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Mas&apos;ul agent</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Kurslar</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Qarz</th>
                    {!isTashkiliyOnly && (
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Jami to&apos;langan</th>
                    )}
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Oxirgi faollik</th>
                    {isAdmin && editMode && (
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-slate-400">Amal</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                  {customers.map((customer: any) => (
                    <tr key={customer.id}>
                      {isAdmin && editMode && (
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          <input
                            type="checkbox"
                            checked={selectedCustomerIds.includes(customer.id)}
                            onChange={() => handleToggleCustomer(customer.id)}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600"
                          />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-100">{customer.customerNumber}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{customer.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{customer.telegramUsername || '-'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{customer.responsibleManagerLabel || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                        {Array.isArray(customer.courseEntries) && customer.courseEntries.length ? (
                          <div className="space-y-1">
                            {customer.courseEntries.map((entry: any) => (
                              <div key={entry.saleIncomeId} className="flex items-center justify-between gap-2">
                                <span className="truncate">{entry.label}</span>
                                {isAdmin && editMode && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteCustomerCourse(entry, customer.courseEntries || [])}
                                    disabled={deletingCourseSaleId === entry.saleIncomeId}
                                    className="rounded border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50"
                                  >
                                    {deletingCourseSaleId === entry.saleIncomeId ? "O'chirilmoqda..." : "Kursni o'chirish"}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : Array.isArray(customer.courses) && customer.courses.length ? (
                          customer.courses.join(', ')
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm">
                        <span className={customer.hasDebt ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-green-700 dark:text-green-300'}>
                          {formatAmount(customer.totalDebtAmount || 0)}
                        </span>
                      </td>
                      {!isTashkiliyOnly && (
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{formatAmount(customer.totalPaidAmount || 0)}</td>
                      )}
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{formatDate(customer.lastActivityAt)}</td>
                      {isAdmin && editMode && (
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          <button
                            type="button"
                            onClick={() => openIdentityModal(customer)}
                            className="rounded-md border border-indigo-300 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                          >
                            Ism/raqam
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-slate-300">Tanlangan filtr bo&apos;yicha mijoz topilmadi.</p>
          )}
        </div>
      </div>

      {isAdmin && isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-slate-900">
            <div className="border-b border-gray-100 px-6 py-4 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Mijoz qo&apos;shish</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Daromad qo&apos;shmasdan yangi mijoz yaratish.</p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz raqami</label>
                  <input
                    value={newCustomerNumber}
                    onChange={(event) => setNewCustomerNumber(sanitizeCustomerNumber(event.target.value))}
                    placeholder="Faqat raqam"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz ismi</label>
                  <input
                    value={newCustomerName}
                    onChange={(event) => setNewCustomerName(event.target.value)}
                    placeholder="Ism familya"
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Telegram username</label>
                <input
                  value={newTelegram}
                  onChange={(event) => setNewTelegram(sanitizeTelegram(event.target.value))}
                  placeholder="@username"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Kurs</label>
                  <select
                    value={newCourseId}
                    onChange={(event) => setNewCourseId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="">Tanlanmagan</option>
                    {editorCourses.map((course: any) => (
                      <option key={course.id} value={course.id}>
                        {course.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Tarif</label>
                  <select
                    value={newTariffId}
                    onChange={(event) => setNewTariffId(event.target.value)}
                    disabled={!newCourseId}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                  >
                    <option value="">Tanlanmagan</option>
                    {newTariffOptions.map((tariff: any) => (
                      <option key={tariff.id} value={tariff.id}>
                        {tariff.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Subtarif</label>
                  <select
                    value={newSubTariffId}
                    onChange={(event) => setNewSubTariffId(event.target.value)}
                    disabled={!newTariffId || newSubTariffOptions.length === 0}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                  >
                    <option value="">Tanlanmagan</option>
                    {newSubTariffOptions.map((subTariff: any) => (
                      <option key={subTariff.id} value={subTariff.id}>
                        {subTariff.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setIsAddModalOpen(false);
                  resetAddModal();
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleCreateCustomerOnly}
                disabled={createCustomerOnlyMutation.isLoading}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createCustomerOnlyMutation.isLoading ? "Qo'shilmoqda..." : "Qo'shish"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && isIdentityModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl dark:bg-slate-900">
            <div className="border-b border-gray-100 px-6 py-4 dark:border-slate-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Mijoz ma&apos;lumotini o&apos;zgartirish</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                Bu o&apos;zgarish Tushum, Mijozlar va Kurslar sotuvi bo&apos;limlarida ham aks etadi.
              </p>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz raqami</label>
                <input
                  value={identityCustomerNumber}
                  onChange={(event) => setIdentityCustomerNumber(sanitizeCustomerNumber(event.target.value))}
                  placeholder="Faqat raqam"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz ismi</label>
                <input
                  value={identityCustomerName}
                  onChange={(event) => setIdentityCustomerName(event.target.value)}
                  placeholder="Ism familya"
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  setIsIdentityModalOpen(false);
                  resetIdentityModal();
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleUpdateCustomerIdentity}
                disabled={updateCustomerIdentityMutation.isLoading}
                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {updateCustomerIdentityMutation.isLoading ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
