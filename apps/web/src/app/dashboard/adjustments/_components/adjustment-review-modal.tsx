'use client';

import { formatAmountDigits, formatCourseBundle } from '@/lib/format';
import { formatCardNumberInput, getRequestTypeLabel } from './adjustments-helpers';
import type { AdjustmentsPageModel } from './use-adjustments-page';

export function AdjustmentReviewModal({ vm }: { vm: AdjustmentsPageModel }) {
  const { approveRequestMutation, closeReviewModal, error, handleReviewSubmit, rejectRequestMutation, reviewModal, reviewNote, reviewRequest, setReviewNote } = vm;

  return (
    <>
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
              {/* The page-level banner sits behind this overlay, so review errors must render here. */}
              {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
              {reviewRequest && (
                <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <p><span className="font-medium">So&apos;rov turi:</span> {getRequestTypeLabel(reviewRequest.type)}</p>
                    <p>
                      <span className="font-medium">Mijoz:</span> {reviewRequest.income.customer.customerNumber} - {reviewRequest.income.customer.name}
                    </p>
                    <p><span className="font-medium">Mas&apos;ul agent:</span> {reviewRequest.income.managerLabel || '-'}</p>
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
                      <p><span className="font-medium">Kelishuv:</span> {formatAmountDigits(reviewRequest.income.coursePriceAmount)} UZS</p>
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
                        {formatAmountDigits(reviewRequest.newAgreementAmount ?? reviewRequest.income.coursePriceAmount)} UZS
                      </p>
                      {reviewRequest.type === 'refund' && (
                        <>
                          <p>
                            <span className="font-medium">Qaytariladigan summa:</span>{' '}
                            {formatAmountDigits(reviewRequest.requestedAmount ?? reviewRequest.income.paymentAmount)} UZS
                          </p>
                          <p>
                            <span className="font-medium">Karta raqami:</span>{' '}
                            {formatCardNumberInput(reviewRequest.refundCardNumber || '') || '-'}
                          </p>
                        </>
                      )}
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
    </>
  );
}
