'use client';

import { formatTashkentDate } from '@/lib/format';
import type { useCourseDetailState } from './use-course-detail-state';

export function useCourseDetailActions(base: ReturnType<typeof useCourseDetailState>) {
  const { courseEditCourseId, courseEditSubTariffId, courseEditTariffId, courseEditorCustomer, courseId, dateFrom, dateTo, deleteCustomerCourseMutation, editingSaleIncomeId, range, searchInput, searchQuery, setActionError, setActionSuccess, setCourseEditCourseId, setCourseEditSubTariffId, setCourseEditTariffId, setCourseEditorCustomerId, setDeletingCourseSaleId, setEditingSaleIncomeId, setIsCourseEditorModalOpen, setSearchInput, setSearchQuery, subTariffId, tariffId, trpcUtils, updateCustomerCourseSaleMutation } = base;

  const applySearch = () => setSearchQuery(searchInput.trim());
  const clearSearch = () => {
    setSearchInput('');
    setSearchQuery('');
  };
  const exportCustomers = async () => {
    try {
      const fetchAllFilteredCustomers = async () => {
        const pageSize = 200;
        let currentPage = 1;
        let totalPages = 1;
        const rows: any[] = [];

        while (currentPage <= totalPages) {
          const response = await trpcUtils.courseSales.customers.fetch({
            courseId,
            tariffId: tariffId || undefined,
            subTariffId: subTariffId || undefined,
            query: searchQuery || undefined,
            range,
            dateFrom: range === 'custom' ? dateFrom : undefined,
            dateTo: range === 'custom' ? dateTo : undefined,
            page: currentPage,
            limit: pageSize,
          });
          rows.push(...(response?.rows ?? []));
          totalPages = Math.max(1, Number(response?.totalPages ?? 1));
          currentPage += 1;
        }

        return rows;
      };

      const XLSX = await import('xlsx');
      const allRows = await fetchAllFilteredCustomers();
      const data = allRows.map((row: any) => ({
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
        "Oxirgi faollik": formatTashkentDate(row.lastActivityAt),
      }));
      const sheet = XLSX.utils.json_to_sheet(data);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, 'Kurs_detal');
      XLSX.writeFile(workbook, `kurs-detali-${courseId}-${Date.now()}.xlsx`);
    } catch (error: any) {
      setActionError(error?.message || "Ro'yxatni yuklab bo'lmadi.");
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
      await Promise.all([
        trpcUtils.courseSales.courseDetail.invalidate(),
        trpcUtils.courseSales.customers.invalidate(),
      ]);
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
    const initialCourseId = entry.courseId || courseId || courseEditorCustomer?.profileCourseId || '';
    const initialTariffId = entry.tariffId || courseEditorCustomer?.profileTariffId || '';
    const initialSubTariffId = entry.subTariffId
      || (
        courseEditorCustomer?.profileCourseId === initialCourseId
        && courseEditorCustomer?.profileTariffId === initialTariffId
          ? (courseEditorCustomer?.profileSubTariffId || '')
          : ''
      );

    setEditingSaleIncomeId(entry.saleIncomeId);
    setCourseEditCourseId(initialCourseId);
    setCourseEditTariffId(initialTariffId);
    setCourseEditSubTariffId(initialSubTariffId);
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
      await Promise.all([
        trpcUtils.courseSales.courseDetail.invalidate(),
        trpcUtils.courseSales.customers.invalidate(),
      ]);
      setActionSuccess("Mijoz kursi muvaffaqiyatli yangilandi.");
      setEditingSaleIncomeId('');
      setCourseEditCourseId('');
      setCourseEditTariffId('');
      setCourseEditSubTariffId('');
    } catch (error: any) {
      setActionError(error?.message || "Mijoz kursini yangilab bo'lmadi.");
    }
  };

  return { ...base, applySearch, clearSearch, exportCustomers, resolveCourseDeleteAction, handleDeleteCustomerCourse, openCourseEditorModal, closeCourseEditorModal, startCourseChange, handleSaveCourseChange };
}
