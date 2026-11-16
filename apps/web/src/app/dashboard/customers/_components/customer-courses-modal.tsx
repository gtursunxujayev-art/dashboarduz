'use client';

import { formatNumberEn, formatTashkentDate } from '@/lib/format';
import type { CustomersPageModel } from './use-customers-page';

export function CustomerCoursesModal({ vm }: { vm: CustomersPageModel }) {
  const { closeCourseEditorModal, courseEditCourseId, courseEditSubTariffId, courseEditTariffId, courseEditorCustomer, deletingCourseSaleId, editMode, editSubTariffOptions, editTariffOptions, editingSaleIncomeId, editorCourses, handleDeleteCustomerCourse, handleSaveCourseChange, isAdmin, isCourseEditorModalOpen, setCourseEditCourseId, setCourseEditSubTariffId, setCourseEditTariffId, setEditingSaleIncomeId, startCourseChange, updateCustomerCourseSaleMutation } = vm;

  return (
    <>
      {isAdmin && editMode && isCourseEditorModalOpen && courseEditorCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl dark:bg-slate-900">
            <div className="border-b border-gray-100 px-6 py-4 dark:border-slate-700">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Mijoz kurslarini tahrirlash</h2>
                  <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                    {courseEditorCustomer.customerNumber} - {courseEditorCustomer.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCourseEditorModal}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Yopish
                </button>
              </div>
            </div>

            <div className="max-h-[75vh] space-y-4 overflow-auto px-6 py-5">
              {Array.isArray(courseEditorCustomer.courseEntries) && courseEditorCustomer.courseEntries.length ? (
                courseEditorCustomer.courseEntries.map((entry: any) => (
                  <div
                    key={entry.saleIncomeId}
                    className="rounded-md border border-gray-200 bg-gray-50 p-4 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{entry.label}</p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                          Sana: {formatTashkentDate(entry.entryDate)} | Joriy qarz: {formatNumberEn(entry.remainingDebtAmount || 0)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => startCourseChange(entry)}
                          className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/50"
                        >
                          Kursni o&apos;zgartirish
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomerCourse(entry, courseEditorCustomer.courseEntries || [])}
                          disabled={deletingCourseSaleId === entry.saleIncomeId}
                          className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50"
                        >
                          {deletingCourseSaleId === entry.saleIncomeId ? "O'chirilmoqda..." : "Kursni o'chirish"}
                        </button>
                      </div>
                    </div>

                    {editingSaleIncomeId === entry.saleIncomeId && (
                      <div className="mt-4 space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <div>
                            <label className="block text-xs font-medium uppercase text-gray-600 dark:text-slate-300">Yangi kurs</label>
                            <select
                              value={courseEditCourseId}
                              onChange={(event) => setCourseEditCourseId(event.target.value)}
                              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                            >
                              <option value="">Kurs tanlang</option>
                              {editorCourses.map((course: any) => (
                                <option key={course.id} value={course.id}>
                                  {course.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-medium uppercase text-gray-600 dark:text-slate-300">Yangi tarif</label>
                            <select
                              value={courseEditTariffId}
                              onChange={(event) => setCourseEditTariffId(event.target.value)}
                              disabled={!courseEditCourseId}
                              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                            >
                              <option value="">Tarif tanlanmagan</option>
                              {editTariffOptions.map((tariff: any) => (
                                <option key={tariff.id} value={tariff.id}>
                                  {tariff.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-medium uppercase text-gray-600 dark:text-slate-300">Yangi subtarif</label>
                            <select
                              value={courseEditSubTariffId}
                              onChange={(event) => setCourseEditSubTariffId(event.target.value)}
                              disabled={!courseEditTariffId || !editSubTariffOptions.length}
                              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                            >
                              <option value="">Subtarif tanlanmagan</option>
                              {editSubTariffOptions.map((subTariff: any) => (
                                <option key={subTariff.id} value={subTariff.id}>
                                  {subTariff.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={handleSaveCourseChange}
                            disabled={updateCustomerCourseSaleMutation.isLoading}
                            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {updateCustomerCourseSaleMutation.isLoading ? 'Saqlanmoqda...' : "O'zgarishni saqlash"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSaleIncomeId('');
                              setCourseEditCourseId('');
                              setCourseEditTariffId('');
                              setCourseEditSubTariffId('');
                            }}
                            className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            Bekor qilish
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-gray-500 dark:text-slate-400">Bu mijozda aktiv kurs topilmadi.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
