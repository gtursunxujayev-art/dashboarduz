'use client';

import type { ReactNode } from 'react';
import {
  IconCalendarEvent,
  IconCreditCard,
  IconDeviceFloppy,
  IconDownload,
  IconFileSpreadsheet,
  IconInfoCircle,
  IconReceipt2,
  IconSchool,
  IconUser,
  IconUserCheck,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { formatAmountDigits } from '@/lib/format';
import { groupDigits, normalizeDigits, sanitizeTelegramUsername } from '@dashboarduz/shared';
import type { FieldErrors, IncomeTypeChoice } from './income-helpers';
import type { IncomePageModel } from './use-income-page';

/** Kit `field` plus a red outline when the field has a validation error. */
function fieldClass(fieldErrors: FieldErrors, field: string, extra = ''): string {
  const invalid = fieldErrors[field] ? 'border-red-400 bg-red-50 ring-2 ring-red-500/20 hover:border-red-400 focus:border-red-500' : '';
  return `field ${invalid} ${extra}`.trim();
}

function Required() {
  return <span className="text-red-500">*</span>;
}

/** One titled block of the form: heading on the left on wide screens, fields on the right. */
function FormSection({ title, icon: SectionIcon, children }: { title: ReactNode; icon: Icon; children: ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-4 px-5 py-5 sm:px-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
      <div className="flex items-center gap-2.5 lg:items-start lg:pt-1">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] bg-gray-100 text-gray-600">
          <SectionIcon className="h-4 w-4" stroke={1.8} />
        </span>
        <h3 className="section-title lg:pt-1">{title}</h3>
      </div>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

export function IncomeEntryForm({ vm }: { vm: IncomePageModel }) {
  const { canUseRepayment, clearFieldError, courseId, coursePriceInput, createIncomeMutation, customerInputWrapperRef, customerName, customerNumber, customerSuggestions, deadline, debtOptionsForCustomer, debtSourceIncomeId, entryDate, error, exportDateFrom, exportDateTo, exportError, exportIncomesMutation, exportSuccess, fieldErrors, formOptionsQuery, groupedCourseOptions, handleDownloadIncomesByCustomRange, handleSubmit, isAdmin, isCustomerSuggestionsOpen, isDebtLookupPending, isExistingCustomer, managerUserId, managers, paymentInput, remainingDebtAmount, selectedCustomer, setCourseId, setCoursePriceInput, setCustomerName, setCustomerNumber, setDeadline, setDebtSourceIncomeId, setEntryDate, setExportDateFrom, setExportDateTo, setIsCustomerSuggestionsOpen, setManagerUserId, setPaymentInput, setSkipTelegramNotification, setSubTariffId, setTariffId, setTelegramUsername, setType, skipTelegramNotification, sourceDebtAmount, subTariffId, subTariffOptions, success, tariffId, tariffOptions, telegramUsername, type } = vm;

  return (
    <div className="space-y-4">
      {error && <p className="alert alert-error">{error}</p>}
      {success && <p className="alert alert-success">{success}</p>}

      <div className={`grid grid-cols-1 items-start gap-6 ${isAdmin ? 'xl:grid-cols-[minmax(0,1fr)_300px]' : ''}`}>
        <form onSubmit={handleSubmit} className="panel overflow-hidden">
          <div className="panel-header pb-4">
            <h2 className="section-title">Tushum kiritish formasi</h2>
          </div>

          <div className="divide-y divide-gray-100 border-t border-gray-100">
            <FormSection title="Sana va menedjer" icon={IconCalendarEvent}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="field-label">Sana <Required /></label>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(event) => {
                      setEntryDate(event.target.value);
                      clearFieldError('entryDate');
                    }}
                    className={fieldClass(fieldErrors, 'entryDate')}
                  />
                  {fieldErrors.entryDate && <p className="field-error">{fieldErrors.entryDate}</p>}
                </div>

                <div>
                  <label className="field-label">Sotuv menedjeri <Required /></label>
                  <select
                    value={managerUserId}
                    onChange={(event) => {
                      setManagerUserId(event.target.value);
                      clearFieldError('managerUserId');
                    }}
                    className={fieldClass(fieldErrors, 'managerUserId')}
                  >
                    <option value="">Menedjerni tanlang</option>
                    {managers.map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.label}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.managerUserId && <p className="field-error">{fieldErrors.managerUserId}</p>}
                </div>
              </div>
            </FormSection>

            <FormSection title="Mijoz" icon={IconUser}>
              <div>
                <label className="field-label">Mijoz raqami <Required /></label>
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
                    className={fieldClass(fieldErrors, 'customerNumber', 'tabular')}
                    placeholder="998901234567"
                    inputMode="numeric"
                    pattern="\d*"
                    autoComplete="off"
                  />
                  {isCustomerSuggestionsOpen && customerSuggestions.length > 0 && (
                    <div className="absolute z-30 mt-1.5 max-h-60 w-full overflow-y-auto rounded-[12px] border border-gray-200 bg-white p-1 shadow-lg">
                      {customerSuggestions.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          className="flex w-full flex-col gap-0.5 rounded-[9px] px-3 py-2 text-left text-sm hover:bg-gray-50"
                          onClick={() => {
                            setCustomerNumber(customer.customerNumber);
                            setIsCustomerSuggestionsOpen(false);
                            clearFieldError('customerNumber');
                          }}
                        >
                          <span className="tabular font-medium text-gray-900">{customer.customerNumber}</span>
                          <span className="text-xs text-gray-500">
                            {customer.name}
                            {customer.telegramUsername ? ` • ${customer.telegramUsername}` : ''}
                            {customer.responsibleManagerLabel ? ` • Mas'ul: ${customer.responsibleManagerLabel}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {fieldErrors.customerNumber && <p className="field-error">{fieldErrors.customerNumber}</p>}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="field-label">Mijoz ismi {!isExistingCustomer && <Required />}</label>
                  <input
                    value={customerName}
                    onChange={(event) => {
                      setCustomerName(event.target.value);
                      clearFieldError('customerName');
                    }}
                    readOnly={isExistingCustomer}
                    className={fieldClass(fieldErrors, 'customerName', 'read-only:text-gray-600')}
                    placeholder="Mijoz ismi"
                    autoComplete="off"
                  />
                  {fieldErrors.customerName && <p className="field-error">{fieldErrors.customerName}</p>}
                </div>

                <div>
                  <label className="field-label">Telegram username</label>
                  <input
                    value={telegramUsername}
                    onChange={(event) => {
                      setTelegramUsername(sanitizeTelegramUsername(event.target.value));
                      clearFieldError('telegramUsername');
                    }}
                    readOnly={isExistingCustomer}
                    className={fieldClass(fieldErrors, 'telegramUsername', 'read-only:text-gray-600')}
                    placeholder="@username"
                    maxLength={160}
                    autoComplete="off"
                  />
                  {fieldErrors.telegramUsername && <p className="field-error">{fieldErrors.telegramUsername}</p>}
                </div>
              </div>

              {selectedCustomer && (
                <div className="panel-inset flex items-center gap-2 px-3.5 py-2.5 text-sm text-gray-700">
                  <IconUserCheck className="h-4 w-4 flex-shrink-0 text-gray-500" stroke={1.8} />
                  <span>
                    Mas&apos;ul agent: <span className="font-medium text-gray-900">{selectedCustomer.responsibleManagerLabel || '-'}</span>
                  </span>
                </div>
              )}
            </FormSection>

            <FormSection title="To'lov" icon={IconCreditCard}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="field-label">To'lov turi <Required /></label>
                  <select
                    value={type}
                    onChange={(event) => {
                      setType(event.target.value as IncomeTypeChoice);
                      clearFieldError('type');
                    }}
                    className={fieldClass(fieldErrors, 'type')}
                  >
                    <option value="">To'lov turini tanlang</option>
                    <option value="new_sale">Yangi sotuv</option>
                    <option value="repayment" disabled={!canUseRepayment}>
                      Qarzdorlik
                    </option>
                  </select>
                  {isDebtLookupPending && (
                    <LoadingBlock className="mt-1.5" compact message="Mijozning qarzlari yuklanmoqda..." />
                  )}
                  {!canUseRepayment && (
                    <p className="field-help">
                      Qarzdorlik to&apos;lovi faqat mavjud qarzdor mijoz uchun ochiladi.
                    </p>
                  )}
                  {fieldErrors.type && <p className="field-error">{fieldErrors.type}</p>}
                </div>

                <div>
                  <label className="field-label">Deadline</label>
                  <input
                    type="date"
                    value={deadline}
                    onChange={(event) => setDeadline(event.target.value)}
                    className={fieldClass(fieldErrors, 'deadline')}
                  />
                </div>
              </div>

              {type !== 'repayment' && type !== 'new_sale' && (
                <div className="flex items-start gap-2.5 rounded-[12px] border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-500">
                  <IconInfoCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" stroke={1.8} />
                  <span>To'lov turi tanlangandan keyin Kurs yoki Qarzdorlik maydonlari chiqadi.</span>
                </div>
              )}
            </FormSection>

            {type === 'repayment' ? (
              <FormSection title="Qarzdorlik" icon={IconReceipt2}>
                <div>
                  <label className="field-label">Current debt <Required /></label>
                  <select
                    value={debtSourceIncomeId}
                    onChange={(event) => {
                      setDebtSourceIncomeId(event.target.value);
                      clearFieldError('debtSourceIncomeId');
                    }}
                    className={fieldClass(fieldErrors, 'debtSourceIncomeId')}
                  >
                    <option value="">Qarzni tanlang</option>
                    {debtOptionsForCustomer.map((debt) => (
                      <option key={debt.id} value={debt.id}>
                        {debt.customerNumber} - {debt.customerName} | {debt.courseName || "Kurs yo'q"} / {debt.tariffName || "Tarif yo'q"} | Qarz: {formatAmountDigits(debt.remainingDebtAmount)}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.debtSourceIncomeId && <p className="field-error">{fieldErrors.debtSourceIncomeId}</p>}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="field-label">Qarz summasi</label>
                    <input
                      value={formatAmountDigits(sourceDebtAmount)}
                      readOnly
                      className={fieldClass(fieldErrors, 'sourceDebtAmount', 'tabular read-only:text-gray-700')}
                    />
                  </div>
                  <div>
                    <label className="field-label">To&apos;lov <Required /></label>
                    <input
                      value={paymentInput}
                      onChange={(event) => {
                        setPaymentInput(groupDigits(normalizeDigits(event.target.value)));
                        clearFieldError('paymentInput');
                      }}
                      inputMode="numeric"
                      className={fieldClass(fieldErrors, 'paymentInput', 'tabular')}
                      placeholder="0"
                    />
                    {fieldErrors.paymentInput && <p className="field-error">{fieldErrors.paymentInput}</p>}
                  </div>
                  <div>
                    <label className="field-label">Qarzdorlik</label>
                    <input
                      value={formatAmountDigits(remainingDebtAmount)}
                      readOnly
                      className={fieldClass(fieldErrors, 'remainingDebtAmount', 'tabular font-medium read-only:text-gray-900')}
                    />
                  </div>
                </div>
              </FormSection>
            ) : type === 'new_sale' ? (
              <FormSection title="Kurs" icon={IconSchool}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="field-label">Kurs <Required /></label>
                    <select
                      value={courseId}
                      onChange={(event) => {
                        setCourseId(event.target.value);
                        clearFieldError('courseId');
                      }}
                      className={fieldClass(fieldErrors, 'courseId')}
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
                    {fieldErrors.courseId && <p className="field-error">{fieldErrors.courseId}</p>}
                  </div>

                  <div>
                    <label className="field-label">Tarif <Required /></label>
                    <select
                      value={tariffId}
                      onChange={(event) => {
                        setTariffId(event.target.value);
                        clearFieldError('tariffId');
                      }}
                      disabled={!courseId}
                      className={fieldClass(fieldErrors, 'tariffId')}
                    >
                      <option value="">Tarifni tanlang</option>
                      {tariffOptions.map((tariff) => (
                        <option key={tariff.id} value={tariff.id}>
                          {tariff.name}
                        </option>
                      ))}
                    </select>
                    {fieldErrors.tariffId && <p className="field-error">{fieldErrors.tariffId}</p>}
                  </div>

                  {subTariffOptions.length > 0 && (
                    <div>
                      <label className="field-label">Subtarif <Required /></label>
                      <select
                        value={subTariffId}
                        onChange={(event) => {
                          setSubTariffId(event.target.value);
                          clearFieldError('subTariffId');
                        }}
                        disabled={!tariffId}
                        className={fieldClass(fieldErrors, 'subTariffId')}
                      >
                        <option value="">Subtarifni tanlang</option>
                        {subTariffOptions.map((subTariff) => (
                          <option key={subTariff.id} value={subTariff.id}>
                            {subTariff.name}
                          </option>
                        ))}
                      </select>
                      {fieldErrors.subTariffId && <p className="field-error">{fieldErrors.subTariffId}</p>}
                    </div>
                  )}
                </div>

                <div className="panel-inset grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div>
                    <label className="field-label">Kurs narxi <Required /></label>
                    <input
                      value={coursePriceInput}
                      onChange={(event) => {
                        setCoursePriceInput(groupDigits(normalizeDigits(event.target.value)));
                        clearFieldError('coursePriceInput');
                      }}
                      inputMode="numeric"
                      className={fieldClass(fieldErrors, 'coursePriceInput', 'tabular')}
                      placeholder="0"
                    />
                    {fieldErrors.coursePriceInput && <p className="field-error">{fieldErrors.coursePriceInput}</p>}
                  </div>
                  <div>
                    <label className="field-label">To&apos;lov</label>
                    <input
                      value={paymentInput}
                      onChange={(event) => {
                        setPaymentInput(groupDigits(normalizeDigits(event.target.value)));
                        clearFieldError('paymentInput');
                      }}
                      inputMode="numeric"
                      className={fieldClass(fieldErrors, 'paymentInput', 'tabular')}
                      placeholder="0"
                    />
                    {fieldErrors.paymentInput && <p className="field-error">{fieldErrors.paymentInput}</p>}
                  </div>
                  <div>
                    <label className="field-label">Qarzdorlik</label>
                    <input
                      value={formatAmountDigits(remainingDebtAmount)}
                      readOnly
                      className={fieldClass(fieldErrors, 'remainingDebtAmount', 'tabular font-medium read-only:text-gray-900')}
                    />
                  </div>
                </div>
              </FormSection>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-gray-100 bg-gray-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            {isAdmin ? (
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={skipTelegramNotification}
                  onChange={(event) => setSkipTelegramNotification(event.target.checked)}
                  className="checkbox"
                />
                Income qo&apos;shilganda Telegramga yubormaslik
              </label>
            ) : (
              <span className="hidden sm:block" />
            )}
            <button
              type="submit"
              disabled={createIncomeMutation.isLoading || formOptionsQuery.isLoading}
              className="btn btn-primary sm:min-w-[180px]"
            >
              <IconDeviceFloppy className="h-4 w-4" stroke={1.8} />
              {createIncomeMutation.isLoading ? 'Saqlanmoqda...' : 'Tushumni saqlash'}
            </button>
          </div>
        </form>

        {isAdmin && (
          <aside className="panel">
            <div className="panel-header">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-blue-50 text-blue-600">
                  <IconFileSpreadsheet className="h-4 w-4" stroke={1.8} />
                </span>
                <h2 className="section-title">Eksport</h2>
              </div>
            </div>
            <div className="panel-body space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div>
                  <label className="field-label">Boshlanish</label>
                  <input
                    type="date"
                    value={exportDateFrom}
                    onChange={(event) => setExportDateFrom(event.target.value)}
                    className="field"
                  />
                </div>
                <div>
                  <label className="field-label">Tugash</label>
                  <input
                    type="date"
                    value={exportDateTo}
                    onChange={(event) => setExportDateTo(event.target.value)}
                    className="field"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleDownloadIncomesByCustomRange}
                disabled={exportIncomesMutation.isLoading}
                className="btn btn-secondary w-full"
              >
                <IconDownload className="h-4 w-4" stroke={1.8} />
                {exportIncomesMutation.isLoading ? 'Yuklanmoqda...' : "Davr bo'yicha yuklab olish"}
              </button>
              {exportError && <p className="field-error">{exportError}</p>}
              {exportSuccess && <p className="mt-1.5 text-xs text-emerald-600">{exportSuccess}</p>}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
