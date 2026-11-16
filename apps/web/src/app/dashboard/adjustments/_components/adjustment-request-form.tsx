'use client';

import { getIncomeStatusBadge } from '@/components/dashboard/income-status-badge';
import { formatAmountDigits } from '@/lib/format';
import { groupDigits, normalizeDigits } from '@dashboarduz/shared';
import { type AdjustmentMode, formatCardNumberInput } from './adjustments-helpers';
import type { AdjustmentsPageModel } from './use-adjustments-page';

export function AdjustmentRequestForm({ vm }: { vm: AdjustmentsPageModel }) {
  const { courseOptions, createRequestMutation, customerNumberInput, customerOptions, error, handleCreateRequest, incomeOptions, mode, newAgreementInput, newCourseId, newTariffId, reason, refundCardNumberInput, selectedCustomer, selectedCustomerId, selectedIncome, selectedIncomeId, setCustomerNumberInput, setMode, setNewAgreementInput, setNewCourseId, setNewTariffId, setReason, setRefundCardNumberInput, setSelectedIncomeId, success, tariffOptions } = vm;

  return (
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
                    {new Date(income.entryDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })} | {income.type === 'repayment' ? 'Qarzdorlik' : 'Yangi sotuv'} | {formatAmountDigits(income.paymentAmount)} UZS
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedIncome && (
            <div className="space-y-3 rounded-md border border-gray-200 p-3 dark:border-slate-700">
              <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${getIncomeStatusBadge(selectedIncome.lifecycleStatus, { darkMode: true }).className}`}>
                {getIncomeStatusBadge(selectedIncome.lifecycleStatus, { darkMode: true }).label}
              </span>
              <div className="grid grid-cols-1 gap-3 text-sm text-gray-700 md:grid-cols-2 dark:text-slate-200">
                <p><span className="font-medium">Kurs/Tarif:</span> {[selectedIncome.course?.name, selectedIncome.tariff?.name].filter(Boolean).join(' / ') || '-'}</p>
                <p><span className="font-medium">To&apos;lov:</span> {formatAmountDigits(selectedIncome.paymentAmount)} UZS</p>
                <p><span className="font-medium">Kelishuv:</span> {formatAmountDigits(selectedIncome.coursePriceAmount)} UZS</p>
                <p><span className="font-medium">Qolgan qarz:</span> {formatAmountDigits(selectedIncome.remainingDebtAmount)} UZS</p>
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
                  onChange={(event) => setNewAgreementInput(groupDigits(normalizeDigits(event.target.value)))}
                  inputMode="numeric"
                  placeholder="0"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
          )}

          {mode === 'refund' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Karta raqami</label>
              <input
                value={refundCardNumberInput}
                onChange={(event) => setRefundCardNumberInput(formatCardNumberInput(event.target.value))}
                inputMode="numeric"
                maxLength={19}
                placeholder="8600 0000 0000 0000"
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                16 ta raqam kiriting. Bo&apos;sh joylar avtomatik qo&apos;shiladi.
              </p>
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
  );
}
