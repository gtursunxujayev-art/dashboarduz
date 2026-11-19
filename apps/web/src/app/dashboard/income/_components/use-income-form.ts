'use client';

import { useAuth } from '@/contexts/auth-context';
import { isAdminLike } from '@dashboarduz/shared';
import { getTashkentToday } from '@/lib/date-range';
import { parseAmountInput } from '@/lib/format';
import { trpc } from '@/lib/trpc';
import { normalizeDigits, sanitizeTelegramUsername } from '@dashboarduz/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type CustomerOption, type EditIncomeForm, type FieldErrors, type IncomeTypeChoice, resolveCanonicalSubTariffId } from './income-helpers';

export function useIncomeForm() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  // OnlineAdmin edits income too; the server limits it to online sellers.
  const isAdmin = isAdminLike(user?.roles);
  const isTeamLeader = Boolean(
    (user?.roles || []).some((role) => String(role).trim().toLowerCase() === 'teamleader'),
  );
  const [entryDate, setEntryDate] = useState(getTashkentToday());
  const [managerUserId, setManagerUserId] = useState('');
  const [customerNumber, setCustomerNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [telegramUsername, setTelegramUsername] = useState('');
  const [type, setType] = useState<IncomeTypeChoice>('');
  const [debtSourceIncomeId, setDebtSourceIncomeId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [subTariffId, setSubTariffId] = useState('');
  const [coursePriceInput, setCoursePriceInput] = useState('');
  const [paymentInput, setPaymentInput] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [recentLimit, setRecentLimit] = useState(10);
  const [recentSearchQuery, setRecentSearchQuery] = useState('');
  const [skipTelegramNotification, setSkipTelegramNotification] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState(getTashkentToday());
  const [exportDateTo, setExportDateTo] = useState(getTashkentToday());
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const customerInputWrapperRef = useRef<HTMLDivElement | null>(null);
  const [isCustomerSuggestionsOpen, setIsCustomerSuggestionsOpen] = useState(false);
  const formOptionsQuery = trpc.customerIncome.formOptions.useQuery(undefined, {
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const incomesQuery = trpc.customerIncome.listIncomes.useQuery(
    {
      limit: recentLimit,
      query: recentSearchQuery.trim() || undefined,
    },
    {
      retry: false,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );
  const searchCustomersQuery = trpc.customerIncome.searchCustomers.useQuery(
    { query: customerNumber.trim(), limit: 30 },
    {
      enabled: customerNumber.trim().length >= 2,
      retry: false,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    },
  );
  const createIncomeMutation = trpc.customerIncome.createIncome.useMutation();
  const updateIncomeMutation = trpc.customerIncome.updateIncome.useMutation();
  const deleteIncomeMutation = trpc.customerIncome.deleteIncome.useMutation();
  const exportIncomesMutation = trpc.customerIncome.exportIncomesByDateRange.useMutation();
  const [deletingIncomeId, setDeletingIncomeId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditIncomeForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const managers = useMemo(() => formOptionsQuery.data?.managers || [], [formOptionsQuery.data]);
  const courseOptions = useMemo(() => formOptionsQuery.data?.courses || [], [formOptionsQuery.data]);
  const groupedCourseOptions = useMemo(
    () => [
      { key: 'online', label: 'Online', courses: courseOptions.filter((course) => course.category === 'online') },
      { key: 'offline', label: 'Offline', courses: courseOptions.filter((course) => course.category === 'offline') },
      { key: 'intensive', label: 'Intensive', courses: courseOptions.filter((course) => course.category === 'intensive') },
      {
        key: 'additional_service',
        label: "Qo'shimcha xizmat",
        courses: courseOptions.filter((course) => course.category === 'additional_service'),
      },
    ],
    [courseOptions],
  );
  const debtOptions = useMemo(() => formOptionsQuery.data?.outstandingDebts || [], [formOptionsQuery.data]);
  const customers = useMemo<CustomerOption[]>(() => {
    const byId = new Map<string, CustomerOption>();
    const base = Array.isArray(formOptionsQuery.data?.customers) ? formOptionsQuery.data.customers : [];
    const searched = Array.isArray(searchCustomersQuery.data) ? searchCustomersQuery.data : [];

    for (const customer of [...base, ...searched]) {
      byId.set(customer.id, {
        id: customer.id,
        customerNumber: customer.customerNumber,
        name: customer.name,
        telegramUsername: customer.telegramUsername,
        responsibleManagerUserId: customer.responsibleManagerUserId || null,
        responsibleManagerLabel: customer.responsibleManagerLabel || null,
      });
    }

    return Array.from(byId.values());
  }, [formOptionsQuery.data, searchCustomersQuery.data]);
  const customerByNumber = useMemo(() => {
    const map = new Map<string, CustomerOption>();
    for (const customer of customers) {
      map.set(customer.customerNumber.trim().toLowerCase(), customer);
    }
    return map;
  }, [customers]);
  const selectedCustomer = useMemo(() => {
    return customerByNumber.get(customerNumber.trim().toLowerCase()) ?? null;
  }, [customerByNumber, customerNumber]);
  const customerOutstandingDebtsQuery = trpc.customerIncome.customerOutstandingDebts.useQuery(
    {
      customerNumber: selectedCustomer?.customerNumber || '',
    },
    {
      enabled: Boolean(selectedCustomer?.customerNumber),
      retry: false,
      keepPreviousData: true,
      staleTime: 15 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );
  const customerSuggestions = useMemo(() => {
    const query = customerNumber.trim().toLowerCase();
    const sorted = [...customers].sort((a, b) => a.customerNumber.localeCompare(b.customerNumber));
    if (!query) {
      return sorted.slice(0, 30);
    }

    return sorted
      .filter((customer) => {
        const customerNum = customer.customerNumber.toLowerCase();
        const customerName = customer.name.toLowerCase();
        const customerTg = (customer.telegramUsername || '').toLowerCase();
        return customerNum.includes(query) || customerName.includes(query) || customerTg.includes(query);
      })
      .slice(0, 30);
  }, [customers, customerNumber]);
  const isExistingCustomer = Boolean(selectedCustomer);
  const debtOptionsForCustomer = useMemo(() => {
    if (!selectedCustomer) {
      return [];
    }
    const fromLookup = Array.isArray(customerOutstandingDebtsQuery.data)
      ? customerOutstandingDebtsQuery.data
      : [];
    const fallback = debtOptions.filter((debt) => debt.customerNumber === selectedCustomer.customerNumber);
    const byId = new Map<string, any>();
    for (const debt of [...fromLookup, ...fallback]) {
      byId.set(debt.id, debt);
    }
    return Array.from(byId.values());
  }, [customerOutstandingDebtsQuery.data, debtOptions, selectedCustomer]);
  const isDebtLookupPending = Boolean(selectedCustomer) && customerOutstandingDebtsQuery.isLoading;
  const canUseRepayment = isExistingCustomer && debtOptionsForCustomer.length > 0;
  const selectedDebt = useMemo(() => {
    if (!debtSourceIncomeId) {
      return null;
    }
    return debtOptionsForCustomer.find((debt) => debt.id === debtSourceIncomeId) || null;
  }, [debtOptionsForCustomer, debtSourceIncomeId]);
  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };
  const tariffOptions = useMemo(() => {
    if (!courseId) {
      return [];
    }
    const course = courseOptions.find((item) => item.id === courseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [courseId, courseOptions]);
  const subTariffOptions = useMemo(() => {
    if (!tariffId) {
      return [];
    }
    const tariff = tariffOptions.find((item) => item.id === tariffId);
    return Array.isArray(tariff?.subTariffs) ? tariff.subTariffs : [];
  }, [tariffId, tariffOptions]);
  const editTariffOptions = useMemo(() => {
    if (!editForm?.courseId) {
      return [];
    }
    const course = courseOptions.find((item) => item.id === editForm.courseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [courseOptions, editForm?.courseId]);
  const editSubTariffOptions = useMemo(() => {
    if (!editForm?.tariffId) {
      return [];
    }
    const tariff = editTariffOptions.find((item) => item.id === editForm.tariffId);
    return Array.isArray(tariff?.subTariffs) ? tariff.subTariffs : [];
  }, [editForm?.tariffId, editTariffOptions]);
  const resolvedEditSubTariffId = useMemo(
    () => resolveCanonicalSubTariffId(editForm?.subTariffId || '', editSubTariffOptions),
    [editForm?.subTariffId, editSubTariffOptions],
  );
  const editDebtAfterFirstPayment = useMemo(() => {
    if (!editForm || editForm.type !== 'new_sale') {
      return 0;
    }
    const agreementAmount = parseAmountInput(editForm.coursePriceInput);
    const firstPaymentAmount = parseAmountInput(editForm.paymentInput);
    return Math.max(agreementAmount - firstPaymentAmount, 0);
  }, [editForm]);
  const coursePriceAmount = parseAmountInput(coursePriceInput);
  const paymentAmount = parseAmountInput(paymentInput);
  const sourceDebtAmount = selectedDebt?.remainingDebtAmount || 0;
  const remainingDebtAmount = type === 'new_sale'
    ? Math.max(coursePriceAmount - paymentAmount, 0)
    : type === 'repayment'
      ? Math.max(sourceDebtAmount - paymentAmount, 0)
      : 0;
  useEffect(() => {
    if (managerUserId || managers.length === 0) {
      return;
    }

    if (isTeamLeader && user?.userId) {
      const selfManager = managers.find((manager) => manager.id === user.userId);
      if (selfManager?.id) {
        setManagerUserId(selfManager.id);
        return;
      }
    }

    setManagerUserId(managers[0].id);
  }, [isTeamLeader, managerUserId, managers, user?.userId]);
  useEffect(() => {
    if (!selectedCustomer) {
      return;
    }
    setCustomerName(selectedCustomer.name || '');
    setTelegramUsername(sanitizeTelegramUsername(selectedCustomer.telegramUsername || ''));
  }, [selectedCustomer]);
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (!customerInputWrapperRef.current) {
        return;
      }
      const targetNode = event.target as Node | null;
      if (targetNode && !customerInputWrapperRef.current.contains(targetNode)) {
        setIsCustomerSuggestionsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, []);
  useEffect(() => {
    if (type === 'new_sale') {
      setDebtSourceIncomeId('');
      return;
    }
    if (type === 'repayment') {
      setCourseId('');
      setTariffId('');
      setSubTariffId('');
      setCoursePriceInput('');
      return;
    }
    setDebtSourceIncomeId('');
    setCourseId('');
    setTariffId('');
    setSubTariffId('');
    setCoursePriceInput('');
  }, [type]);
  useEffect(() => {
    if (!debtSourceIncomeId) {
      return;
    }
    const debt = debtOptionsForCustomer.find((item) => item.id === debtSourceIncomeId);
    if (!debt) {
      return;
    }
    setCustomerNumber(normalizeDigits(debt.customerNumber || ''));
    setCustomerName(debt.customerName || '');
  }, [debtOptionsForCustomer, debtSourceIncomeId]);
  useEffect(() => {
    if (type !== 'repayment') {
      return;
    }
    if (isDebtLookupPending) {
      return;
    }
    if (canUseRepayment) {
      return;
    }
    setType('new_sale');
    setDebtSourceIncomeId('');
    clearFieldError('debtSourceIncomeId');
    clearFieldError('type');
    setError("Yangi yoki topilmagan mijoz uchun faqat \"Yangi sotuv\" tanlanadi.");
  }, [canUseRepayment, isDebtLookupPending, type]);
  useEffect(() => {
    if (!courseId) {
      setTariffId('');
      setSubTariffId('');
      return;
    }
    const exists = tariffOptions.some((tariff) => tariff.id === tariffId);
    if (!exists) {
      setTariffId('');
      setSubTariffId('');
    }
  }, [courseId, tariffId, tariffOptions]);
  useEffect(() => {
    if (!tariffId) {
      setSubTariffId('');
      return;
    }
    const exists = subTariffOptions.some((subTariff) => subTariff.id === subTariffId);
    if (!exists) {
      setSubTariffId('');
    }
  }, [tariffId, subTariffId, subTariffOptions]);
  useEffect(() => {
    if (!editForm || editForm.type !== 'new_sale') {
      return;
    }
    if (!editForm.courseId) {
      return;
    }
    if (!editForm.tariffId) {
      return;
    }
    const exists = editTariffOptions.some((tariff) => tariff.id === editForm.tariffId);
    if (!exists) {
      setEditForm((prev) => (prev ? { ...prev, tariffId: '' } : prev));
    }
  }, [editForm, editTariffOptions]);
  useEffect(() => {
    if (!editForm || editForm.type !== 'new_sale') {
      return;
    }
    if (!editForm.tariffId) {
      if (editForm.subTariffId) {
        setEditForm((prev) => (prev ? { ...prev, subTariffId: '' } : prev));
      }
      return;
    }
    if (!editSubTariffOptions.length) {
      if (editForm.subTariffId) {
        setEditForm((prev) => (prev ? { ...prev, subTariffId: '' } : prev));
      }
      return;
    }
    if (!editForm.subTariffId) {
      return;
    }
    const canonicalSubTariffId = resolveCanonicalSubTariffId(editForm.subTariffId, editSubTariffOptions);
    if (!canonicalSubTariffId) {
      setEditForm((prev) => (prev ? { ...prev, subTariffId: '' } : prev));
      return;
    }
    if (canonicalSubTariffId !== editForm.subTariffId) {
      setEditForm((prev) => (prev ? { ...prev, subTariffId: canonicalSubTariffId } : prev));
    }
  }, [editForm, editSubTariffOptions]);

  return { utils, user, isAdmin, isTeamLeader, entryDate, setEntryDate, managerUserId, setManagerUserId, customerNumber, setCustomerNumber, customerName, setCustomerName, telegramUsername, setTelegramUsername, type, setType, debtSourceIncomeId, setDebtSourceIncomeId, courseId, setCourseId, tariffId, setTariffId, subTariffId, setSubTariffId, coursePriceInput, setCoursePriceInput, paymentInput, setPaymentInput, deadline, setDeadline, error, setError, success, setSuccess, fieldErrors, setFieldErrors, recentLimit, setRecentLimit, recentSearchQuery, setRecentSearchQuery, skipTelegramNotification, setSkipTelegramNotification, exportDateFrom, setExportDateFrom, exportDateTo, setExportDateTo, exportError, setExportError, exportSuccess, setExportSuccess, customerInputWrapperRef, isCustomerSuggestionsOpen, setIsCustomerSuggestionsOpen, formOptionsQuery, incomesQuery, searchCustomersQuery, createIncomeMutation, updateIncomeMutation, deleteIncomeMutation, exportIncomesMutation, deletingIncomeId, setDeletingIncomeId, editForm, setEditForm, editError, setEditError, managers, courseOptions, groupedCourseOptions, debtOptions, customers, customerByNumber, selectedCustomer, customerOutstandingDebtsQuery, customerSuggestions, isExistingCustomer, debtOptionsForCustomer, isDebtLookupPending, canUseRepayment, selectedDebt, clearFieldError, tariffOptions, subTariffOptions, editTariffOptions, editSubTariffOptions, resolvedEditSubTariffId, editDebtAfterFirstPayment, coursePriceAmount, paymentAmount, sourceDebtAmount, remainingDebtAmount };
}
