'use client';

import { IconDeviceFloppy, IconX } from '@tabler/icons-react';
import { formatAmountDigits } from '@/lib/format';
import { groupDigits, normalizeDigits } from '@dashboarduz/shared';
import { getSubTariffOptionValue, normalizeTextToken, resolveCanonicalSubTariffId } from './income-helpers';
import type { IncomePageModel } from './use-income-page';

export function EditIncomeModal({ vm }: { vm: IncomePageModel }) {
  const { closeEditIncome, editDebtAfterFirstPayment, editError, editForm, editSubTariffOptions, editTariffOptions, groupedCourseOptions, handleSaveIncomeEdit, isAdmin, managers, setEditForm, updateIncomeMutation } = vm;

  return (
    <>
      {isAdmin && editForm && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-2xl">
            <div className="modal-header flex items-start justify-between gap-4">
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

            <div className="modal-body">
              {editError && (
                <p className="alert alert-error">
                  {editError}
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

              {editForm.type === 'new_sale' && (
                <div className="panel-inset space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                  </div>

                  {editSubTariffOptions.length > 0 && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                </div>
              )}

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

              <div>
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
                className="btn btn-primary"
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
