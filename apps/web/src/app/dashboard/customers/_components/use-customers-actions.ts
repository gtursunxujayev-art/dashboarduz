'use client';

import { formatTashkentDate } from '@/lib/format';
import { normalizeDigits } from '@dashboarduz/shared';
import { useMemo } from 'react';
import { sanitizeTelegram } from './customer-helpers';
import type { useCustomersState } from './use-customers-state';

export function useCustomersActions(base: ReturnType<typeof useCustomersState>) {
  const { bulkCourseId, bulkSubTariffId, bulkTariffId, courseEditCourseId, courseEditSubTariffId, courseEditTariffId, courseEditorCustomer, createCustomerOnlyMutation, customers, customersQuery, deleteCustomerCourseMutation, deleteCustomersMutation, editingSaleIncomeId, editorOptionsQuery, identityCustomerId, identityCustomerName, identityCustomerNumber, isAdmin, newCourseId, newCustomerName, newCustomerNumber, newSubTariffId, newTariffId, newTelegram, searchInput, selectedCustomerIds, setCourseEditCourseId, setCourseEditSubTariffId, setCourseEditTariffId, setCourseEditorCustomerId, setDeletingCourseSaleId, setDetailsCustomerId, setEditingSaleIncomeId, setIdentityCustomerId, setIdentityCustomerName, setIdentityCustomerNumber, setIsAddModalOpen, setIsCourseEditorModalOpen, setIsDetailsModalOpen, setIsIdentityModalOpen, setNewCourseId, setNewCustomerName, setNewCustomerNumber, setNewSubTariffId, setNewTariffId, setNewTelegram, setPageError, setPageSuccess, setQuery, setSearchInput, setSelectedCustomerIds, updateCustomerCourseSaleMutation, updateCustomerIdentityMutation, updateCustomersCourseAssignmentMutation } = base;

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
  const handleDownloadFilteredCustomers = async () => {
    if (!customers.length) {
      setPageError("Yuklab olish uchun mijozlar ro'yxati bo'sh.");
      return;
    }

    const XLSX = await import('xlsx');
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
      formatTashkentDate(customer.lastActivityAt),
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
      setPageSuccess(
        `${result.updatedCount} ta mijoz yangilandi. Aktiv income: ${result.updatedSalesCount || 0} ta sotuv, ${result.updatedRepaymentsCount || 0} ta to'lov yozuvi.`,
      );
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
      `Tanlangan ${selectedCustomerIds.length} ta mijozni o'chirmoqchimisiz? Ularning barcha to'lovlari va so'rovlari ham o'chiriladi. Bu amal qaytarilmaydi.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      const result = await deleteCustomersMutation.mutateAsync({
        customerIds: selectedCustomerIds,
      });
      setPageSuccess(`${result.deletedCount} ta mijoz o'chirildi (${result.deletedIncomeCount} ta to'lov, ${result.deletedRequestCount} ta so'rov bilan).`);
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
        const relinkedCount = Number((result as any)?.relinkedCount ?? 0);
        setPageSuccess(`Daromad boshqa kursga o'tkazildi. O'tkazilgan yozuvlar: ${relinkedCount}.`);
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
  const openDetailsModal = (customerId: string) => {
    setDetailsCustomerId(customerId);
    setIsDetailsModalOpen(true);
  };
  const openCourseEditorModal = (customerId: string) => {
    setPageError(null);
    setPageSuccess(null);
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
    if (!courseEditorCustomer) {
      return;
    }
    const initialSubTariffId = entry.subTariffId
      || (
        courseEditorCustomer.profileTariffId === entry.tariffId
          ? (courseEditorCustomer.profileSubTariffId || '')
          : ''
      );

    setEditingSaleIncomeId(entry.saleIncomeId);
    setCourseEditCourseId(entry.courseId || '');
    setCourseEditTariffId(entry.tariffId || '');
    setCourseEditSubTariffId(initialSubTariffId);
  };
  const handleSaveCourseChange = async () => {
    setPageError(null);
    setPageSuccess(null);

    if (!editingSaleIncomeId) {
      setPageError("Tahrirlanadigan kurs topilmadi.");
      return;
    }
    if (!courseEditCourseId) {
      setPageError('Yangi kursni tanlang.');
      return;
    }

    try {
      await updateCustomerCourseSaleMutation.mutateAsync({
        saleIncomeId: editingSaleIncomeId,
        newCourseId: courseEditCourseId,
        newTariffId: courseEditTariffId || undefined,
        newSubTariffId: courseEditSubTariffId || undefined,
      });

      setPageSuccess("Mijoz kursi muvaffaqiyatli yangilandi.");
      setEditingSaleIncomeId('');
      setCourseEditCourseId('');
      setCourseEditTariffId('');
      setCourseEditSubTariffId('');
      await handleRefresh();
    } catch (error: any) {
      setPageError(error?.message || "Mijoz kursini yangilab bo'lmadi.");
    }
  };
  const handleUpdateCustomerIdentity = async () => {
    setPageError(null);
    setPageSuccess(null);

    const customerNumber = normalizeDigits(identityCustomerNumber);
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

    const customerNumber = normalizeDigits(newCustomerNumber);
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

  return { ...base, selectedCount, allVisibleIds, isAllSelected, handleToggleCustomer, handleToggleSelectAll, applySearch, clearSearch, handleRefresh, handleDownloadFilteredCustomers, handleBulkAssign, handleBulkDelete, resolveCourseDeleteAction, handleDeleteCustomerCourse, resetAddModal, resetIdentityModal, openIdentityModal, openDetailsModal, openCourseEditorModal, closeCourseEditorModal, startCourseChange, handleSaveCourseChange, handleUpdateCustomerIdentity, handleCreateCustomerOnly };
}
