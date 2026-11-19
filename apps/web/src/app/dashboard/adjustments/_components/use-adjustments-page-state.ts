'use client';

import { useAuth } from '@/contexts/auth-context';
import { isAdminLike } from '@dashboarduz/shared';
import { parseAmountInput } from '@/lib/format';
import { trpc } from '@/lib/trpc';
import { normalizeDigits, type ReviewAction } from '@dashboarduz/shared';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import type { AdjustmentMode } from './adjustments-helpers';

export function useAdjustmentsPageState() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const roles = (user?.roles || []).map((role) => String(role));
  const canApproveRefund = roles.includes('Admin') || roles.includes('Finance');
  const canApproveTariffChange =
    // Team leaders are read-only; OnlineAdmin approves for online sellers (checked by the server).
    isAdminLike(roles)
    || roles.includes('Manager')
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
  const [refundCardNumberInput, setRefundCardNumberInput] = useState('');
  const [reason, setReason] = useState('');
  const [reviewModal, setReviewModal] = useState<{ requestId: string; action: ReviewAction } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const customerSearchQuery = trpc.customerIncome.searchCustomers.useQuery(
    { query: customerNumberInput.trim(), limit: 40 },
    {
      enabled: customerNumberInput.trim().length >= 2,
      retry: false,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    },
  );
  const formOptionsQuery = trpc.customerIncome.formOptions.useQuery(undefined, {
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const adjustableIncomesQuery = trpc.customerIncome.listAdjustableIncomes.useQuery(
    { customerId: selectedCustomerId },
    {
      enabled: Boolean(selectedCustomerId),
      retry: false,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    },
  );
  const requestsQuery = trpc.customerIncome.listAdjustmentRequests.useQuery(
    { limit: 120 },
    {
      retry: false,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
    },
  );
  const adjustmentBadgeQuery = trpc.customerIncome.adjustmentBadgeCount.useQuery(undefined, {
    retry: false,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    refetchOnWindowFocus: false,
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
    if (mode !== 'refund') {
      setRefundCardNumberInput('');
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

    if (mode === 'refund') {
      const refundCardDigits = normalizeDigits(refundCardNumberInput);
      if (refundCardDigits.length !== 16) {
        setError("Pul qaytarish uchun karta raqami 16 ta raqam bo'lishi shart.");
        return;
      }
    }

    if (mode === 'tariff_change') {
      const agreementAmount = parseAmountInput(newAgreementInput);
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
        refundCardNumber: mode === 'refund' ? normalizeDigits(refundCardNumberInput) : undefined,
        newCourseId: mode === 'tariff_change' ? newCourseId : undefined,
        newTariffId: mode === 'tariff_change' ? newTariffId : undefined,
        newAgreementAmount: mode === 'tariff_change' ? parseAmountInput(newAgreementInput) : undefined,
      });

      setSuccess("So'rov yuborildi.");
      setReason('');
      if (mode === 'tariff_change') {
        setNewCourseId('');
        setNewTariffId('');
        setNewAgreementInput('');
      }
      if (mode === 'refund') {
        setRefundCardNumberInput('');
      }
      await Promise.all([
        utils.customerIncome.listAdjustableIncomes.invalidate(),
        utils.customerIncome.listAdjustmentRequests.invalidate(),
        utils.customerIncome.adjustmentBadgeCount.invalidate(),
      ]);
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
      await Promise.all([
        utils.customerIncome.listAdjustableIncomes.invalidate(),
        utils.customerIncome.listAdjustmentRequests.invalidate(),
        utils.customerIncome.adjustmentBadgeCount.invalidate(),
      ]);
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
      await Promise.all([
        utils.customerIncome.listAdjustableIncomes.invalidate(),
        utils.customerIncome.listAdjustmentRequests.invalidate(),
        utils.customerIncome.adjustmentBadgeCount.invalidate(),
      ]);
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

  return { utils, user, roles, canApproveRefund, canApproveTariffChange, mode, setMode, customerNumberInput, setCustomerNumberInput, selectedCustomerId, setSelectedCustomerId, selectedIncomeId, setSelectedIncomeId, newCourseId, setNewCourseId, newTariffId, setNewTariffId, newAgreementInput, setNewAgreementInput, refundCardNumberInput, setRefundCardNumberInput, reason, setReason, reviewModal, setReviewModal, reviewNote, setReviewNote, error, setError, success, setSuccess, customerSearchQuery, formOptionsQuery, adjustableIncomesQuery, requestsQuery, adjustmentBadgeQuery, createRequestMutation, approveRequestMutation, rejectRequestMutation, customerOptions, customerByNumber, selectedCustomer, incomeOptions, selectedIncome, reviewRequest, courseOptions, tariffOptions, handleCreateRequest, openReviewModal, closeReviewModal, handleApprove, handleReject, handleReviewSubmit };
}
