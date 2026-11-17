'use client';

import type { ReactNode } from 'react';
import { IconCalendarEvent, IconCreditCard, IconDeviceFloppy, IconSchool, IconX } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { formatAmountDigits } from '@/lib/format';
import { groupDigits, normalizeDigits } from '@dashboarduz/shared';
import { getSubTariffOptionValue, normalizeTextToken, resolveCanonicalSubTariffId } from './income-helpers';
import type { IncomePageModel } from './use-income-page';

/** A titled group of fields inside the edit sheet. */
function SheetSection({ title, icon: SectionIcon, children }: { title: ReactNode; icon: Icon; children: ReactNode }) {
  return (
    <section className="space-y-4 border-t border-gray-100 pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-100 text-gray-600">
          <SectionIcon className="h-4 w-4" stroke={1.8} />
        </span>
        <p className="caption">{title}</p>
      </div>
      {children}
    </section>
  );
}

export function EditIncomeModal({ vm }: { vm: IncomePageModel }) {
  const { closeEditIncome, editDebtAfterFirstPayment, editError, editForm, editSubTariffOptions, editTariffOptions, groupedCourseOptions, handleSaveIncomeEdit, isAdmin, managers, setEditForm, updateIncomeMutation } = vm;

  return (
    <>
      {isAdmin && editForm && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-[600px]">
            <div className="modal-header flex items-center justify-between gap-4">
              <h3 className="modal-title">Tushumni tahrirlash</h3>
              <button
                type="button"
                onClick={closeEditIncome}
                className="btn btn-ghost btn-sm"
              >
                <IconX className="h-4 w-4" stroke={1.8} />
                Yopish
              </button>
            </div>

            <div className="modal-body space-y-5">
              {editError && (
                <p className="alert alert-error">
                  {editError}
                </p>
              )}

              <SheetSection title="Sana va menedjer" icon={IconCalendarEvent}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="field-label">Sana</label>
                    <input
                      type="date"
                      value={editForm.entryDate}
                      onChange={(event) => setEditForm((prev) => (prev ? { ...prev, entryDate: event.target.value } : prev))}
                      className="field"
                    />
                  </div>
                  <div>
                    <label className="field-label">Sotuv menedjeri</label>
                    <select
                      value={editForm.managerUserId}
                      onChange={(event) => setEditForm((prev) => (prev ? { ...prev, managerUserId: event.target.value } : prev))}
                      className="field"
                    >
                      <option value="">Menedjerni tanlang</option>
                      {managers.map((manager) => (
                        <option key={manager.id} value={manager.id}>
                          {manager.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </SheetSection>

              {editForm.type === 'new_sale' && (
                <SheetSection title="Kurs" icon={IconSchool}>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="field-label">Kurs</label>
                      <select
                        value={editForm.courseId}
                        onChange={(event) =>
                          setEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  courseId: event.target.value,
                                }
                              : prev,
                          )
                        }
                        className="field"
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
                    </div>
                    <div>
                      <label className="field-label">Tarif</label>
                      <select
                        value={editForm.tariffId}
                        onChange={(event) =>
                          setEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  tariffId: event.target.value,
                                }
                              : prev,
                          )
                        }
                        className="field"
                      >
                        <option value="">Tarifni tanlang</option>
                        {editTariffOptions.map((tariff) => (
                          <option key={tariff.id} value={tariff.id}>
                            {tariff.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {editSubTariffOptions.length > 0 && (
                      <div>
                        <label className="field-label">Subtarif</label>
                        <select
                          value={editForm.subTariffId}
                          onChange={(event) =>
                            setEditForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    subTariffId: resolveCanonicalSubTariffId(event.target.value, editSubTariffOptions),
                                  }
                                : prev,
                            )
                          }
                          className="field"
                        >
                          <option value="">Subtarifni tanlang</option>
                          {editSubTariffOptions.map((subTariff) => (
                            <option
                              key={`${normalizeTextToken(subTariff.id) || normalizeTextToken(subTariff.name)}`}
                              value={getSubTariffOptionValue(subTariff)}
                            >
                              {subTariff.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="panel-inset grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="field-label">Kurs narxi</label>
                      <input
                        value={editForm.coursePriceInput}
                        onChange={(event) =>
                          setEditForm((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  coursePriceInput: groupDigits(normalizeDigits(event.target.value)),
                                }
                              : prev,
                          )
                        }
                        inputMode="numeric"
                        className="field tabular"
                      />
                    </div>
                    <div>
                      <label className="field-label">Deadline</label>
                      <input
                        type="date"
                        value={editForm.deadline}
                        onChange={(event) => setEditForm((prev) => (prev ? { ...prev, deadline: event.target.value } : prev))}
                        className="field"
                      />
                    </div>
                  </div>
                </SheetSection>
              )}

              <SheetSection title="To'lov" icon={IconCreditCard}>
                {editForm.type === 'repayment' && (
                  <div>
                    <label className="field-label">Deadline</label>
                    <input
                      type="date"
                      value={editForm.deadline}
                      onChange={(event) => setEditForm((prev) => (prev ? { ...prev, deadline: event.target.value } : prev))}
                      className="field"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className={editForm.type === 'new_sale' ? '' : 'sm:col-span-2'}>
                    <label className="field-label">To'lov</label>
                    <input
                      value={editForm.paymentInput}
                      onChange={(event) =>
                        setEditForm((prev) =>
                          prev
                            ? {
                                ...prev,
                                paymentInput: groupDigits(normalizeDigits(event.target.value)),
                              }
                            : prev,
                        )
                      }
                      inputMode="numeric"
                      className="field tabular"
                    />
                  </div>

                  {editForm.type === 'new_sale' && (
                    <div>
                      <label className="field-label">
                        Birinchi to'lovdan keyingi qarz
                      </label>
                      <input
                        value={formatAmountDigits(editDebtAfterFirstPayment)}
                        readOnly
                        className="field tabular font-medium"
                      />
                    </div>
                  )}
                </div>
              </SheetSection>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                onClick={closeEditIncome}
                className="btn btn-secondary"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleSaveIncomeEdit}
                disabled={updateIncomeMutation.isLoading}
                className="btn btn-primary sm:min-w-[140px]"
              >
                <IconDeviceFloppy className="h-4 w-4" stroke={1.8} />
                {updateIncomeMutation.isLoading ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
