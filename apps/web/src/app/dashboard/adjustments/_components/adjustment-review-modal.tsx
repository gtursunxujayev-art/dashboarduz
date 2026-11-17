'use client';

import type { ReactNode } from 'react';
import { IconArrowRight, IconCheck, IconX } from '@tabler/icons-react';
import { formatAmountDigits, formatCourseBundle } from '@/lib/format';
import { formatCardNumberInput, getRequestTypeLabel } from './adjustments-helpers';
import type { AdjustmentsPageModel } from './use-adjustments-page';

/** One labelled fact stacked as caption-like label over its value (fits the narrow compare columns). */
function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="break-words font-medium text-gray-900">{children}</p>
    </div>
  );
}

export function AdjustmentReviewModal({ vm }: { vm: AdjustmentsPageModel }) {
  const { approveRequestMutation, closeReviewModal, error, handleReviewSubmit, rejectRequestMutation, reviewModal, reviewNote, reviewRequest, setReviewNote } = vm;

  return (
    <>
      {reviewModal && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-[640px]">
            <div className="modal-header">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                    reviewModal.action === 'approve' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                  }`}
                >
                  {reviewModal.action === 'approve'
                    ? <IconCheck className="h-[18px] w-[18px]" stroke={1.8} />
                    : <IconX className="h-[18px] w-[18px]" stroke={1.8} />}
                </span>
                <div className="min-w-0">
                  <h3 className="modal-title">
                    {reviewModal.action === 'approve' ? "So'rovni qabul qilish" : "So'rovni rad etish"}
                  </h3>
                  <p className="modal-description mt-0.5">
                    Iltimos, qaror bo&apos;yicha izoh qoldiring.
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleReviewSubmit} className="flex flex-1 flex-col">
              <div className="modal-body space-y-5">
                {/* The page-level banner sits behind this overlay, so review errors must render here. */}
                {error && <p className="alert alert-error">{error}</p>}
                {reviewRequest && (
                  <div className="space-y-4 text-sm text-gray-700">
                    <div className="panel-inset divide-y divide-gray-200/70 py-1">
                      <p className="flex items-start justify-between gap-4 py-2.5">
                        <span className="flex-shrink-0 font-medium text-gray-900">So&apos;rov turi:</span>
                        <span className="text-right">{getRequestTypeLabel(reviewRequest.type)}</span>
                      </p>
                      <p className="flex items-start justify-between gap-4 py-2.5">
                        <span className="flex-shrink-0 font-medium text-gray-900">Mijoz:</span>
                        <span className="min-w-0 break-words text-right">{reviewRequest.income.customer.customerNumber} - {reviewRequest.income.customer.name}</span>
                      </p>
                      <p className="flex items-start justify-between gap-4 py-2.5">
                        <span className="flex-shrink-0 font-medium text-gray-900">Mas&apos;ul agent:</span>
                        <span className="text-right">{reviewRequest.income.managerLabel || '-'}</span>
                      </p>
                    </div>

                    <div className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                      <div className="rounded-[16px] border border-gray-200 p-4">
                        <p className="caption">Oldingi ma&apos;lumot</p>
                        <div className="mt-3 space-y-3">
                          <Fact label="Kurs / Tarif / Subtarif:">
                            {formatCourseBundle(
                              reviewRequest.income.course?.name,
                              reviewRequest.income.tariff?.name,
                              reviewRequest.income.profileSubTariffName,
                            )}
                          </Fact>
                          <Fact label="Kelishuv:">
                            <span className="tabular">{formatAmountDigits(reviewRequest.income.coursePriceAmount)} UZS</span>
                          </Fact>
                        </div>
                      </div>

                      <div className="flex items-center justify-center text-gray-400">
                        <span className="flex h-8 w-8 rotate-90 items-center justify-center rounded-full bg-gray-100 sm:rotate-0">
                          <IconArrowRight className="h-4 w-4" stroke={1.8} />
                        </span>
                      </div>

                      <div className="rounded-[16px] border border-blue-200 bg-blue-50 p-4">
                        <p className="caption text-blue-700">Yangi ma&apos;lumot</p>
                        <div className="mt-3 space-y-3">
                          <Fact label="Kurs / Tarif / Subtarif:">
                            {formatCourseBundle(
                              reviewRequest.newCourse?.name || reviewRequest.income.course?.name,
                              reviewRequest.newTariff?.name || reviewRequest.income.tariff?.name,
                              reviewRequest.inferredNewSubTariffName || reviewRequest.income.profileSubTariffName || null,
                            )}
                          </Fact>
                          <Fact label="Kelishuv:">
                            <span className="tabular">{formatAmountDigits(reviewRequest.newAgreementAmount ?? reviewRequest.income.coursePriceAmount)} UZS</span>
                          </Fact>
                          {reviewRequest.type === 'refund' && (
                            <>
                              <Fact label="Qaytariladigan summa:">
                                <span className="tabular">{formatAmountDigits(reviewRequest.requestedAmount ?? reviewRequest.income.paymentAmount)} UZS</span>
                              </Fact>
                              <Fact label="Karta raqami:">
                                <span className="tabular">{formatCardNumberInput(reviewRequest.refundCardNumber || '') || '-'}</span>
                              </Fact>
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
                  className={`btn ${reviewModal.action === 'approve' ? 'btn-success' : 'btn-danger'} sm:min-w-[150px]`}
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
