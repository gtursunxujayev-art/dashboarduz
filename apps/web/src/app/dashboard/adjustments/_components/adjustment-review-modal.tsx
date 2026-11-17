'use client';

import { IconArrowRight, IconCheck, IconX } from '@tabler/icons-react';
import { formatAmountDigits, formatCourseBundle } from '@/lib/format';
import { formatCardNumberInput, getRequestTypeLabel } from './adjustments-helpers';
import type { AdjustmentsPageModel } from './use-adjustments-page';

export function AdjustmentReviewModal({ vm }: { vm: AdjustmentsPageModel }) {
  const { approveRequestMutation, closeReviewModal, error, handleReviewSubmit, rejectRequestMutation, reviewModal, reviewNote, reviewRequest, setReviewNote } = vm;

  return (
    <>
      {reviewModal && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-2xl">
            <div className="modal-header">
              <h3 className="modal-title">
                {reviewModal.action === 'approve' ? "So'rovni qabul qilish" : "So'rovni rad etish"}
              </h3>
              <p className="modal-description">
                Iltimos, qaror bo&apos;yicha izoh qoldiring.
              </p>
            </div>

            <form onSubmit={handleReviewSubmit}>
              <div className="modal-body">
                {/* The page-level banner sits behind this overlay, so review errors must render here. */}
                {error && <p className="alert alert-error">{error}</p>}
                {reviewRequest && (
                  <div className="space-y-3 text-sm text-gray-700">
                    <div className="panel-inset grid grid-cols-1 gap-2 md:grid-cols-2">
                      <p><span className="font-medium text-gray-900">So&apos;rov turi:</span> {getRequestTypeLabel(reviewRequest.type)}</p>
                      <p>
                        <span className="font-medium text-gray-900">Mijoz:</span> {reviewRequest.income.customer.customerNumber} - {reviewRequest.income.customer.name}
                      </p>
                      <p><span className="font-medium text-gray-900">Mas&apos;ul agent:</span> {reviewRequest.income.managerLabel || '-'}</p>
                    </div>

                    <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                      <div className="rounded-[12px] border border-gray-200 p-4">
                        <p className="text-[13px] font-semibold text-gray-500">Oldingi ma&apos;lumot</p>
                        <div className="mt-2 grid grid-cols-1 gap-1.5">
                          <p>
                            <span className="font-medium text-gray-900">Kurs / Tarif / Subtarif:</span>{' '}
                            {formatCourseBundle(
                              reviewRequest.income.course?.name,
                              reviewRequest.income.tariff?.name,
                              reviewRequest.income.profileSubTariffName,
                            )}
                          </p>
                          <p><span className="font-medium text-gray-900">Kelishuv:</span> <span className="tabular">{formatAmountDigits(reviewRequest.income.coursePriceAmount)} UZS</span></p>
                        </div>
                      </div>

                      <div className="hidden items-center justify-center text-gray-400 md:flex">
                        <IconArrowRight className="h-5 w-5" stroke={1.6} />
                      </div>

                      <div className="rounded-[12px] border border-blue-200 bg-blue-50 p-4">
                        <p className="text-[13px] font-semibold text-blue-700">Yangi ma&apos;lumot</p>
                        <div className="mt-2 grid grid-cols-1 gap-1.5">
                          <p>
                            <span className="font-medium text-gray-900">Kurs / Tarif / Subtarif:</span>{' '}
                            {formatCourseBundle(
                              reviewRequest.newCourse?.name || reviewRequest.income.course?.name,
                              reviewRequest.newTariff?.name || reviewRequest.income.tariff?.name,
                              reviewRequest.inferredNewSubTariffName || reviewRequest.income.profileSubTariffName || null,
                            )}
                          </p>
                          <p>
                            <span className="font-medium text-gray-900">Kelishuv:</span>{' '}
                            <span className="tabular">{formatAmountDigits(reviewRequest.newAgreementAmount ?? reviewRequest.income.coursePriceAmount)} UZS</span>
                          </p>
                          {reviewRequest.type === 'refund' && (
                            <>
                              <p>
                                <span className="font-medium text-gray-900">Qaytariladigan summa:</span>{' '}
                                <span className="tabular">{formatAmountDigits(reviewRequest.requestedAmount ?? reviewRequest.income.paymentAmount)} UZS</span>
                              </p>
                              <p>
                                <span className="font-medium text-gray-900">Karta raqami:</span>{' '}
                                <span className="tabular">{formatCardNumberInput(reviewRequest.refundCardNumber || '') || '-'}</span>
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="field-label">Izoh</label>
                  <textarea
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                    rows={4}
                    placeholder="Izoh kiriting..."
                    className="field"
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  onClick={closeReviewModal}
                  disabled={approveRequestMutation.isLoading || rejectRequestMutation.isLoading}
                  className="btn btn-secondary"
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={approveRequestMutation.isLoading || rejectRequestMutation.isLoading}
                  className={`btn ${reviewModal.action === 'approve' ? 'btn-success' : 'btn-danger'}`}
                >
                  {reviewModal.action === 'approve'
                    ? <IconCheck className="h-4 w-4" stroke={2} />
                    : <IconX className="h-4 w-4" stroke={2} />}
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
