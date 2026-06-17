'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';
import LoadingBlock from '@/components/dashboard/loading-block';

type IncomeType = 'new_sale' | 'repayment';
type IncomeTypeChoice = '' | IncomeType;
type FieldErrors = Record<string, string>;

type CustomerOption = {
  id: string;
  customerNumber: string;
  name: string;
  telegramUsername?: string | null;
  responsibleManagerUserId?: string | null;
  responsibleManagerLabel?: string | null;
};

type EditIncomeForm = {
  incomeId: string;
  type: IncomeType;
  entryDate: string;
  managerUserId: string;
  paymentInput: string;
  deadline: string;
  courseId: string;
  tariffId: string;
  subTariffId: string;
  coursePriceInput: string;
};

type SubTariffOptionLike = {
  id?: string | null;
  name?: string | null;
};

const TELEGRAM_USERNAME_PATTERN = /^@?[A-Za-z0-9_]+$/;

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

function toDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function formatDigits(value: string): string {
  if (!value) {
    return '';
  }
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseAmount(value: string): number {
  const digits = toDigits(value);
  if (!digits) {
    return 0;
  }
  return Number.parseInt(digits, 10);
}

function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '0';
  }
  return formatDigits(String(Math.max(value, 0)));
}

function getDisplayedRemainingDebtForIncomeRow(income: any): number {
  if (!income || typeof income !== 'object') {
    return 0;
  }

  if (income.type === 'new_sale') {
    const agreementAmount = Number(income.debtAmount ?? income.coursePriceAmount ?? 0);
    const firstPaymentAmount = Number(income.paymentAmount ?? 0);
    return Math.max(agreementAmount - firstPaymentAmount, 0);
  }

  return Math.max(Number(income.remainingDebtAmount ?? 0), 0);
}

function formatDateForInput(value: string | Date | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
}

