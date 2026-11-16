'use client';

import { getTashkentToday } from '@/lib/date-range';
import { formatAmountDigits, parseAmountInput } from '@/lib/format';
import { type IncomeType, normalizeDigits, sanitizeTelegramUsername } from '@dashboarduz/shared';
import type { FormEvent } from 'react';
import { type FieldErrors, formatDateForInput, getTelegramDispatchWarning, TELEGRAM_USERNAME_PATTERN } from './income-helpers';
import type { useIncomeForm } from './use-income-form';

export function useIncomeActions(prev: ReturnType<typeof useIncomeForm>) {
  const { canUseRepayment, courseId, coursePriceAmount, createIncomeMutation, customerName, customerNumber, deadline, debtSourceIncomeId, deleteIncomeMutation, editForm, editSubTariffOptions, entryDate, exportDateFrom, exportDateTo, exportIncomesMutation, isAdmin, isExistingCustomer, managerUserId, paymentAmount, resolvedEditSubTariffId, setCourseId, setCoursePriceInput, setCustomerName, setCustomerNumber, setDeadline, setDebtSourceIncomeId, setDeletingIncomeId, setEditError, setEditForm, setEntryDate, setError, setExportError, setExportSuccess, setFieldErrors, setManagerUserId, setPaymentInput, setSkipTelegramNotification, setSubTariffId, setSuccess, setTariffId, setTelegramUsername, setType, skipTelegramNotification, sourceDebtAmount, subTariffId, subTariffOptions, tariffId, telegramUsername, type, updateIncomeMutation, utils } = prev;

  const handleDeleteIncome = async (incomeId: string) => {
    if (!isAdmin) {
      return;
    }
    const confirmed = window.confirm("Bu tushum yozuvini o'chirmoqchimisiz?");
    if (!confirmed) {
      return;
    }

    setError(null);
    setSuccess(null);
    setDeletingIncomeId(incomeId);
    try {
      await deleteIncomeMutation.mutateAsync({ incomeId });
      setSuccess("Tushum yozuvi o'chirildi.");
      await Promise.all([
        utils.customerIncome.formOptions.invalidate(),
        utils.customerIncome.listIncomes.invalidate(),
      ]);
    } catch (deleteError: any) {
      setError(deleteError?.message || "Tushum yozuvini o'chirib bo'lmadi.");
    } finally {
      setDeletingIncomeId(null);
    }
  };
  const handleDownloadIncomesByCustomRange = async () => {
    setExportError(null);
    setExportSuccess(null);

    if (!exportDateFrom || !exportDateTo) {
      setExportError("Boshlanish va tugash sanasini tanlang.");
      return;
    }
    if (exportDateTo < exportDateFrom) {
      setExportError("Tugash sanasi boshlanish sanasidan oldin bo'lishi mumkin emas.");
      return;
    }

    try {
      const result = await exportIncomesMutation.mutateAsync({
        dateFrom: exportDateFrom,
        dateTo: exportDateTo,
      });

      if (!result.rows?.length) {
        setExportError("Tanlangan davrda yuklab olish uchun tushum topilmadi.");
        return;
      }

      const headers = [
        "To'lov sanasi",
        'agent',
        'Mijoz Ism Familiya',
        'Telefon raqami',
        'Telegram username',
        'Kurs turi',
        "To'lov turi",
        'Kelishilgan narx',
        "To'lov summasi",
        'Qarzi',
        'Deadline',
      ];

      const rows = result.rows.map((row) => ([
        formatDateForInput(row.entryDate),
        row.managerLabel || '-',
        row.customerName || '',
        row.customerNumber || '',
        row.telegramUsername || '',
        [row.courseName, row.tariffName, row.subTariffName].filter(Boolean).join(' / ') || '-',
        formatIncomeType(row.type),
        row.agreementAmount == null ? '' : formatAmountDigits(row.agreementAmount),
        formatAmountDigits(row.paymentAmount),
        formatAmountDigits(row.remainingDebtAmount),
        formatDateForInput(row.deadline),
      ]));

      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Tushumlar');
      const workbookBuffer = XLSX.write(workbook, { bookType: 'xls', type: 'array' });
      const blob = new Blob([workbookBuffer], { type: 'application/vnd.ms-excel' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `tushumlar-${exportDateFrom}-${exportDateTo}.xls`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setExportSuccess(`${result.totalCount} ta yozuv yuklab olindi.`);
    } catch (exportErr: any) {
      setExportError(exportErr?.message || "Tushumlarni yuklab olishda xatolik yuz berdi.");
    }
  };
  const openEditIncome = (income: any) => {
    if (!isAdmin) {
      return;
    }
    setEditError(null);
    setEditForm({
      incomeId: income.id,
      type: income.type,
      entryDate: formatDateForInput(income.entryDate) || getTashkentToday(),
      managerUserId: income.managerUserId || managerUserId || '',
      paymentInput: formatAmountDigits(income.paymentAmount),
      deadline: formatDateForInput(income.deadline),
      courseId: income.courseId || '',
      tariffId: income.tariffId || '',
      subTariffId:
        income.effectiveSubTariffId
        || (
        income.customer?.profileCourseId === income.courseId
        && income.customer?.profileTariffId === income.tariffId
        ? (income.customer?.profileSubTariffId || '')
        : ''
      ),
      coursePriceInput: formatAmountDigits(income.coursePriceAmount || 0),
    });
  };
  const closeEditIncome = () => {
    setEditForm(null);
    setEditError(null);
  };
  const handleSaveIncomeEdit = async () => {
    if (!editForm) {
      return;
    }

    setEditError(null);
    setError(null);
    setSuccess(null);

    const paymentAmountValue = parseAmountInput(editForm.paymentInput);
    if (!editForm.entryDate) {
      setEditError('Sana majburiy.');
      return;
    }
    if (!editForm.managerUserId) {
      setEditError('Sotuv menedjeri majburiy.');
      return;
    }
    if (editForm.type === 'repayment' && paymentAmountValue <= 0) {
      setEditError("Qarzdorlik to'lovi 0 dan katta bo'lishi kerak.");
      return;
    }

    const payload: any = {
      incomeId: editForm.incomeId,
      entryDate: editForm.entryDate,
      managerUserId: editForm.managerUserId,
      paymentAmount: paymentAmountValue,
      deadline: editForm.deadline || null,
    };

    if (editForm.type === 'new_sale') {
      const coursePriceAmountValue = parseAmountInput(editForm.coursePriceInput);
      if (!editForm.courseId) {
        setEditError('Kurs tanlang.');
        return;
      }
      if (!editForm.tariffId) {
        setEditError('Tarif tanlang.');
        return;
      }
      if (editSubTariffOptions.length > 0 && !resolvedEditSubTariffId) {
        setEditError('Subtarif tanlang.');
        return;
      }
      payload.courseId = editForm.courseId;
      payload.tariffId = editForm.tariffId;
      if (editSubTariffOptions.length > 0 && editForm.subTariffId && !resolvedEditSubTariffId) {
        setEditError('Subtarif topilmadi: tarifga mos ID aniqlanmadi.');
        return;
      }
      payload.subTariffId = editSubTariffOptions.length > 0 ? resolvedEditSubTariffId : null;
      payload.coursePriceAmount = coursePriceAmountValue;
    }

    try {
      await updateIncomeMutation.mutateAsync(payload);
      setSuccess("Tushum yozuvi tahrirlandi.");
      closeEditIncome();
      await Promise.all([
        utils.customerIncome.formOptions.invalidate(),
        utils.customerIncome.listIncomes.invalidate(),
      ]);
    } catch (mutationError: any) {
      setEditError(mutationError?.message || "Tushum yozuvini tahrirlab bo'lmadi.");
    }
  };
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    const nextErrors: FieldErrors = {};

    if (!entryDate) nextErrors.entryDate = 'Sana majburiy.';
    if (!managerUserId) nextErrors.managerUserId = 'Sotuv menedjeri majburiy.';

    const customerNumberValue = normalizeDigits(customerNumber);
    if (!customerNumberValue) nextErrors.customerNumber = 'Mijoz raqami majburiy.';
    if (customerNumberValue && !/^\d+$/.test(customerNumberValue)) nextErrors.customerNumber = "Mijoz raqami faqat raqamlardan iborat bo'lishi kerak.";

    const telegramUsernameValue = sanitizeTelegramUsername(telegramUsername.trim());
    if (telegramUsernameValue && !TELEGRAM_USERNAME_PATTERN.test(telegramUsernameValue)) {
      nextErrors.telegramUsername = "Telegram username faqat @, _, harf va raqamlardan iborat bo'lishi kerak.";
    }

    if (!isExistingCustomer && !customerName.trim()) nextErrors.customerName = 'Mijoz ismi majburiy.';
    if (!type) nextErrors.type = "To'lov turi majburiy.";

    if (type === 'new_sale') {
      if (!courseId) nextErrors.courseId = 'Kurs tanlang.';
      if (!tariffId) nextErrors.tariffId = 'Tarif tanlang.';
      if (subTariffOptions.length > 0 && !subTariffId) nextErrors.subTariffId = 'Subtarif tanlang.';
      if (coursePriceAmount <= 0) nextErrors.coursePriceInput = "Kurs narxi 0 dan katta bo'lsin.";
      if (paymentAmount < 0) nextErrors.paymentInput = "To'lov manfiy bo'lishi mumkin emas.";
    }

    if (type === 'repayment') {
      if (!canUseRepayment) {
        nextErrors.type = "Yangi mijoz uchun faqat \"Yangi sotuv\" tanlanadi.";
      }
      if (!debtSourceIncomeId) nextErrors.debtSourceIncomeId = 'Joriy qarzni tanlang.';
      if (paymentAmount <= 0) nextErrors.paymentInput = "To'lov 0 dan katta bo'lishi kerak.";
      if (paymentAmount > sourceDebtAmount) nextErrors.paymentInput = "To'lov joriy qarzdan katta bo'lmasin.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setError("Majburiy maydonlarni to'ldiring.");
      return;
    }
    setFieldErrors({});

    try {
      const createResult = await createIncomeMutation.mutateAsync({
        entryDate,
        managerUserId,
        customerNumber: customerNumberValue,
        customerName: isExistingCustomer ? undefined : customerName.trim(),
        telegramUsername: isExistingCustomer ? undefined : (telegramUsernameValue || undefined),
        skipTelegramNotification: isAdmin ? skipTelegramNotification : undefined,
        type: type as IncomeType,
        debtSourceIncomeId: type === 'repayment' ? debtSourceIncomeId : undefined,
        courseId: type === 'new_sale' ? courseId : undefined,
        tariffId: type === 'new_sale' ? tariffId : undefined,
        subTariffId: type === 'new_sale' ? (subTariffId || undefined) : undefined,
        coursePriceAmount: type === 'new_sale' ? coursePriceAmount : undefined,
        paymentAmount,
        deadline: deadline || undefined,
      });

      const dispatchWarning = getTelegramDispatchWarning((createResult as any)?.telegramDispatch);
      setSuccess(
        dispatchWarning
          ? `Tushum yozuvi muvaffaqiyatli saqlandi. ${dispatchWarning}`
          : "Tushum yozuvi muvaffaqiyatli saqlandi.",
      );
      setEntryDate(getTashkentToday());
      setManagerUserId('');
      setCustomerNumber('');
      setCustomerName('');
      setTelegramUsername('');
      setType('');
      setDebtSourceIncomeId('');
      setCourseId('');
      setTariffId('');
      setSubTariffId('');
      setCoursePriceInput('');
      setPaymentInput('');
      setSkipTelegramNotification(false);
      setDeadline('');
      setFieldErrors({});
      await Promise.all([
        utils.customerIncome.formOptions.invalidate(),
        utils.customerIncome.listIncomes.invalidate(),
      ]);
    } catch (mutationError: any) {
      setError(mutationError?.message || "Tushum yozuvini saqlab bo'lmadi.");
    }
  };
  const formatIncomeType = (incomeType: string): string => {
    return incomeType === 'repayment' ? 'Qarzdorlik' : 'Yangi sotuv';
  };
  const getLifecycleStatusBadge = (status: string) => {
    if (status === 'pending_refund') {
      return {
        label: "Sariq: Qaytarish so'rovi",
        className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
      };
    }
    if (status === 'refunded') {
      return {
        label: 'Qizil: Qaytarilgan',
        className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
      };
    }
    return {
      label: 'Aktiv',
      className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    };
  };

  return { ...prev, handleDeleteIncome, handleDownloadIncomesByCustomRange, openEditIncome, closeEditIncome, handleSaveIncomeEdit, handleSubmit, formatIncomeType, getLifecycleStatusBadge };
}
