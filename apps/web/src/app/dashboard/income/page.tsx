'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import * as XLSX from 'xlsx';
import { useAuth } from '@/contexts/auth-context';

type IncomeType = 'new_sale' | 'repayment';
type IncomeTypeChoice = '' | IncomeType;
type FieldErrors = Record<string, string>;

type CustomerOption = {
  id: string;
  customerNumber: string;
  name: string;
  telegramUsername?: string | null;
};

type BulkImportResult = {
  totalRows: number;
  importedCount: number;
  failedCount: number;
  failures: Array<{ rowNumber: number; message: string }>;
};

const BULK_TEMPLATE_HEADERS = [
  'entry_date',
  'sales_manager',
  'customer_number',
  'customer_name',
  'telegram_username',
  'income_type',
  'course',
  'tariff',
  'course_price',
  'payment',
  'deadline',
  'debt_source_income_id',
];
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

function sanitizeCustomerNumber(value: string): string {
  return value.replace(/\s+/g, '').replace(/\D/g, '');
}

function sanitizeTelegramUsername(value: string): string {
  return value.replace(/\s+/g, '').replace(/[^A-Za-z0-9_@]/g, '');
}

function parseBulkImportError(error: unknown): string {
  if (error && typeof error === 'object') {
    const trpcErrorMessage = (error as { data?: { zodError?: { fieldErrors?: { rows?: string[] } } } }).data?.zodError
      ?.fieldErrors?.rows?.[0];
    if (trpcErrorMessage) {
      return trpcErrorMessage;
    }
    const message = (error as { message?: string }).message;
    if (message) {
      return message;
    }
  }
  return 'Bulk import muvaffaqiyatsiz.';
}

