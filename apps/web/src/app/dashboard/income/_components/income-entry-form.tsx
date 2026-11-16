'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { formatAmountDigits } from '@/lib/format';
import { groupDigits, normalizeDigits, sanitizeTelegramUsername } from '@dashboarduz/shared';
import { buildFieldClass, type IncomeTypeChoice } from './income-helpers';
import type { IncomePageModel } from './use-income-page';

export function IncomeEntryForm({ vm }: { vm: IncomePageModel }) {
  const { canUseRepayment, clearFieldError, courseId, coursePriceInput, createIncomeMutation, customerInputWrapperRef, customerName, customerNumber, customerSuggestions, deadline, debtOptionsForCustomer, debtSourceIncomeId, entryDate, error, exportDateFrom, exportDateTo, exportError, exportIncomesMutation, exportSuccess, fieldErrors, formOptionsQuery, groupedCourseOptions, handleDownloadIncomesByCustomRange, handleSubmit, isAdmin, isCustomerSuggestionsOpen, isDebtLookupPending, isExistingCustomer, managerUserId, managers, paymentInput, remainingDebtAmount, selectedCustomer, setCourseId, setCoursePriceInput, setCustomerName, setCustomerNumber, setDeadline, setDebtSourceIncomeId, setEntryDate, setExportDateFrom, setExportDateTo, setIsCustomerSuggestionsOpen, setManagerUserId, setPaymentInput, setSkipTelegramNotification, setSubTariffId, setTariffId, setTelegramUsername, setType, skipTelegramNotification, sourceDebtAmount, subTariffId, subTariffOptions, success, tariffId, tariffOptions, telegramUsername, type } = vm;

  return (
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
                  {managers.map((manager) => (
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
                      setCustomerNumber(normalizeDigits(event.target.value));
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
                    {debtOptionsForCustomer.map((debt) => (
                      <option key={debt.id} value={debt.id}>
                        {debt.customerNumber} - {debt.customerName} | {debt.courseName || "Kurs yo'q"} / {debt.tariffName || "Tarif yo'q"} | Qarz: {formatAmountDigits(debt.remainingDebtAmount)}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.debtSourceIncomeId && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.debtSourceIncomeId}</p>}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Qarz summasi</label>
                    <input
                      value={formatAmountDigits(sourceDebtAmount)}
                      readOnly
                      className={buildFieldClass(fieldErrors, 'sourceDebtAmount', 'read-only:bg-gray-100 read-only:text-gray-700 dark:read-only:bg-slate-700 dark:read-only:text-slate-300')}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">To&apos;lov <span className="text-red-500">*</span></label>
                    <input
                      value={paymentInput}
                      onChange={(event) => {
                        setPaymentInput(groupDigits(normalizeDigits(event.target.value)));
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
                      value={formatAmountDigits(remainingDebtAmount)}
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
                            {group.courses.map((course) => (
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
                      {tariffOptions.map((tariff) => (
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
                        {subTariffOptions.map((subTariff) => (
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
                        setCoursePriceInput(groupDigits(normalizeDigits(event.target.value)));
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
                        setPaymentInput(groupDigits(normalizeDigits(event.target.value)));
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
                      value={formatAmountDigits(remainingDebtAmount)}
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
  );
}
