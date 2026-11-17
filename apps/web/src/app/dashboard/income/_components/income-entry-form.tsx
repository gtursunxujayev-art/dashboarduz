'use client';

import type { ReactNode } from 'react';
import {
  IconCalendarEvent,
  IconCheck,
  IconCreditCard,
  IconDeviceFloppy,
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
import { IncomeEntryAside } from './income-entry-aside';
import type { IncomePageModel } from './use-income-page';

/** Kit `field` plus a red outline when the field has a validation error. */
function fieldClass(fieldErrors: FieldErrors, field: string, extra = ''): string {
  const invalid = fieldErrors[field] ? 'border-red-400 bg-red-50 ring-2 ring-red-500/20 hover:border-red-400 focus:border-red-500' : '';
  return `field ${invalid} ${extra}`.trim();
}

function Required() {
  return <span className="text-red-500">*</span>;
}

function hasError(fieldErrors: FieldErrors, fields: string[]): boolean {
  return fields.some((field) => Boolean(fieldErrors[field]));
}

/**
 * One step of the guided entry: a numbered marker on a thin vertical line, the step title,
 * then its fields. The marker turns into a check once the step's required fields are filled.
 */
function FormStep({
  index,
  title,
  icon: StepIcon,
  done,
  invalid,
  last = false,
  children,
}: {
  index: number;
  title: ReactNode;
  icon: Icon;
  done: boolean;
  invalid: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  const markerTone = invalid
    ? 'bg-red-50 text-red-600 ring-1 ring-inset ring-red-200'
    : done
      ? 'bg-blue-600 text-white shadow-[0_4px_10px_-4px_rgb(34_72_226/0.6)]'
      : 'bg-white text-gray-600 ring-1 ring-inset ring-gray-200';

  return (
    <section className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-4 sm:gap-x-5">
      {!last && (
        <span
          aria-hidden="true"
          className={`absolute bottom-1 left-[15.5px] top-10 w-px ${done ? 'bg-blue-600/40' : 'bg-gray-200'}`}
        />
      )}
      <span className={`tabular relative flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-semibold transition-colors ${markerTone}`}>
        {done && !invalid ? <IconCheck className="h-4 w-4" stroke={2} /> : index}
      </span>
      <div className={`min-w-0 space-y-4 ${last ? '' : 'pb-8'}`}>
        <div className="flex min-h-8 items-center gap-2">
          <h3 className="section-title">{title}</h3>
          <StepIcon className="h-4 w-4 text-gray-400" stroke={1.8} />
        </div>
        {children}
      </div>
    </section>
  );
}

export function IncomeEntryForm({ vm }: { vm: IncomePageModel }) {
  const { canUseRepayment, clearFieldError, courseId, coursePriceInput, createIncomeMutation, customerInputWrapperRef, customerName, customerNumber, customerSuggestions, deadline, debtOptionsForCustomer, debtSourceIncomeId, entryDate, error, fieldErrors, formOptionsQuery, groupedCourseOptions, handleSubmit, isAdmin, isCustomerSuggestionsOpen, isDebtLookupPending, isExistingCustomer, managerUserId, managers, paymentInput, remainingDebtAmount, selectedCustomer, setCourseId, setCoursePriceInput, setCustomerName, setCustomerNumber, setDeadline, setDebtSourceIncomeId, setEntryDate, setIsCustomerSuggestionsOpen, setManagerUserId, setPaymentInput, setSkipTelegramNotification, setSubTariffId, setTariffId, setTelegramUsername, setType, skipTelegramNotification, sourceDebtAmount, subTariffId, subTariffOptions, success, tariffId, tariffOptions, telegramUsername, type } = vm;

  // UI-only progress markers for the step rail; validation itself stays in the page model.
  const hasDetailsStep = type === 'repayment' || type === 'new_sale';
  const stepDone = {
    dateAndManager: Boolean(entryDate && managerUserId),
    customer: Boolean(customerNumber && (customerName || isExistingCustomer)),
    payment: Boolean(type),
    details: type === 'repayment'
      ? Boolean(debtSourceIncomeId && paymentInput)
      : Boolean(courseId && tariffId && (subTariffOptions.length === 0 || subTariffId) && coursePriceInput),
  };

  return (
    <div className="space-y-4">
      {error && <p className="alert alert-error">{error}</p>}
      {success && <p className="alert alert-success">{success}</p>}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <form onSubmit={handleSubmit} className="panel overflow-hidden">
          <div className="panel-header pb-5">
            <h2 className="section-title">Tushum kiritish formasi</h2>
          </div>

          <div className="border-t border-gray-100 px-5 py-6 sm:px-6 sm:py-7">
            <FormStep
              index={1}
              title="Sana va menedjer"
              icon={IconCalendarEvent}
              done={stepDone.dateAndManager}
              invalid={hasError(fieldErrors, ['entryDate', 'managerUserId'])}
            >
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
            </FormStep>

            <FormStep
              index={2}
              title="Mijoz"
              icon={IconUser}
              done={stepDone.customer}
              invalid={hasError(fieldErrors, ['customerNumber', 'customerName', 'telegramUsername'])}
            >
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
                    <div className="absolute z-30 mt-1.5 max-h-60 w-full overflow-y-auto rounded-[16px] border border-gray-200 bg-white p-1 shadow-lg">
                      {customerSuggestions.map((customer) => (
                        <button
                          key={customer.id}
                          type="button"
                          className="flex w-full flex-col gap-0.5 rounded-[12px] px-3 py-2 text-left text-sm hover:bg-gray-50"
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
                <div className="panel-inset flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-700">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <IconUserCheck className="h-4 w-4" stroke={1.8} />
                  </span>
                  <span>
                    Mas&apos;ul agent: <span className="font-medium text-gray-900">{selectedCustomer.responsibleManagerLabel || '-'}</span>
                  </span>
                </div>
              )}
            </FormStep>

            <FormStep
              index={3}
              title="To'lov"
              icon={IconCreditCard}
              done={stepDone.payment}
              invalid={hasError(fieldErrors, ['type'])}
              last={!hasDetailsStep}
            >
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

              {!hasDetailsStep && (
                <div className="flex items-start gap-2.5 rounded-[16px] border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-500">
                  <IconInfoCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" stroke={1.8} />
                  <span>To'lov turi tanlangandan keyin Kurs yoki Qarzdorlik maydonlari chiqadi.</span>
                </div>
              )}
            </FormStep>

            {type === 'repayment' ? (
              <FormStep
                index={4}
                title="Qarzdorlik"
                icon={IconReceipt2}
                done={stepDone.details}
                invalid={hasError(fieldErrors, ['debtSourceIncomeId', 'paymentInput'])}
                last
              >
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

                <div className="panel-inset grid grid-cols-1 gap-4 md:grid-cols-3">
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
              </FormStep>
            ) : type === 'new_sale' ? (
              <FormStep
                index={4}
                title="Kurs"
                icon={IconSchool}
                done={stepDone.details}
                invalid={hasError(fieldErrors, ['courseId', 'tariffId', 'subTariffId', 'coursePriceInput', 'paymentInput'])}
                last
              >
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
              </FormStep>
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

        <IncomeEntryAside vm={vm} />
      </div>
    </div>
  );
}