function summarizeBulkResult(result: BulkImportResult): string {
  if (result.failedCount === 0) {
    return `${result.importedCount}/${result.totalRows} qator muvaffaqiyatli import qilindi.`;
  }

  const preview = result.failures.slice(0, 5).map((item) => `Row ${item.rowNumber}: ${item.message}`).join(' | ');
  return `${result.importedCount}/${result.totalRows} qator import qilindi. Xato: ${result.failedCount}. ${preview}`;
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

  if (dispatch.delivered) {
    return null;
  }

  const reason = String(dispatch.reason || '');
  if (reason === 'course_not_eligible') {
    return null;
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
  const { user } = useAuth();
  const isAdmin = Boolean(user?.roles?.includes('Admin'));
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
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [bulkFallbackManagerUserId, setBulkFallbackManagerUserId] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [recentLimit, setRecentLimit] = useState(10);

  const formOptionsQuery = trpc.customerIncome.formOptions.useQuery(undefined, {
    retry: false,
  });
  const incomesQuery = trpc.customerIncome.listIncomes.useQuery({ limit: recentLimit }, { retry: false });
  const searchCustomersQuery = trpc.customerIncome.searchCustomers.useQuery(
    { query: customerNumber.trim(), limit: 30 },
    {
      enabled: customerNumber.trim().length > 0,
      retry: false,
    },
  );
  const createIncomeMutation = trpc.customerIncome.createIncome.useMutation();
  const deleteIncomeMutation = trpc.customerIncome.deleteIncome.useMutation();
  const bulkImportRowsMutation = trpc.customerIncome.bulkImportRows.useMutation();
  const bulkImportFromSheetMutation = trpc.customerIncome.bulkImportFromGoogleSheet.useMutation();
  const [deletingIncomeId, setDeletingIncomeId] = useState<string | null>(null);

  const managers = useMemo(() => formOptionsQuery.data?.managers || [], [formOptionsQuery.data]);
  const courseOptions = useMemo(() => formOptionsQuery.data?.courses || [], [formOptionsQuery.data]);
  const groupedCourseOptions = useMemo(
    () => [
      { key: 'online', label: 'Online', courses: courseOptions.filter((course: any) => course.category === 'online') },
      { key: 'offline', label: 'Offline', courses: courseOptions.filter((course: any) => course.category === 'offline') },
      { key: 'intensive', label: 'Intensive', courses: courseOptions.filter((course: any) => course.category === 'intensive') },
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

  const isExistingCustomer = Boolean(selectedCustomer);

  const debtOptionsForCustomer = useMemo(() => {
    if (!selectedCustomer) {
      return debtOptions;
    }
    return debtOptions.filter((debt: any) => debt.customerNumber === selectedCustomer.customerNumber);
  }, [debtOptions, selectedCustomer]);

  const selectedDebt = useMemo(() => {
    if (!debtSourceIncomeId) {
      return null;
    }
    return debtOptions.find((debt: any) => debt.id === debtSourceIncomeId) || null;
  }, [debtOptions, debtSourceIncomeId]);

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

  const coursePriceAmount = parseAmount(coursePriceInput);
  const paymentAmount = parseAmount(paymentInput);
  const sourceDebtAmount = selectedDebt?.remainingDebtAmount || 0;
  const remainingDebtAmount = type === 'new_sale'
    ? Math.max(coursePriceAmount - paymentAmount, 0)
    : type === 'repayment'
      ? Math.max(sourceDebtAmount - paymentAmount, 0)
      : 0;

  useEffect(() => {
    if (!managerUserId && managers.length > 0) {
      setManagerUserId(managers[0].id);
    }
  }, [managerUserId, managers]);

  useEffect(() => {
    if (!bulkFallbackManagerUserId && managers.length > 0) {
      setBulkFallbackManagerUserId(managers[0].id);
    }
  }, [bulkFallbackManagerUserId, managers]);

  useEffect(() => {
    if (!selectedCustomer) {
      return;
    }
    setCustomerName(selectedCustomer.name || '');
    setTelegramUsername(sanitizeTelegramUsername(selectedCustomer.telegramUsername || ''));
  }, [selectedCustomer]);

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
    const debt = debtOptions.find((item: any) => item.id === debtSourceIncomeId);
    if (!debt) {
      return;
    }
    setCustomerNumber(sanitizeCustomerNumber(debt.customerNumber || ''));
    setCustomerName(debt.customerName || '');
  }, [debtOptions, debtSourceIncomeId]);

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

  const handleDownloadTemplate = () => {
    const sampleRows: Array<Record<string, string>> = [
      {
        entry_date: getTashkentToday(),
        sales_manager: managers[0]?.label || 'Admin',
        customer_number: '998901234567',
        customer_name: 'Ali Valiyev',
        telegram_username: '@ali_valiyev',
        income_type: 'new_sale',
        course: courseOptions[0]?.name || 'English',
        tariff: courseOptions[0]?.tariffs?.[0]?.name || 'Standard',
        course_price: '1500000',
        payment: '500000',
        deadline: getTashkentToday(),
        debt_source_income_id: '',
      },
      {
        entry_date: getTashkentToday(),
        sales_manager: managers[0]?.label || 'Admin',
        customer_number: '998901234567',
        customer_name: '',
        telegram_username: '',
        income_type: 'repayment',
        course: '',
        tariff: '',
        course_price: '',
        payment: '300000',
        deadline: '',
        debt_source_income_id: '',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleRows, { header: BULK_TEMPLATE_HEADERS });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'IncomeImport');
    XLSX.writeFile(workbook, 'income-import-template.xlsx');
  };

  const runBulkImport = async (rows: Array<Record<string, string | number | boolean | null>>) => {
    if (!rows.length) {
      setBulkError("Faylda import uchun qatorlar topilmadi.");
      return;
    }

    setBulkError(null);
    setBulkSuccess(null);

    try {
      const result = await bulkImportRowsMutation.mutateAsync({
        rows,
        fallbackManagerUserId: bulkFallbackManagerUserId || undefined,
      }) as BulkImportResult;
      setBulkSuccess(summarizeBulkResult(result));
      await Promise.all([formOptionsQuery.refetch(), incomesQuery.refetch()]);
    } catch (bulkImportError) {
      setBulkError(parseBulkImportError(bulkImportError));
    }
  };

  const handleFileImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setBulkError(null);
    setBulkSuccess(null);

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        setBulkError("Tanlangan faylda worksheet yo'q.");
        return;
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, string | number | boolean | null>>(worksheet, {
        defval: '',
        raw: false,
      });

      await runBulkImport(rows);
    } catch (fileImportError) {
      setBulkError(parseBulkImportError(fileImportError));
    }
  };

  const handleGoogleSheetImport = async () => {
    const trimmedUrl = googleSheetUrl.trim();
    if (!trimmedUrl) {
      setBulkError('Google Sheets URL majburiy.');
      return;
    }

    setBulkError(null);
    setBulkSuccess(null);

    try {
      const result = await bulkImportFromSheetMutation.mutateAsync({
        sheetUrl: trimmedUrl,
        fallbackManagerUserId: bulkFallbackManagerUserId || undefined,
      }) as BulkImportResult;
      setBulkSuccess(summarizeBulkResult(result));
      await Promise.all([formOptionsQuery.refetch(), incomesQuery.refetch()]);
    } catch (sheetImportError) {
      setBulkError(parseBulkImportError(sheetImportError));
    }
  };

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
      await Promise.all([formOptionsQuery.refetch(), incomesQuery.refetch()]);
    } catch (deleteError: any) {
      setError(deleteError?.message || "Tushum yozuvini o'chirib bo'lmadi.");
    } finally {
      setDeletingIncomeId(null);
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
      if (coursePriceAmount <= 0) nextErrors.coursePriceInput = "Kurs narxi 0 dan katta bo'lsin.";
      if (paymentAmount < 0) nextErrors.paymentInput = "To'lov manfiy bo'lishi mumkin emas.";
    }

    if (type === 'repayment') {
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
      setDeadline('');
      setFieldErrors({});
      await Promise.all([formOptionsQuery.refetch(), incomesQuery.refetch()]);
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

      {isAdmin && (
        <div className="rounded-lg bg-white shadow dark:bg-slate-900">
          <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
            <h2 className="text-lg font-medium text-gray-900 dark:text-slate-100">Ommaviy yuklash</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              Avval namunani yuklab oling, so'ng Excel/CSV yuklang yoki Google Sheets dan import qiling.
            </p>
          </div>

          <div className="space-y-4 p-6">
            {bulkError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{bulkError}</p>}
            {bulkSuccess && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{bulkSuccess}</p>}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Zaxira sotuv menedjeri (mos kelmagan ism uchun)</label>
              <select
                value={bulkFallbackManagerUserId}
                onChange={(event) => {
                  setBulkFallbackManagerUserId(event.target.value);
                  clearFieldError('bulkFallbackManagerUserId');
                }}
                className={buildFieldClass(fieldErrors, 'bulkFallbackManagerUserId')}
              >
                <option value="">Zaxira menedjer yo'q</option>
                {managers.map((manager: any) => (
                  <option key={`bulk-fallback-${manager.id}`} value={manager.id}>
                    {manager.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                Excel/Sheets dagi ism tizim foydalanuvchisiga mos kelmasa, shu menedjer ishlatiladi.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
              >
                Excel namunasini yuklash
              </button>
              <label className="cursor-pointer rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                Excel/CSV yuklash
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileImport}
                  className="hidden"
                  disabled={bulkImportRowsMutation.isLoading || bulkImportFromSheetMutation.isLoading}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
              <input
                value={googleSheetUrl}
                onChange={(event) => setGoogleSheetUrl(event.target.value)}
                placeholder="Google Sheets URL yoki Spreadsheet ID"
                className={buildFieldClass(fieldErrors, 'googleSheetUrl', 'mt-0')}
              />
              <button
                type="button"
                onClick={handleGoogleSheetImport}
                disabled={bulkImportRowsMutation.isLoading || bulkImportFromSheetMutation.isLoading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {bulkImportFromSheetMutation.isLoading ? 'Import qilinmoqda...' : 'Google Sheets dan import'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h2 className="text-lg font-medium text-gray-900 dark:text-slate-100">Tushum kiritish formasi</h2>
        </div>

        <div className="p-6">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
          {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">{success}</p>}

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
                <input
                  list="customer-number-options"
                  value={customerNumber}
                  onChange={(event) => {
                    setCustomerNumber(sanitizeCustomerNumber(event.target.value));
                    clearFieldError('customerNumber');
                  }}
                  className={buildFieldClass(fieldErrors, 'customerNumber')}
                  placeholder="998901234567"
                  inputMode="numeric"
                  pattern="\d*"
                  autoComplete="off"
                />
                {fieldErrors.customerNumber && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.customerNumber}</p>}
                <datalist id="customer-number-options">
                  {customers.map((customer) => (
                    <option
                      key={customer.id}
                      value={customer.customerNumber}
                      label={`${customer.customerNumber} - ${customer.name}`}
                    />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz ismi {!isExistingCustomer && <span className="text-red-500">*</span>}</label>
                <input
                  list="customer-name-options"
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
                <datalist id="customer-name-options">
                  {customers.map((customer) => (
                    <option key={`${customer.id}-name`} value={customer.name} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Telegram username</label>
                <input
                  list="customer-telegram-options"
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
                <datalist id="customer-telegram-options">
                  {customers
                    .filter((customer) => Boolean(customer.telegramUsername))
                    .map((customer) => (
                      <option key={`${customer.id}-telegram`} value={customer.telegramUsername || ''} />
                    ))}
                </datalist>
              </div>
            </div>

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
                  <option value="repayment">Qarzdorlik</option>
                </select>
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
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Subtarif</label>
                      <select
                        value={subTariffId}
                        onChange={(event) => setSubTariffId(event.target.value)}
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

            <button
              type="submit"
              disabled={createIncomeMutation.isLoading || formOptionsQuery.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createIncomeMutation.isLoading ? 'Saqlanmoqda...' : 'Tushumni saqlash'}
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h2 className="text-lg font-medium text-gray-900 dark:text-slate-100">So'nggi tushumlar</h2>
        </div>

        <div className="p-6">
          {incomesQuery.isLoading ? (
            <p className="text-sm text-gray-600 dark:text-slate-300">Tushumlar yuklanmoqda...</p>
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
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          {[income.course?.name, income.tariff?.name].filter(Boolean).join(' / ') || '-'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getLifecycleStatusBadge(income.lifecycleStatus).className}`}>
                            {getLifecycleStatusBadge(income.lifecycleStatus).label}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{formatAmount(income.paymentAmount)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-slate-300">{formatAmount(income.remainingDebtAmount)}</td>
                        {isAdmin && (
                          <td className="whitespace-nowrap px-4 py-3 text-sm">
                            <button
                              type="button"
                              onClick={() => handleDeleteIncome(income.id)}
                              disabled={deletingIncomeId === income.id}
                              className="rounded-md border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/40"
                            >
                              {deletingIncomeId === income.id ? "O'chirilmoqda..." : "O'chirish"}
                            </button>
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
    </div>
  );
}


