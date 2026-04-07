'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/contexts/auth-context';

type AdjustmentMode = '' | 'refund' | 'tariff_change';
type ReviewAction = 'approve' | 'reject';

function toDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function formatDigits(value: string): string {
  if (!value) return '';
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseAmount(value: string): number {
  const digits = toDigits(value);
  if (!digits) return 0;
  return Number.parseInt(digits, 10);
}

function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  return formatDigits(String(Math.max(0, value)));
}

function getIncomeStatusBadge(status: string) {
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
}

function getRequestTypeLabel(type: string): string {
  return type === 'refund' ? 'Pul qaytarish' : "Tarif o'zgarishi";
}

function getRequestStatusLabel(status: string): string {
  if (status === 'approved') return 'Tasdiqlangan';
  if (status === 'rejected') return 'Rad etilgan';
  return 'Kutilmoqda';
}

function formatCourseBundle(courseName?: string | null, tariffName?: string | null, subTariffName?: string | null): string {
  const parts = [courseName, tariffName, subTariffName].filter(Boolean);
  return parts.length ? parts.join(' / ') : '-';
}

export default function AdjustmentsPage() {
  const { user } = useAuth();
  const roles = (user?.roles || []).map((role) => String(role));

  const canApproveRefund = roles.includes('Admin') || roles.includes('Finance');
  const canApproveTariffChange =
    roles.includes('Admin')
    || roles.includes('Manager')
    || roles.includes('TeamLeader')
    || roles.includes('Tashkiliy')
    || roles.includes('Organizator')
    || roles.includes('Organizer');

  const [mode, setMode] = useState<AdjustmentMode>('');
  const [customerNumberInput, setCustomerNumberInput] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedIncomeId, setSelectedIncomeId] = useState('');
  const [newCourseId, setNewCourseId] = useState('');
  const [newTariffId, setNewTariffId] = useState('');
  const [newAgreementInput, setNewAgreementInput] = useState('');
  const [reason, setReason] = useState('');
  const [reviewModal, setReviewModal] = useState<{ requestId: string; action: ReviewAction } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const customerSearchQuery = trpc.customerIncome.searchCustomers.useQuery(
    { query: customerNumberInput.trim(), limit: 40 },
    { enabled: customerNumberInput.trim().length > 0, retry: false },
  );
  const formOptionsQuery = trpc.customerIncome.formOptions.useQuery(undefined, { retry: false });
  const adjustableIncomesQuery = trpc.customerIncome.listAdjustableIncomes.useQuery(
    { customerId: selectedCustomerId },
    { enabled: Boolean(selectedCustomerId), retry: false },
  );
  const requestsQuery = trpc.customerIncome.listAdjustmentRequests.useQuery({ limit: 120 }, { retry: false });
  const adjustmentBadgeQuery = trpc.customerIncome.adjustmentBadgeCount.useQuery(undefined, {
    retry: false,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
  const createRequestMutation = trpc.customerIncome.createAdjustmentRequest.useMutation();
  const approveRequestMutation = trpc.customerIncome.approveAdjustmentRequest.useMutation();
  const rejectRequestMutation = trpc.customerIncome.rejectAdjustmentRequest.useMutation();

  const customerOptions = useMemo(() => customerSearchQuery.data || [], [customerSearchQuery.data]);
  const customerByNumber = useMemo(() => {
    const map = new Map<string, any>();
    for (const customer of customerOptions) {
      map.set(String(customer.customerNumber || '').trim().toLowerCase(), customer);
    }
    return map;
  }, [customerOptions]);
  const selectedCustomer = useMemo(
    () => adjustableIncomesQuery.data?.customer || null,
    [adjustableIncomesQuery.data],
  );

  const incomeOptions = useMemo(() => {
    const all = adjustableIncomesQuery.data?.incomes || [];
    if (mode === 'refund') {
      return all.filter((income: any) => income.canCreateRequest);
    }
    if (mode === 'tariff_change') {
      return all.filter((income: any) => income.canChangeTariff);
    }
    return all;
  }, [adjustableIncomesQuery.data, mode]);

  const selectedIncome = useMemo(
    () => incomeOptions.find((income: any) => income.id === selectedIncomeId) || null,
    [incomeOptions, selectedIncomeId],
  );
  const reviewRequest = useMemo(
    () => (reviewModal ? (requestsQuery.data || []).find((request: any) => request.id === reviewModal.requestId) || null : null),
    [reviewModal, requestsQuery.data],
  );

  const courseOptions = useMemo(() => formOptionsQuery.data?.courses || [], [formOptionsQuery.data]);
  const tariffOptions = useMemo(() => {
    if (!newCourseId) return [];
    const course = courseOptions.find((item: any) => item.id === newCourseId);
    return course?.tariffs || [];
  }, [courseOptions, newCourseId]);

  useEffect(() => {
    const normalized = customerNumberInput.trim().toLowerCase();
    if (!normalized) {
      setSelectedCustomerId('');
      return;
    }
    const match = customerByNumber.get(normalized);
    setSelectedCustomerId(match?.id || '');
  }, [customerByNumber, customerNumberInput]);

  useEffect(() => {
    if (!incomeOptions.length) {
      setSelectedIncomeId('');
      return;
    }
    if (!incomeOptions.some((income: any) => income.id === selectedIncomeId)) {
      setSelectedIncomeId(incomeOptions[0].id);
    }
  }, [incomeOptions, selectedIncomeId]);

  useEffect(() => {
    if (mode !== 'tariff_change') {
      setNewCourseId('');
      setNewTariffId('');
      setNewAgreementInput('');
    }
  }, [mode]);

  useEffect(() => {
    if (!newCourseId) {
      setNewTariffId('');
      return;
    }
    if (!tariffOptions.some((item: any) => item.id === newTariffId)) {
      setNewTariffId('');
    }
  }, [newCourseId, newTariffId, tariffOptions]);

  const handleCreateRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!mode) {
      setError("Avval turini tanlang: 'Pul qaytarish' yoki 'Tarif o'zgarishi'.");
      return;
    }
    if (!selectedCustomerId || !selectedIncomeId) {
      setError('Mijoz va tranzaksiya tanlanishi shart.');
      return;
    }

    if (mode === 'tariff_change') {
      const agreementAmount = parseAmount(newAgreementInput);
      if (!newCourseId || !newTariffId || agreementAmount <= 0) {
        setError("Tarif o'zgarishi uchun kurs, tarif va kelishuv summasi majburiy.");
        return;
      }
    }

    try {
      await createRequestMutation.mutateAsync({
        type: mode,
        incomeId: selectedIncomeId,
        reason: reason.trim() || undefined,
        newCourseId: mode === 'tariff_change' ? newCourseId : undefined,
        newTariffId: mode === 'tariff_change' ? newTariffId : undefined,
        newAgreementAmount: mode === 'tariff_change' ? parseAmount(newAgreementInput) : undefined,
      });

      setSuccess("So'rov yuborildi.");
      setReason('');
      if (mode === 'tariff_change') {
        setNewCourseId('');
        setNewTariffId('');
        setNewAgreementInput('');
      }
      await Promise.all([adjustableIncomesQuery.refetch(), requestsQuery.refetch(), adjustmentBadgeQuery.refetch()]);
    } catch (mutationError: any) {
      setError(mutationError?.message || "So'rov yuborishda xatolik yuz berdi.");
    }
  };

  const openReviewModal = (requestId: string, action: ReviewAction) => {
    setError(null);
    setSuccess(null);
    setReviewNote('');
    setReviewModal({ requestId, action });
  };

  const closeReviewModal = () => {
    if (approveRequestMutation.isLoading || rejectRequestMutation.isLoading) return;
    setReviewModal(null);
    setReviewNote('');
  };

  const handleApprove = async (requestId: string, note?: string): Promise<boolean> => {
    setError(null);
    setSuccess(null);
    try {
      await approveRequestMutation.mutateAsync({ requestId, reviewNote: note?.trim() || undefined });
      setSuccess("So'rov tasdiqlandi.");
      await Promise.all([adjustableIncomesQuery.refetch(), requestsQuery.refetch(), adjustmentBadgeQuery.refetch()]);
      return true;
    } catch (mutationError: any) {
      setError(mutationError?.message || "Tasdiqlashda xatolik yuz berdi.");
      return false;
    }
  };

  const handleReject = async (requestId: string, note?: string): Promise<boolean> => {
    setError(null);
    setSuccess(null);
    try {
      await rejectRequestMutation.mutateAsync({ requestId, reviewNote: note?.trim() || undefined });
      setSuccess("So'rov rad etildi.");
      await Promise.all([adjustableIncomesQuery.refetch(), requestsQuery.refetch(), adjustmentBadgeQuery.refetch()]);
      return true;
    } catch (mutationError: any) {
      setError(mutationError?.message || 'Rad etishda xatolik yuz berdi.');
      return false;
    }
  };

  const handleReviewSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewModal) return;

    let ok = false;
    if (reviewModal.action === 'approve') {
      ok = await handleApprove(reviewModal.requestId, reviewNote);
    } else {
      ok = await handleReject(reviewModal.requestId, reviewNote);
    }

    if (ok) {
      setReviewModal(null);
      setReviewNote('');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100">Qaytarish / O&apos;zgarish</h1>
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
            Kutilmoqda: {adjustmentBadgeQuery.data?.pendingTotal ?? 0}
          </span>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          Pul qaytarish yoki tarif o&apos;zgarishi bo&apos;yicha so&apos;rov yuboring va tasdiqlash holatini kuzating.
        </p>
      </div>

      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h2 className="text-lg font-medium text-gray-900 dark:text-slate-100">Yangi so&apos;rov</h2>
        </div>
        <div className="space-y-4 p-6">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
          {success && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950/30 dark:text-green-300">{success}</p>}

          <form onSubmit={handleCreateRequest} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">So&apos;rov turi</label>
                <select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as AdjustmentMode)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Tanlang</option>
                  <option value="refund">Pul qaytarish</option>
                  <option value="tariff_change">Tarif o&apos;zgarishi</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Mijoz raqami</label>
                <input
                  list="adjustment-customer-options"
                  value={customerNumberInput}
                  onChange={(event) => setCustomerNumberInput(event.target.value)}
                  placeholder="Raqam kiriting..."
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
                <datalist id="adjustment-customer-options">
                  {customerOptions.map((customer: any) => (
                    <option
                      key={customer.id}
                      value={customer.customerNumber}
                      label={`${customer.customerNumber} - ${customer.name}`}
                    />
                  ))}
                </datalist>
              </div>
            </div>

            {selectedCustomer && (
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <p><span className="font-medium">Mijoz:</span> {selectedCustomer.customerNumber} - {selectedCustomer.name}</p>
                <p><span className="font-medium">Telegram:</span> {selectedCustomer.telegramUsername || '-'}</p>
              </div>
            )}

            {mode && selectedCustomerId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Tranzaksiya</label>
                <select
                  value={selectedIncomeId}
                  onChange={(event) => setSelectedIncomeId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Tranzaksiyani tanlang</option>
                  {incomeOptions.map((income: any) => (
                    <option key={income.id} value={income.id}>
                      {new Date(income.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })} | {income.type === 'repayment' ? 'Qarzdorlik' : 'Yangi sotuv'} | {formatAmount(income.paymentAmount)} UZS
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedIncome && (
              <div className="space-y-3 rounded-md border border-gray-200 p-3 dark:border-slate-700">
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getIncomeStatusBadge(selectedIncome.lifecycleStatus).className}`}>
                  {getIncomeStatusBadge(selectedIncome.lifecycleStatus).label}
                </span>
                <div className="grid grid-cols-1 gap-3 text-sm text-gray-700 md:grid-cols-2 dark:text-slate-200">
                  <p><span className="font-medium">Kurs/Tarif:</span> {[selectedIncome.course?.name, selectedIncome.tariff?.name].filter(Boolean).join(' / ') || '-'}</p>
                  <p><span className="font-medium">To&apos;lov:</span> {formatAmount(selectedIncome.paymentAmount)} UZS</p>
                  <p><span className="font-medium">Kelishuv:</span> {formatAmount(selectedIncome.coursePriceAmount)} UZS</p>
                  <p><span className="font-medium">Qolgan qarz:</span> {formatAmount(selectedIncome.remainingDebtAmount)} UZS</p>
                </div>
              </div>
            )}

            {mode === 'tariff_change' && (
              <div className="grid grid-cols-1 gap-4 rounded-md border border-blue-100 bg-blue-50/40 p-4 md:grid-cols-3 dark:border-blue-900/60 dark:bg-blue-950/20">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Yangi kurs</label>
                  <select
                    value={newCourseId}
                    onChange={(event) => setNewCourseId(event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="">Tanlang</option>
                    {courseOptions.map((course: any) => (
                      <option key={course.id} value={course.id}>{course.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Yangi tarif</label>
                  <select
                    value={newTariffId}
                    onChange={(event) => setNewTariffId(event.target.value)}
                    disabled={!newCourseId}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700"
                  >
                    <option value="">Tanlang</option>
                    {tariffOptions.map((tariff: any) => (
                      <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Yangi kelishuv summasi</label>
                  <input
                    value={newAgreementInput}
                    onChange={(event) => setNewAgreementInput(formatDigits(toDigits(event.target.value)))}
                    inputMode="numeric"
                    placeholder="0"
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Izoh</label>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                placeholder="Ixtiyoriy izoh..."
              />
            </div>

            <button
              type="submit"
              disabled={createRequestMutation.isLoading || !mode || !selectedCustomerId || !selectedIncomeId}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {createRequestMutation.isLoading ? "Yuborilmoqda..." : "So'rov yuborish"}
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-lg bg-white shadow dark:bg-slate-900">
        <div className="border-b border-gray-100 px-6 py-5 dark:border-slate-700">
          <h2 className="text-lg font-medium text-gray-900 dark:text-slate-100">So&apos;rovlar tarixi</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            Sariq va qizil holatdagi tushumlar bonus va umumiy tushum hisobiga kiritilmaydi.
          </p>
        </div>
        <div className="p-6">
          {requestsQuery.isLoading ? (
            <p className="text-sm text-gray-600 dark:text-slate-300">Yuklanmoqda...</p>
          ) : requestsQuery.data?.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Sana</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Tur</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Mijoz</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Holat</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Izoh</th>
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">Amal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
                  {requestsQuery.data.map((request: any) => {
                    const canReview = request.status === 'pending'
                      && ((request.type === 'refund' && canApproveRefund) || (request.type === 'tariff_change' && canApproveTariffChange));
                    return (
                      <tr key={request.id}>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                          {new Date(request.createdAt).toLocaleString('en-CA', { timeZone: 'Asia/Tashkent' })}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{getRequestTypeLabel(request.type)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                          {request.income.customer.customerNumber} - {request.income.customer.name}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{getRequestStatusLabel(request.status)}</td>
                        <td className="max-w-xs px-3 py-2 text-sm text-gray-700 dark:text-slate-300">{request.reason || request.reviewNote || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700 dark:text-slate-300">
                          {canReview ? (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openReviewModal(request.id, 'approve')}
                                disabled={approveRequestMutation.isLoading || rejectRequestMutation.isLoading}
                                className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                Qabul qilish
                              </button>
                              <button
                                type="button"
                                onClick={() => openReviewModal(request.id, 'reject')}
                                disabled={approveRequestMutation.isLoading || rejectRequestMutation.isLoading}
                                className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                Rad etish
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-500 dark:text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-slate-300">Hozircha so&apos;rovlar yo&apos;q.</p>
          )}
        </div>
      </div>

      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
              {reviewModal.action === 'approve' ? "So'rovni qabul qilish" : "So'rovni rad etish"}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
              Iltimos, qaror bo&apos;yicha izoh qoldiring.
            </p>

            <form onSubmit={handleReviewSubmit} className="mt-4 space-y-4">
              {reviewRequest && (
                <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <p><span className="font-medium">So&apos;rov turi:</span> {getRequestTypeLabel(reviewRequest.type)}</p>
                    <p>
                      <span className="font-medium">Mijoz:</span> {reviewRequest.income.customer.customerNumber} - {reviewRequest.income.customer.name}
                    </p>
                  </div>

                  <div className="rounded-md border border-gray-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-900">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Oldingi ma&apos;lumot</p>
                    <div className="mt-2 grid grid-cols-1 gap-1">
                      <p>
                        <span className="font-medium">Kurs / Tarif / Subtarif:</span>{' '}
                        {formatCourseBundle(
                          reviewRequest.income.course?.name,
                          reviewRequest.income.tariff?.name,
                          reviewRequest.income.profileSubTariffName,
                        )}
                      </p>
                      <p><span className="font-medium">Kelishuv:</span> {formatAmount(reviewRequest.income.coursePriceAmount)} UZS</p>
                    </div>
                  </div>

                  <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Yangi ma&apos;lumot</p>
                    <div className="mt-2 grid grid-cols-1 gap-1">
                      <p>
                        <span className="font-medium">Kurs / Tarif / Subtarif:</span>{' '}
                        {formatCourseBundle(
                          reviewRequest.newCourse?.name || reviewRequest.income.course?.name,
                          reviewRequest.newTariff?.name || reviewRequest.income.tariff?.name,
                          reviewRequest.inferredNewSubTariffName || reviewRequest.income.profileSubTariffName || null,
                        )}
                      </p>
                      <p>
                        <span className="font-medium">Kelishuv:</span>{' '}
                        {formatAmount(reviewRequest.newAgreementAmount ?? reviewRequest.income.coursePriceAmount)} UZS
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Izoh</label>
                <textarea
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  rows={4}
                  placeholder="Izoh kiriting..."
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeReviewModal}
                  disabled={approveRequestMutation.isLoading || rejectRequestMutation.isLoading}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={approveRequestMutation.isLoading || rejectRequestMutation.isLoading}
                  className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                    reviewModal.action === 'approve'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {approveRequestMutation.isLoading || rejectRequestMutation.isLoading
                    ? 'Saqlanmoqda...'
                    : reviewModal.action === 'approve'
                      ? 'Qabul qilish'
                      : 'Rad etish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
