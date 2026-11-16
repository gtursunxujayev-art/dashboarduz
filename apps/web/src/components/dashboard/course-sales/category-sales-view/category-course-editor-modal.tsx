'use client';

import { formatSom, formatTashkentDate } from '@/lib/format';
import type { CategorySalesViewModel } from './use-category-sales-view';

export function CategoryCourseEditorModal({ vm }: { vm: CategorySalesViewModel }) {
  const { closeCourseEditorModal, courseEditCourseId, courseEditSubTariffId, courseEditTariffId, courseEditorCustomer, deletingCourseSaleId, editSubTariffOptions, editTariffOptions, editingSaleIncomeId, editorCourses, handleDeleteCustomerCourse, handleSaveCourseChange, isAdmin, isCourseEditorModalOpen, setCourseEditCourseId, setCourseEditSubTariffId, setCourseEditTariffId, setEditingSaleIncomeId, startCourseChange, updateCustomerCourseSaleMutation } = vm;

  return (
    <>
      {isAdmin && isCourseEditorModalOpen && courseEditorCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl rounded-lg bg-white shadow-xl">
            <div className="border-b border-gray-100 px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Mijoz kurslarini tahrirlash</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {courseEditorCustomer.customerNumber} - {courseEditorCustomer.customerName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCourseEditorModal}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Yopish
                </button>
              </div>
            </div>

            <div className="max-h-[75vh] space-y-4 overflow-auto px-6 py-5">
              {(Array.isArray(courseEditorCustomer.customerCourses) && courseEditorCustomer.customerCourses.length
                ? courseEditorCustomer.customerCourses
                : [{
                    saleIncomeId: courseEditorCustomer.saleId,
                    label: [courseEditorCustomer.courseName, courseEditorCustomer.tariffName, courseEditorCustomer.subTariffName]
                      .filter(Boolean)
                      .join(' / ') || '-',
                    entryDate: courseEditorCustomer.entryDate,
                    remainingDebtAmount: courseEditorCustomer.debtAmount || 0,
                  }]).map((entry: any) => (
                <div key={entry.saleIncomeId} className="rounded-md border border-gray-200 bg-gray-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{entry.label}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Sana: {formatTashkentDate(entry.entryDate)} | Joriy qarz: {formatSom(entry.remainingDebtAmount || 0)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startCourseChange(entry)}
                        className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                      >
                        Kursni o&apos;zgartirish
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomerCourse(entry, courseEditorCustomer.customerCourses || [])}
                        disabled={deletingCourseSaleId === entry.saleIncomeId}
                        className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {deletingCourseSaleId === entry.saleIncomeId ? "O'chirilmoqda..." : "Kursni o'chirish"}
                      </button>
                    </div>
                  </div>

                  {editingSaleIncomeId === entry.saleIncomeId && (
                    <div className="mt-4 space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div>
                          <label className="block text-xs font-medium uppercase text-gray-600">Yangi kurs</label>
                          <select
                            value={courseEditCourseId}
                            onChange={(event) => setCourseEditCourseId(event.target.value)}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
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
                          <label className="block text-xs font-medium uppercase text-gray-600">Yangi tarif</label>
                          <select
                            value={courseEditTariffId}
                            onChange={(event) => setCourseEditTariffId(event.target.value)}
                            disabled={!courseEditCourseId}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
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
                          <label className="block text-xs font-medium uppercase text-gray-600">Yangi subtarif</label>
                          <select
                            value={courseEditSubTariffId}
                            onChange={(event) => setCourseEditSubTariffId(event.target.value)}
                            disabled={!courseEditTariffId || !editSubTariffOptions.length}
                            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
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
                          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Bekor qilish
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
