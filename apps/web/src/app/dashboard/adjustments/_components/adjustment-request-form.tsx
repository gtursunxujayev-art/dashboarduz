'use client';

import type { ReactNode } from 'react';
import { IconFilePlus, IconSend } from '@tabler/icons-react';
import { getIncomeStatusBadge } from '@/components/dashboard/income-status-badge';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatAmountDigits } from '@/lib/format';
import { groupDigits, normalizeDigits } from '@dashboarduz/shared';
import { type AdjustmentMode, formatCardNumberInput } from './adjustments-helpers';
import type { AdjustmentsPageModel } from './use-adjustments-page';

/** Kit badge tone for an income lifecycle status (label still comes from getIncomeStatusBadge). */
function incomeStatusTone(status: string): string {
  if (status === 'pending_refund') return 'badge-amber';
  if (status === 'refunded') return 'badge-red';
  return 'badge-green';
}

/** Label left, value right: one line of the selected transaction's facts. */
function FactRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-start justify-between gap-4 py-2">
      <span className="flex-shrink-0 font-medium text-gray-900">{label}</span>
      <span className="min-w-0 break-words text-right text-gray-700">{children}</span>
    </p>
  );
}

export function AdjustmentRequestForm({ vm }: { vm: AdjustmentsPageModel }) {
  const { courseOptions, createRequestMutation, customerNumberInput, customerOptions, error, handleCreateRequest, incomeOptions, mode, newAgreementInput, newCourseId, newTariffId, reason, refundCardNumberInput, selectedCustomer, selectedCustomerId, selectedIncome, selectedIncomeId, setCustomerNumberInput, setMode, setNewAgreementInput, setNewCourseId, setNewTariffId, setReason, setRefundCardNumberInput, setSelectedIncomeId, success, tariffOptions } = vm;

  return (
    <section className="panel overflow-hidden">
      <div className="panel-header pb-5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <IconFilePlus className="h-[18px] w-[18px]" stroke={1.6} />
          </span>
          <h2 className="section-title">Yangi so&apos;rov</h2>
        </div>
      </div>

      <form onSubmit={handleCreateRequest}>
        <div className="space-y-4 border-t border-gray-100 px-5 py-5 sm:px-6">
          {error && <p className="alert alert-error">{error}</p>}
          {success && <p className="alert alert-success">{success}</p>}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-1">
            <div>
              <label className="field-label">So&apos;rov turi</label>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as AdjustmentMode)}
                className="field"
              >
                <option value="">Tanlang</option>
                <option value="refund">Pul qaytarish</option>
                <option value="tariff_change">Tarif o&apos;zgarishi</option>
              </select>
            </div>

            <div>
              <label className="field-label">Mijoz raqami</label>
              <input
                list="adjustment-customer-options"
                value={customerNumberInput}
                onChange={(event) => setCustomerNumberInput(event.target.value)}
                placeholder="Raqam kiriting..."
                className="field tabular"
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
            <div className="panel-inset flex items-center gap-3 px-3.5 py-3 text-sm text-gray-700">
              <UserAvatar name={selectedCustomer.name || String(selectedCustomer.customerNumber || '?')} size="sm" />
              <div className="min-w-0 space-y-0.5">
                <p className="truncate"><span className="font-medium text-gray-900">Mijoz:</span> {selectedCustomer.customerNumber} - {selectedCustomer.name}</p>
                <p className="truncate text-gray-500"><span className="font-medium text-gray-700">Telegram:</span> {selectedCustomer.telegramUsername || '-'}</p>
              </div>
            </div>
          )}

          {mode && selectedCustomerId && (
            <div>
              <label className="field-label">Tranzaksiya</label>
              <select
                value={selectedIncomeId}
                onChange={(event) => setSelectedIncomeId(event.target.value)}
                className="field"
              >
                <option value="">Tranzaksiyani tanlang</option>
                {incomeOptions.map((income: any) => (
                  <option key={income.id} value={income.id}>
                    {new Date(income.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })} | {income.type === 'repayment' ? 'Qarzdorlik' : 'Yangi sotuv'} | {formatAmountDigits(income.paymentAmount)} UZS
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedIncome && (
            <div className="rounded-[16px] border border-gray-200 px-4 pb-2 pt-3.5 text-sm">
              <span className={`badge ${incomeStatusTone(selectedIncome.lifecycleStatus)}`}>
                {getIncomeStatusBadge(selectedIncome.lifecycleStatus, { darkMode: true }).label}
              </span>
              <div className="mt-2 divide-y divide-gray-100">
                <FactRow label="Kurs/Tarif:">{[selectedIncome.course?.name, selectedIncome.tariff?.name].filter(Boolean).join(' / ') || '-'}</FactRow>
                <FactRow label={<>To&apos;lov:</>}><span className="tabular">{formatAmountDigits(selectedIncome.paymentAmount)} UZS</span></FactRow>
                <FactRow label="Kelishuv:"><span className="tabular">{formatAmountDigits(selectedIncome.coursePriceAmount)} UZS</span></FactRow>
                <FactRow label="Qolgan qarz:"><span className="tabular">{formatAmountDigits(selectedIncome.remainingDebtAmount)} UZS</span></FactRow>
              </div>
            </div>
          )}

          {mode === 'tariff_change' && (
            <div className="panel-inset grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-1">
              <div>
                <label className="field-label">Yangi kurs</label>
                <select
                  value={newCourseId}
                  onChange={(event) => setNewCourseId(event.target.value)}
                  className="field"
                >
                  <option value="">Tanlang</option>
                  {courseOptions.map((course: any) => (
                    <option key={course.id} value={course.id}>{course.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Yangi tarif</label>
                <select
                  value={newTariffId}
                  onChange={(event) => setNewTariffId(event.target.value)}
                  disabled={!newCourseId}
                  className="field"
                >
                  <option value="">Tanlang</option>
                  {tariffOptions.map((tariff: any) => (
                    <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Yangi kelishuv summasi</label>
                <input
                  value={newAgreementInput}
                  onChange={(event) => setNewAgreementInput(groupDigits(normalizeDigits(event.target.value)))}
                  inputMode="numeric"
                  placeholder="0"
                  className="field tabular"
                />
              </div>
            </div>
          )}

          {mode === 'refund' && (
            <div className="panel-inset">
              <label className="field-label">Karta raqami</label>
              <input
                value={refundCardNumberInput}
                onChange={(event) => setRefundCardNumberInput(formatCardNumberInput(event.target.value))}
                inputMode="numeric"
                maxLength={19}
                placeholder="8600 0000 0000 0000"
                className="field tabular"
              />
              <p className="field-help">
                16 ta raqam kiriting. Bo&apos;sh joylar avtomatik qo&apos;shiladi.
              </p>
            </div>
          )}

          <div>
            <label className="field-label">Izoh</label>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              className="field"
              placeholder="Ixtiyoriy izoh..."
            />
          </div>
        </div>

        <div className="flex justify-end border-t border-gray-100 bg-gray-50 px-5 py-4 sm:px-6">
          <button
            type="submit"
            disabled={createRequestMutation.isLoading || !mode || !selectedCustomerId || !selectedIncomeId}
            className="btn btn-primary w-full sm:w-auto xl:w-full"
          >
            <IconSend className="h-4 w-4" stroke={1.8} />
            {createRequestMutation.isLoading ? "Yuborilmoqda..." : "So'rov yuborish"}
          </button>
        </div>
      </form>
    </section>
  );
}