function normalizeTextToken(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveCanonicalSubTariffId(
  selectedValue: string,
  options: SubTariffOptionLike[],
): string {
  const normalizedSelectedValue = normalizeTextToken(selectedValue);
  if (!normalizedSelectedValue) {
    return '';
  }

  const matchById = options.find(
    (option) => normalizeTextToken(option.id) === normalizedSelectedValue,
  );
  if (matchById?.id) {
    return normalizeTextToken(matchById.id);
  }

  const matchByName = options.find(
    (option) => normalizeTextToken(option.name) === normalizedSelectedValue,
  );
  if (matchByName?.id) {
    return normalizeTextToken(matchByName.id);
  }

  return '';
}

function getSubTariffOptionValue(option: SubTariffOptionLike): string {
  const id = normalizeTextToken(option.id);
  if (id) {
    return id;
  }
  return normalizeTextToken(option.name);
}

function sanitizeCustomerNumber(value: string): string {
  return value.replace(/\s+/g, '').replace(/\D/g, '');
}

function sanitizeTelegramUsername(value: string): string {
  return value.replace(/\s+/g, '').replace(/[^A-Za-z0-9_@]/g, '');
}

function buildFieldClass(fieldErrors: FieldErrors, field: string, extra = ''): string {
  const base =
    'mt-1 w-full rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-1';
  const normal =
    'border-gray-300 bg-white text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400';
  const invalid =
    'border-red-500 bg-red-50 text-gray-900 ring-1 ring-red-300 focus:border-red-500 focus:ring-red-400 animate-pulse dark:border-red-400 dark:bg-red-950/30 dark:text-slate-100';
  return `${base} ${fieldErrors[field] ? invalid : normal} ${extra}`.trim();
}

function getTelegramDispatchWarning(dispatch: any): string | null {
  if (!dispatch || typeof dispatch !== 'object') {
    return null;
  }

  const reason = String(dispatch.reason || '');
  if (reason === 'skipped_by_admin') {
    return null;
  }

  if (dispatch.delivered) {
    return null;
  }

  if (reason === 'course_not_eligible') {
    return "Telegram guruhiga yuborilmadi: kurs kategoriyasi bo'yicha mos guruh topilmadi (kurs/kategoriya sozlamasini tekshiring).";
  }

  if (reason === 'groups_missing') {
    return "Telegram guruhiga yuborilmadi: OFLINE_GROUP_ID (yoki OFFLINE_GROUP_ID) sozlanmagan.";
  }

  if (reason === 'bot_token_missing') {
    return "Telegram guruhiga yuborilmadi: bot token topilmadi (integratsiya yoki TELEGRAM_BOT_TOKEN ni tekshiring).";
  }

  const firstError = Array.isArray(dispatch.errors) && dispatch.errors.length > 0
    ? String(dispatch.errors[0])
    : null;
  if (firstError) {
    return `Telegram guruhiga yuborilmadi: ${firstError}`;
  }

  return "Telegram guruhiga yuborilmadi. API loglarini tekshiring.";
}

export default function IncomePage() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = Boolean(
    (user?.roles || []).some((role) => String(role).trim().toLowerCase() === 'admin'),
  );
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
      { key: 'online', label: 'Online', courses: courseOptions.filter((course: any) => course.category === 'online') },
      { key: 'offline', label: 'Offline', courses: courseOptions.filter((course: any) => course.category === 'offline') },
      { key: 'intensive', label: 'Intensive', courses: courseOptions.filter((course: any) => course.category === 'intensive') },
      {
        key: 'additional_service',
        label: "Qo'shimcha xizmat",
        courses: courseOptions.filter((course: any) => course.category === 'additional_service'),
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
    const fallback = debtOptions.filter((debt: any) => debt.customerNumber === selectedCustomer.customerNumber);
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
    return debtOptionsForCustomer.find((debt: any) => debt.id === debtSourceIncomeId) || null;
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
    const course = courseOptions.find((item: any) => item.id === courseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [courseId, courseOptions]);

  const subTariffOptions = useMemo(() => {
    if (!tariffId) {
      return [];
    }
    const tariff = tariffOptions.find((item: any) => item.id === tariffId);
    return Array.isArray(tariff?.subTariffs) ? tariff.subTariffs : [];
  }, [tariffId, tariffOptions]);

  const editTariffOptions = useMemo(() => {
    if (!editForm?.courseId) {
      return [];
    }
    const course = courseOptions.find((item: any) => item.id === editForm.courseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [courseOptions, editForm?.courseId]);
  const editSubTariffOptions = useMemo(() => {
    if (!editForm?.tariffId) {
      return [];
    }
    const tariff = editTariffOptions.find((item: any) => item.id === editForm.tariffId);
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
    const agreementAmount = parseAmount(editForm.coursePriceInput);
    const firstPaymentAmount = parseAmount(editForm.paymentInput);
    return Math.max(agreementAmount - firstPaymentAmount, 0);
  }, [editForm]);

  const coursePriceAmount = parseAmount(coursePriceInput);
  const paymentAmount = parseAmount(paymentInput);
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
      const selfManager = managers.find((manager: any) => manager.id === user.userId);
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
    const debt = debtOptionsForCustomer.find((item: any) => item.id === debtSourceIncomeId);
    if (!debt) {
      return;
    }
    setCustomerNumber(sanitizeCustomerNumber(debt.customerNumber || ''));
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
    const exists = tariffOptions.some((tariff: any) => tariff.id === tariffId);
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
    const exists = subTariffOptions.some((subTariff: any) => subTariff.id === subTariffId);
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
    const exists = editTariffOptions.some((tariff: any) => tariff.id === editForm.tariffId);
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

      const rows = result.rows.map((row: any) => ([
        formatDateForInput(row.entryDate),
        row.managerLabel || '-',
        row.customerName || '',
        row.customerNumber || '',
        row.telegramUsername || '',
        [row.courseName, row.tariffName, row.subTariffName].filter(Boolean).join(' / ') || '-',
        formatIncomeType(row.type),
        formatAmount(row.agreementAmount),
        formatAmount(row.paymentAmount),
        formatAmount(row.remainingDebtAmount),
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
      paymentInput: formatAmount(income.paymentAmount),
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
      coursePriceInput: formatAmount(income.coursePriceAmount || 0),
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

    const paymentAmountValue = parseAmount(editForm.paymentInput);
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
      const coursePriceAmountValue = parseAmount(editForm.coursePriceInput);
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

    const customerNumberValue = sanitizeCustomerNumber(customerNumber);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100">Mijoz va tushum</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          Mijoz bo'yicha yangi sotuv va qarz to'lovlarini qo'shing.
        </p>
      </div>

      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h2 className="text-lg font-medium text-gray-900 dark:text-slate-100">Tushum kiritish formasi</h2>
        </div>

        <div className="p-6">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
          {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">{success}</p>}
          {isAdmin && (
            <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300">Boshlanish</label>
                  <input
                    type="date"
                    value={exportDateFrom}
                    onChange={(event) => setExportDateFrom(event.target.value)}
                    className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 dark:text-slate-300">Tugash</label>
                  <input
                    type="date"
                    value={exportDateTo}
                    onChange={(event) => setExportDateTo(event.target.value)}
                    className="mt-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleDownloadIncomesByCustomRange}
                  disabled={exportIncomesMutation.isLoading}
                  className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-60 dark:border-blue-700 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-950/40"
                >
                  {exportIncomesMutation.isLoading ? 'Yuklanmoqda...' : "Davr bo'yicha yuklab olish"}
                </button>
              </div>
              {exportError && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{exportError}</p>
              )}
              {exportSuccess && (
                <p className="mt-1 text-xs text-green-600 dark:text-green-400">{exportSuccess}</p>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Sana <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(event) => {
                    setEntryDate(event.target.value);
                    clearFieldError('entryDate');
                  }}
                  className={buildFieldClass(fieldErrors, 'entryDate')}
                />
                {fieldErrors.entryDate && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.entryDate}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Sotuv menedjeri <span className="text-red-500">*</span></label>
                <select
                  value={managerUserId}
                  onChange={(event) => {
                    setManagerUserId(event.target.value);
                    clearFieldError('managerUserId');
                  }}
                  className={buildFieldClass(fieldErrors, 'managerUserId')}
                >
                  <option value="">Menedjerni tanlang</option>
                  {managers.map((manager: any) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.label}
                    </option>
                  ))}
                </select>
                {fieldErrors.managerUserId && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.managerUserId}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz raqami <span className="text-red-500">*</span></label>
                <div className="relative" ref={customerInputWrapperRef}>
                  <input
                    value={customerNumber}
                    onFocus={() => setIsCustomerSuggestionsOpen(true)}
                    onChange={(event) => {
                      setCustomerNumber(sanitizeCustomerNumber(event.target.value));
                      setIsCustomerSuggestionsOpen(true);
                      clearFieldError('customerNumber');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setIsCustomerSuggestionsOpen(false);
                      }
                    }}
                    className={buildFieldClass(fieldErrors, 'customerNumber')}
                    placeholder="998901234567"
                    inputMode="numeric"
                    pattern="\d*"
                    autoComplete="off"
                  />
                  {isCustomerSuggestionsOpen && customerSuggestions.length > 0 && (
                    <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800">
                      {customerSuggestions.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          className="flex w-full flex-col gap-0.5 border-b border-gray-100 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-700/70"
                          onClick={() => {
                            setCustomerNumber(customer.customerNumber);
                            setIsCustomerSuggestionsOpen(false);
                            clearFieldError('customerNumber');
                          }}
                        >
                          <span className="font-medium text-gray-900 dark:text-slate-100">{customer.customerNumber}</span>
                          <span className="text-xs text-gray-600 dark:text-slate-300">
                            {customer.name}
                            {customer.telegramUsername ? ` • ${customer.telegramUsername}` : ''}
                            {customer.responsibleManagerLabel ? ` • Mas'ul: ${customer.responsibleManagerLabel}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {fieldErrors.customerNumber && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.customerNumber}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz ismi {!isExistingCustomer && <span className="text-red-500">*</span>}</label>
                <input
                  value={customerName}
                  onChange={(event) => {
                    setCustomerName(event.target.value);
                    clearFieldError('customerName');
                  }}
                  readOnly={isExistingCustomer}
                  className={buildFieldClass(fieldErrors, 'customerName', 'read-only:bg-gray-100 read-only:text-gray-600 dark:read-only:bg-slate-700 dark:read-only:text-slate-300')}
                  placeholder="Mijoz ismi"
                  autoComplete="off"
                />
                {fieldErrors.customerName && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.customerName}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Telegram username</label>
                <input
                  value={telegramUsername}
                  onChange={(event) => {
                    setTelegramUsername(sanitizeTelegramUsername(event.target.value));
                    clearFieldError('telegramUsername');
                  }}
                  readOnly={isExistingCustomer}
                  className={buildFieldClass(fieldErrors, 'telegramUsername', 'read-only:bg-gray-100 read-only:text-gray-600 dark:read-only:bg-slate-700 dark:read-only:text-slate-300')}
                  placeholder="@username"
                  maxLength={160}
                  autoComplete="off"
                />
                {fieldErrors.telegramUsername && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.telegramUsername}</p>}
              </div>
            </div>

            {selectedCustomer && (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Mas&apos;ul agent: <span className="font-medium">{selectedCustomer.responsibleManagerLabel || '-'}</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">To'lov turi <span className="text-red-500">*</span></label>
                <select
                  value={type}
                  onChange={(event) => {
                    setType(event.target.value as IncomeTypeChoice);
                    clearFieldError('type');
                  }}
                  className={buildFieldClass(fieldErrors, 'type')}
                >
                  <option value="">To'lov turini tanlang</option>
                  <option value="new_sale">Yangi sotuv</option>
                  <option value="repayment" disabled={!canUseRepayment}>
                    Qarzdorlik
                  </option>
                </select>
                {isDebtLookupPending && (
                  <LoadingBlock className="mt-1" compact message="Mijozning qarzlari yuklanmoqda..." />
                )}
                {!canUseRepayment && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                    Qarzdorlik to&apos;lovi faqat mavjud qarzdor mijoz uchun ochiladi.
                  </p>
                )}
                {fieldErrors.type && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.type}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Deadline</label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                  className={buildFieldClass(fieldErrors, 'deadline')}
                />
              </div>
            </div>

            {type === 'repayment' ? (
              <div className="space-y-4 rounded-md border border-blue-100 bg-blue-50/40 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Current debt <span className="text-red-500">*</span></label>
                  <select
                    value={debtSourceIncomeId}
                    onChange={(event) => {
                      setDebtSourceIncomeId(event.target.value);
                      clearFieldError('debtSourceIncomeId');
                    }}
                    className={buildFieldClass(fieldErrors, 'debtSourceIncomeId')}
                  >
                    <option value="">Qarzni tanlang</option>
                    {debtOptionsForCustomer.map((debt: any) => (
                      <option key={debt.id} value={debt.id}>
                        {debt.customerNumber} - {debt.customerName} | {debt.courseName || "Kurs yo'q"} / {debt.tariffName || "Tarif yo'q"} | Qarz: {formatAmount(debt.remainingDebtAmount)}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.debtSourceIncomeId && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.debtSourceIncomeId}</p>}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Qarz summasi</label>
                    <input
                      value={formatAmount(sourceDebtAmount)}
                      readOnly
                      className={buildFieldClass(fieldErrors, 'sourceDebtAmount', 'read-only:bg-gray-100 read-only:text-gray-700 dark:read-only:bg-slate-700 dark:read-only:text-slate-300')}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">To&apos;lov <span className="text-red-500">*</span></label>
                    <input
                      value={paymentInput}
                      onChange={(event) => {
                        setPaymentInput(formatDigits(toDigits(event.target.value)));
                        clearFieldError('paymentInput');
                      }}
                      inputMode="numeric"
                      className={buildFieldClass(fieldErrors, 'paymentInput')}
                      placeholder="0"
                    />
                    {fieldErrors.paymentInput && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.paymentInput}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Qarzdorlik</label>
                    <input
                      value={formatAmount(remainingDebtAmount)}
                      readOnly
                      className={buildFieldClass(fieldErrors, 'remainingDebtAmount', 'read-only:bg-gray-100 read-only:text-gray-700 dark:read-only:bg-slate-700 dark:read-only:text-slate-300')}
                    />
                  </div>
                </div>
              </div>
            ) : type === 'new_sale' ? (
              <div className="space-y-4 rounded-md border border-green-100 bg-green-50/30 p-4 dark:border-green-900/60 dark:bg-green-950/20">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Kurs <span className="text-red-500">*</span></label>
                    <select
                      value={courseId}
                      onChange={(event) => {
                        setCourseId(event.target.value);
                        clearFieldError('courseId');
                      }}
                      className={buildFieldClass(fieldErrors, 'courseId')}
                    >
                      <option value="">Kursni tanlang</option>
                      {groupedCourseOptions.map((group) =>
                        group.courses.length ? (
                          <optgroup key={group.key} label={group.label}>
                            {group.courses.map((course: any) => (
                              <option key={course.id} value={course.id}>
                                {course.name}
                              </option>
                            ))}
                          </optgroup>
                        ) : null,
                      )}
                    </select>
                    {fieldErrors.courseId && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.courseId}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Tarif <span className="text-red-500">*</span></label>
                    <select
                      value={tariffId}
                      onChange={(event) => {
                        setTariffId(event.target.value);
                        clearFieldError('tariffId');
                      }}
                      disabled={!courseId}
                      className={buildFieldClass(fieldErrors, 'tariffId', 'disabled:bg-gray-100 disabled:text-gray-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400')}
                    >
                      <option value="">Tarifni tanlang</option>
                      {tariffOptions.map((tariff: any) => (
                        <option key={tariff.id} value={tariff.id}>
                          {tariff.name}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.tariffId && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.tariffId}</p>}
                  </div>
                </div>

                {subTariffOptions.length > 0 && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Subtarif <span className="text-red-500">*</span></label>
                      <select
                        value={subTariffId}
                        onChange={(event) => {
                          setSubTariffId(event.target.value);
                          clearFieldError('subTariffId');
                        }}
                        disabled={!tariffId}
                        className={buildFieldClass(fieldErrors, 'subTariffId', 'disabled:bg-gray-100 disabled:text-gray-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400')}
                      >
                        <option value="">Subtarifni tanlang</option>
                        {subTariffOptions.map((subTariff: any) => (
                          <option key={subTariff.id} value={subTariff.id}>
                            {subTariff.name}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.subTariffId && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.subTariffId}</p>}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Kurs narxi <span className="text-red-500">*</span></label>
                    <input
                      value={coursePriceInput}
                      onChange={(event) => {
                        setCoursePriceInput(formatDigits(toDigits(event.target.value)));
                        clearFieldError('coursePriceInput');
                      }}
                      inputMode="numeric"
                      className={buildFieldClass(fieldErrors, 'coursePriceInput')}
                      placeholder="0"
                    />
                    {fieldErrors.coursePriceInput && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.coursePriceInput}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">To&apos;lov</label>
                    <input
                      value={paymentInput}
                      onChange={(event) => {
                        setPaymentInput(formatDigits(toDigits(event.target.value)));
                        clearFieldError('paymentInput');
                      }}
                      inputMode="numeric"
                      className={buildFieldClass(fieldErrors, 'paymentInput')}
                      placeholder="0"
                    />
                    {fieldErrors.paymentInput && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.paymentInput}</p>}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Qarzdorlik</label>
                    <input
                      value={formatAmount(remainingDebtAmount)}
                      readOnly
                      className={buildFieldClass(fieldErrors, 'remainingDebtAmount', 'read-only:bg-gray-100 read-only:text-gray-700 dark:read-only:bg-slate-700 dark:read-only:text-slate-300')}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                To'lov turi tanlangandan keyin Kurs yoki Qarzdorlik maydonlari chiqadi.
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="submit"
                disabled={createIncomeMutation.isLoading || formOptionsQuery.isLoading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createIncomeMutation.isLoading ? 'Saqlanmoqda...' : 'Tushumni saqlash'}
              </button>
              {isAdmin && (
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={skipTelegramNotification}
                    onChange={(event) => setSkipTelegramNotification(event.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800"
                  />
                  Income qo&apos;shilganda Telegramga yubormaslik
                </label>
              )}
            </div>
          </form>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h2 className="text-lg font-medium text-gray-900 dark:text-slate-100">So'nggi tushumlar</h2>
        </div>

        <div className="p-6">
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={recentSearchQuery}
              onChange={(event) => {
                setRecentSearchQuery(event.target.value);
                setRecentLimit(10);
              }}
              placeholder="Mijoz raqami yoki ismi bo'yicha qidirish"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={() => {
                setRecentSearchQuery('');
                setRecentLimit(10);
              }}
              disabled={!recentSearchQuery}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Tozalash
            </button>
          </div>

          {incomesQuery.isLoading ? (
            <LoadingBlock message="Tushumlar yuklanmoqda..." />
          ) : incomesQuery.data?.length ? (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                  <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Sana</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Turi</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Mijoz</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Menedjer</th>
                    <th className="w-16 min-w-[64px] px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Kiritgan</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Kurs/Tarif</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Holat</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">To'lov</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Qoldiq qarz</th>
                    {isAdmin && (
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Amal</th>
                    )}
                  </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                    {incomesQuery.data.map((income: any) => (
                      <tr key={income.id}>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          {new Date(income.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          {formatIncomeType(income.type)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          {income.customer?.customerNumber} - {income.customer?.name}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          {income.manager?.name || income.manager?.username || '-'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-[10px] leading-tight text-gray-500 dark:text-slate-400">
                          {income.createdByLabel || '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          {[income.course?.name, income.tariff?.name].filter(Boolean).join(' / ') || '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getLifecycleStatusBadge(income.lifecycleStatus).className}`}>
                            {getLifecycleStatusBadge(income.lifecycleStatus).label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{formatAmount(income.paymentAmount)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          {formatAmount(getDisplayedRemainingDebtForIncomeRow(income))}
                        </td>
                        {isAdmin && (
                          <td className="whitespace-nowrap px-4 py-3 text-sm">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openEditIncome(income)}
                                className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40"
                              >
                                Tahrirlash
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteIncome(income.id)}
                                disabled={deletingIncomeId === income.id}
                                className="rounded-md border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/40"
                              >
                                {deletingIncomeId === income.id ? "O'chirilmoqda..." : "O'chirish"}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {incomesQuery.data.length >= recentLimit && recentLimit < 200 && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => setRecentLimit((prev) => Math.min(prev + 20, 200))}
                    className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    Yana yuklash (+20)
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-slate-300">Hozircha tushum yozuvlari yo'q.</p>
          )}
        </div>
      </div>

      {isAdmin && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Tushumni tahrirlash</h3>
              <button
                type="button"
                onClick={closeEditIncome}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Yopish
              </button>
            </div>

            <div className="space-y-4 p-5">
              {editError && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                  {editError}
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Sana</label>
                  <input
                    type="date"
                    value={editForm.entryDate}
                    onChange={(event) => setEditForm((prev) => (prev ? { ...prev, entryDate: event.target.value } : prev))}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Sotuv menedjeri</label>
                  <select
                    value={editForm.managerUserId}
                    onChange={(event) => setEditForm((prev) => (prev ? { ...prev, managerUserId: event.target.value } : prev))}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="">Menedjerni tanlang</option>
                    {managers.map((manager: any) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {editForm.type === 'new_sale' && (
                <div className="space-y-4 rounded-md border border-blue-100 bg-blue-50/30 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Kurs</label>
                      <select
                        value={editForm.courseId}
                        onChange={(event) =>
                          setEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  courseId: event.target.value,
                                }
                              : prev,
                          )
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="">Kursni tanlang</option>
                        {groupedCourseOptions.map((group) =>
                          group.courses.length ? (
                            <optgroup key={group.key} label={group.label}>
                              {group.courses.map((course: any) => (
                                <option key={course.id} value={course.id}>
                                  {course.name}
                                </option>
                              ))}
                            </optgroup>
                          ) : null,
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Tarif</label>
                      <select
                        value={editForm.tariffId}
                        onChange={(event) =>
                          setEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  tariffId: event.target.value,
                                }
                              : prev,
                          )
                        }
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="">Tarifni tanlang</option>
                        {editTariffOptions.map((tariff: any) => (
                          <option key={tariff.id} value={tariff.id}>
                            {tariff.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {editSubTariffOptions.length > 0 && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Subtarif</label>
                        <select
                          value={editForm.subTariffId}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    subTariffId: resolveCanonicalSubTariffId(event.target.value, editSubTariffOptions),
                                  }
                                : prev,
                            )
                          }
                          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                        >
                          <option value="">Subtarifni tanlang</option>
                          {editSubTariffOptions.map((subTariff: any) => (
                            <option
                              key={`${normalizeTextToken(subTariff.id) || normalizeTextToken(subTariff.name)}`}
                              value={getSubTariffOptionValue(subTariff)}
                            >
                              {subTariff.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Kurs narxi</label>
                      <input
                        value={editForm.coursePriceInput}
                        onChange={(event) =>
                          setEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  coursePriceInput: formatDigits(toDigits(event.target.value)),
                                }
                              : prev,
                          )
                        }
                        inputMode="numeric"
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Deadline</label>
                      <input
                        type="date"
                        value={editForm.deadline}
                        onChange={(event) => setEditForm((prev) => (prev ? { ...prev, deadline: event.target.value } : prev))}
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  </div>
                </div>
              )}

              {editForm.type === 'repayment' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Deadline</label>
                  <input
                    type="date"
                    value={editForm.deadline}
                    onChange={(event) => setEditForm((prev) => (prev ? { ...prev, deadline: event.target.value } : prev))}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">To'lov</label>
                <input
                  value={editForm.paymentInput}
                  onChange={(event) =>
                    setEditForm((prev) =>
                      prev
                        ? {
                            ...prev,
                            paymentInput: formatDigits(toDigits(event.target.value)),
                          }
                        : prev,
                    )
                  }
                  inputMode="numeric"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              {editForm.type === 'new_sale' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">
                    Birinchi to'lovdan keyingi qarz
                  </label>
                  <input
                    value={formatAmount(editDebtAfterFirstPayment)}
                    readOnly
                    className="mt-1 w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-700 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-slate-700">
              <button
                type="button"
                onClick={closeEditIncome}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleSaveIncomeEdit}
                disabled={updateIncomeMutation.isLoading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {updateIncomeMutation.isLoading ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
