'use client';

import { formatAmountDigits } from '@/lib/format';
import { groupDigits, normalizeDigits } from '@dashboarduz/shared';
import { getSubTariffOptionValue, normalizeTextToken, resolveCanonicalSubTariffId } from './income-helpers';
import type { IncomePageModel } from './use-income-page';

export function EditIncomeModal({ vm }: { vm: IncomePageModel }) {
  const { closeEditIncome, editDebtAfterFirstPayment, editError, editForm, editSubTariffOptions, editTariffOptions, groupedCourseOptions, handleSaveIncomeEdit, isAdmin, managers, setEditForm, updateIncomeMutation } = vm;

  return (
    <>
      {isAdmin && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-slate-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Tushumni tahrirlash</h3>
              <button
                type="button"
                onClick={closeEditIncome}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Yopish
              </button>
            </div>

            <div className="space-y-4 p-5">
              {editError && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                  {editError}
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Sana</label>
                  <input
                    type="date"
                    value={editForm.entryDate}
                    onChange={(event) => setEditForm((prev) => (prev ? { ...prev, entryDate: event.target.value } : prev))}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Sotuv menedjeri</label>
                  <select
                    value={editForm.managerUserId}
                    onChange={(event) => setEditForm((prev) => (prev ? { ...prev, managerUserId: event.target.value } : prev))}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
                <div className="space-y-4 rounded-md border border-blue-100 bg-blue-50/30 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Kurs</label>
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
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Tarif</label>
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
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Subtarif</label>
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
                          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Kurs narxi</label>
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
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Deadline</label>
                      <input
                        type="date"
                        value={editForm.deadline}
                        onChange={(event) => setEditForm((prev) => (prev ? { ...prev, deadline: event.target.value } : prev))}
                        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  </div>
                </div>
              )}

              {editForm.type === 'repayment' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Deadline</label>
                  <input
                    type="date"
                    value={editForm.deadline}
                    onChange={(event) => setEditForm((prev) => (prev ? { ...prev, deadline: event.target.value } : prev))}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">To'lov</label>
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
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              {editForm.type === 'new_sale' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">
                    Birinchi to'lovdan keyingi qarz
                  </label>
                  <input
                    value={formatAmountDigits(editDebtAfterFirstPayment)}
                    readOnly
                    className="mt-1 w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-gray-700 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-5 py-4 dark:border-slate-700">
              <button
                type="button"
                onClick={closeEditIncome}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Bekor qilish
              </button>
              <button
                type="button"
                onClick={handleSaveIncomeEdit}
                disabled={updateIncomeMutation.isLoading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {updateIncomeMutation.isLoading ? 'Saqlanmoqda...' : 'Saqlash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
