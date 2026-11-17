'use client';

import { IconCalendar, IconPencil, IconTrash, IconX } from '@tabler/icons-react';
import { formatSom, formatTashkentDate } from '@/lib/format';
import type { CourseDetailPageModel } from './use-course-detail-page';

export function DetailCourseEditorModal({ vm }: { vm: CourseDetailPageModel }) {
  const { closeCourseEditorModal, courseEditCourseId, courseEditSubTariffId, courseEditTariffId, courseEditorCustomer, deletingCourseSaleId, editSubTariffOptions, editTariffOptions, editingSaleIncomeId, editorCourses, handleDeleteCustomerCourse, handleSaveCourseChange, isAdmin, isCourseEditorModalOpen, setCourseEditCourseId, setCourseEditSubTariffId, setCourseEditTariffId, setEditingSaleIncomeId, startCourseChange, updateCustomerCourseSaleMutation } = vm;

  return (
    <>
      {isAdmin && isCourseEditorModalOpen && courseEditorCustomer && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-4xl">
            <div className="modal-header">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="modal-title">Mijoz kurslarini tahrirlash</h2>
                  <p className="modal-description tabular">
                    {courseEditorCustomer.customerNumber} - {courseEditorCustomer.customerName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCourseEditorModal}
                  className="btn btn-ghost btn-sm"
                >
                  <IconX className="h-4 w-4" stroke={1.8} />
                  Yopish
                </button>
              </div>
            </div>

            <div className="modal-body max-h-[75vh] overflow-auto">
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
                <div
                  key={entry.saleIncomeId}
                  className={`rounded-[12px] p-4 ring-1 transition ${
                    editingSaleIncomeId === entry.saleIncomeId ? 'bg-white ring-blue-300' : 'bg-gray-50 ring-transparent'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{entry.label}</p>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
                        <IconCalendar className="h-3.5 w-3.5" stroke={1.8} />
                        <span className="tabular">
                          Sana: {formatTashkentDate(entry.entryDate)} | Joriy qarz: {formatSom(entry.remainingDebtAmount || 0)}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startCourseChange(entry)}
                        className="btn btn-soft btn-sm"
                      >
                        <IconPencil className="h-3.5 w-3.5" stroke={1.8} />
                        Kursni o&apos;zgartirish
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomerCourse(entry, courseEditorCustomer.customerCourses || [])}
                        disabled={deletingCourseSaleId === entry.saleIncomeId}
                        className="btn btn-danger-soft btn-sm"
                      >
                        <IconTrash className="h-3.5 w-3.5" stroke={1.8} />
                        {deletingCourseSaleId === entry.saleIncomeId ? "O'chirilmoqda..." : "Kursni o'chirish"}
                      </button>
                    </div>
                  </div>

                  {editingSaleIncomeId === entry.saleIncomeId && (
                    <div className="mt-4 animate-rise-in space-y-4 border-t border-gray-100 pt-4">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div>
                          <label className="field-label">Yangi kurs</label>
                          <select
                            value={courseEditCourseId}
                            onChange={(event) => setCourseEditCourseId(event.target.value)}
                            className="field"
                          >
                            <option value="">Kurs tanlang</option>
                            {editorCourses.map((courseOption: any) => (
                              <option key={courseOption.id} value={courseOption.id}>
                                {courseOption.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="field-label">Yangi tarif</label>
                          <select
                            value={courseEditTariffId}
                            onChange={(event) => setCourseEditTariffId(event.target.value)}
                            disabled={!courseEditCourseId}
                            className="field"
                          >
                            <option value="">Tarif tanlanmagan</option>
                            {editTariffOptions.map((tariffOption: any) => (
                              <option key={tariffOption.id} value={tariffOption.id}>
                                {tariffOption.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="field-label">Yangi subtarif</label>
                          <select
                            value={courseEditSubTariffId}
                            onChange={(event) => setCourseEditSubTariffId(event.target.value)}
                            disabled={!courseEditTariffId || !editSubTariffOptions.length}
                            className="field"
                          >
                            <option value="">Subtarif tanlanmagan</option>
                            {editSubTariffOptions.map((subTariffOption: any) => (
                              <option key={subTariffOption.id} value={subTariffOption.id}>
                                {subTariffOption.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSaleIncomeId('');
                            setCourseEditCourseId('');
                            setCourseEditTariffId('');
                            setCourseEditSubTariffId('');
                          }}
                          className="btn btn-secondary"
                        >
                          Bekor qilish
                        </button>
                        <button
                          type="button"
                          onClick={handleSaveCourseChange}
                          disabled={updateCustomerCourseSaleMutation.isLoading}
                          className="btn btn-primary"
                        >
                          {updateCustomerCourseSaleMutation.isLoading ? 'Saqlanmoqda...' : "O'zgarishni saqlash"}
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
