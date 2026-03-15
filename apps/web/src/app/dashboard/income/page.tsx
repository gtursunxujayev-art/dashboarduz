'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

type IncomeType = 'new_sale' | 'repayment';

type CustomerOption = {
  id: string;
  customerNumber: string;
  name: string;
  telegramUsername?: string | null;
};

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

export default function IncomePage() {
  const [entryDate, setEntryDate] = useState(getTashkentToday());
  const [managerUserId, setManagerUserId] = useState('');
  const [customerNumber, setCustomerNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [telegramUsername, setTelegramUsername] = useState('');
  const [type, setType] = useState<IncomeType>('new_sale');
  const [debtSourceIncomeId, setDebtSourceIncomeId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [tariffId, setTariffId] = useState('');
  const [coursePriceInput, setCoursePriceInput] = useState('');
  const [paymentInput, setPaymentInput] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const formOptionsQuery = trpc.customerIncome.formOptions.useQuery(undefined, {
    retry: false,
  });
  const incomesQuery = trpc.customerIncome.listIncomes.useQuery({ limit: 30 }, { retry: false });
  const searchCustomersQuery = trpc.customerIncome.searchCustomers.useQuery(
    { query: customerNumber.trim(), limit: 30 },
    {
      enabled: customerNumber.trim().length > 0,
      retry: false,
    },
  );
  const createIncomeMutation = trpc.customerIncome.createIncome.useMutation();

  const managers = useMemo(() => formOptionsQuery.data?.managers || [], [formOptionsQuery.data]);
  const courseOptions = useMemo(() => formOptionsQuery.data?.courses || [], [formOptionsQuery.data]);
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

  const tariffOptions = useMemo(() => {
    if (!courseId) {
      return [];
    }
    const course = courseOptions.find((item: any) => item.id === courseId);
    return Array.isArray(course?.tariffs) ? course.tariffs : [];
  }, [courseId, courseOptions]);

  const coursePriceAmount = parseAmount(coursePriceInput);
  const paymentAmount = parseAmount(paymentInput);
  const sourceDebtAmount = selectedDebt?.remainingDebtAmount || 0;
  const remainingDebtAmount = type === 'new_sale'
    ? Math.max(coursePriceAmount - paymentAmount, 0)
    : Math.max(sourceDebtAmount - paymentAmount, 0);

  useEffect(() => {
    if (!managerUserId && managers.length > 0) {
      setManagerUserId(managers[0].id);
    }
  }, [managerUserId, managers]);

  useEffect(() => {
    if (!selectedCustomer) {
      return;
    }
    setCustomerName(selectedCustomer.name || '');
    setTelegramUsername(selectedCustomer.telegramUsername || '');
  }, [selectedCustomer]);

  useEffect(() => {
    if (type === 'new_sale') {
      setDebtSourceIncomeId('');
      return;
    }
    setCourseId('');
    setTariffId('');
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
    setCustomerNumber(debt.customerNumber || '');
    setCustomerName(debt.customerName || '');
  }, [debtOptions, debtSourceIncomeId]);

  useEffect(() => {
    if (!courseId) {
      setTariffId('');
      return;
    }
    const exists = tariffOptions.some((tariff: any) => tariff.id === tariffId);
    if (!exists) {
      setTariffId('');
    }
  }, [courseId, tariffId, tariffOptions]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!entryDate) {
      setError('Sana is required.');
      return;
    }

    if (!managerUserId) {
      setError('Sales manager is required.');
      return;
    }

    const customerNumberValue = customerNumber.trim();
    if (!customerNumberValue) {
      setError('Mijoz raqami is required.');
      return;
    }

    if (!isExistingCustomer && !customerName.trim()) {
      setError('Mijoz ismi is required for a new customer.');
      return;
    }

    if (type === 'new_sale') {
      if (!courseId || !tariffId) {
        setError('Please select both course and tariff.');
        return;
      }
      if (coursePriceAmount <= 0) {
        setError('Kurs narxi must be greater than zero.');
        return;
      }
      if (paymentAmount < 0) {
        setError("To'lov cannot be negative.");
        return;
      }
    }

    if (type === 'repayment') {
      if (!debtSourceIncomeId) {
        setError('Please select current debt source.');
        return;
      }
      if (paymentAmount <= 0) {
        setError("To'lov must be greater than zero for repayment.");
        return;
      }
      if (paymentAmount > sourceDebtAmount) {
        setError("To'lov cannot exceed current debt.");
        return;
      }
    }

    try {
      await createIncomeMutation.mutateAsync({
        entryDate,
        managerUserId,
        customerNumber: customerNumberValue,
        customerName: isExistingCustomer ? undefined : customerName.trim(),
        telegramUsername: isExistingCustomer ? undefined : (telegramUsername.trim() || undefined),
        type,
        debtSourceIncomeId: type === 'repayment' ? debtSourceIncomeId : undefined,
        courseId: type === 'new_sale' ? courseId : undefined,
        tariffId: type === 'new_sale' ? tariffId : undefined,
        coursePriceAmount: type === 'new_sale' ? coursePriceAmount : undefined,
        paymentAmount,
        deadline: deadline || undefined,
      });

      setSuccess('Income entry saved successfully.');
      setPaymentInput('');
      setDeadline('');
      if (type === 'new_sale') {
        setCourseId('');
        setTariffId('');
        setCoursePriceInput('');
      } else {
        setDebtSourceIncomeId('');
      }
      await Promise.all([formOptionsQuery.refetch(), incomesQuery.refetch()]);
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Failed to save income entry.');
    }
  };

  const formatIncomeType = (incomeType: string): string => {
    return incomeType === 'repayment' ? 'Qarzdorlik' : 'Yangi sotuv';
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Customer & Income</h1>
        <p className="mt-1 text-sm text-gray-500">
          Add new sales and debt repayments by customer.
        </p>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-medium text-gray-900">Income Entry Form</h2>
        </div>

        <div className="p-6">
          {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {success && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">Sana</label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(event) => setEntryDate(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Sales Manager</label>
                <select
                  value={managerUserId}
                  onChange={(event) => setManagerUserId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select manager</option>
                  {managers.map((manager: any) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Mijoz raqami</label>
                <input
                  list="customer-number-options"
                  value={customerNumber}
                  onChange={(event) => setCustomerNumber(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="998901234567"
                  autoComplete="off"
                />
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
                <label className="block text-sm font-medium text-gray-700">Mijoz ismi</label>
                <input
                  list="customer-name-options"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  readOnly={isExistingCustomer}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 read-only:bg-gray-100 read-only:text-gray-600"
                  placeholder="Customer name"
                  autoComplete="off"
                />
                <datalist id="customer-name-options">
                  {customers.map((customer) => (
                    <option key={`${customer.id}-name`} value={customer.name} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Telegram username</label>
                <input
                  list="customer-telegram-options"
                  value={telegramUsername}
                  onChange={(event) => setTelegramUsername(event.target.value)}
                  readOnly={isExistingCustomer}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 read-only:bg-gray-100 read-only:text-gray-600"
                  placeholder="@username"
                  autoComplete="off"
                />
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
                <label className="block text-sm font-medium text-gray-700">Income type</label>
                <select
                  value={type}
                  onChange={(event) => setType(event.target.value as IncomeType)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="new_sale">Yangi sotuv</option>
                  <option value="repayment">Qarzdorlik</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Deadline</label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {type === 'repayment' ? (
              <div className="space-y-4 rounded-md border border-blue-100 bg-blue-50/40 p-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Current debt</label>
                  <select
                    value={debtSourceIncomeId}
                    onChange={(event) => setDebtSourceIncomeId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Select debt</option>
                    {debtOptionsForCustomer.map((debt: any) => (
                      <option key={debt.id} value={debt.id}>
                        {debt.customerNumber} - {debt.customerName} | {debt.courseName || 'No course'} / {debt.tariffName || 'No tariff'} | Debt: {formatAmount(debt.remainingDebtAmount)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Qarz summasi</label>
                    <input
                      value={formatAmount(sourceDebtAmount)}
                      readOnly
                      className="mt-1 w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-700"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">To&apos;lov</label>
                    <input
                      value={paymentInput}
                      onChange={(event) => setPaymentInput(formatDigits(toDigits(event.target.value)))}
                      inputMode="numeric"
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Qarzdorlik</label>
                    <input
                      value={formatAmount(remainingDebtAmount)}
                      readOnly
                      className="mt-1 w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-700"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 rounded-md border border-green-100 bg-green-50/30 p-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Kurs</label>
                    <select
                      value={courseId}
                      onChange={(event) => setCourseId(event.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">Select course</option>
                      {courseOptions.map((course: any) => (
                        <option key={course.id} value={course.id}>
                          {course.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Tarif</label>
                    <select
                      value={tariffId}
                      onChange={(event) => setTariffId(event.target.value)}
                      disabled={!courseId}
                      className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                    >
                      <option value="">Select tariff</option>
                      {tariffOptions.map((tariff: any) => (
                        <option key={tariff.id} value={tariff.id}>
                          {tariff.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Kurs narxi</label>
                    <input
                      value={coursePriceInput}
                      onChange={(event) => setCoursePriceInput(formatDigits(toDigits(event.target.value)))}
                      inputMode="numeric"
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">To&apos;lov</label>
                    <input
                      value={paymentInput}
                      onChange={(event) => setPaymentInput(formatDigits(toDigits(event.target.value)))}
                      inputMode="numeric"
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Qarzdorlik</label>
                    <input
                      value={formatAmount(remainingDebtAmount)}
                      readOnly
                      className="mt-1 w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-700"
                    />
                  </div>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={createIncomeMutation.isLoading || formOptionsQuery.isLoading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createIncomeMutation.isLoading ? 'Saving...' : 'Save Income'}
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow">
        <div className="border-b border-gray-100 px-6 py-5">
          <h2 className="text-lg font-medium text-gray-900">Recent Incomes</h2>
        </div>

        <div className="p-6">
          {incomesQuery.isLoading ? (
            <p className="text-sm text-gray-600">Loading incomes...</p>
          ) : incomesQuery.data?.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Sana</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Type</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Customer</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Manager</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Course/Tariff</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Payment</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Remaining debt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {incomesQuery.data.map((income: any) => (
                    <tr key={income.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                        {new Date(income.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                        {formatIncomeType(income.type)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                        {income.customer?.customerNumber} - {income.customer?.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                        {income.manager?.name || income.manager?.username || '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                        {[income.course?.name, income.tariff?.name].filter(Boolean).join(' / ') || '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{formatAmount(income.paymentAmount)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{formatAmount(income.remainingDebtAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-600">No income entries yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
