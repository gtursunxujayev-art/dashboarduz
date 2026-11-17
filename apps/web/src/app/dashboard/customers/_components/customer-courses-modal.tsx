'use client';

import { IconBook2, IconCalendar, IconPencil, IconTrash, IconX } from '@tabler/icons-react';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatNumberEn, formatTashkentDate } from '@/lib/format';
import type { CustomersPageModel } from './use-customers-page';

export function CustomerCoursesModal({ vm }: { vm: CustomersPageModel }) {
  const { closeCourseEditorModal, courseEditCourseId, courseEditSubTariffId, courseEditTariffId, courseEditorCustomer, deletingCourseSaleId, editMode, editSubTariffOptions, editTariffOptions, editingSaleIncomeId, editorCourses, handleDeleteCustomerCourse, handleSaveCourseChange, isAdmin, isCourseEditorModalOpen, setCourseEditCourseId, setCourseEditSubTariffId, setCourseEditTariffId, setEditingSaleIncomeId, startCourseChange, updateCustomerCourseSaleMutation } = vm;

  return (
    <>
      {isAdmin && editMode && isCourseEditorModalOpen && courseEditorCustomer && (
        <div className="modal-backdrop">
          <div className="modal-panel max-w-[760px]">
            <div className="modal-header">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <UserAvatar name={courseEditorCustomer.name || String(courseEditorCustomer.customerNumber || '?')} />
                  <div className="min-w-0">
                    <h2 className="modal-title">Mijoz kurslarini tahrirlash</h2>
                    <p className="modal-description tabular">
                      {courseEditorCustomer.customerNumber} - {courseEditorCustomer.name}
                    </p>
                  </div>
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

            <div className="modal-body space-y-3">
              {Array.isArray(courseEditorCustomer.courseEntries) && courseEditorCustomer.courseEntries.length ? (
                courseEditorCustomer.courseEntries.map((entry: any) => {
                  const isEditing = editingSaleIncomeId === entry.saleIncomeId;
                  return (
                    <div
                      key={entry.saleIncomeId}
                      className={`rounded-[16px] p-4 transition-shadow ${isEditing ? 'bg-blue-50/50 ring-1 ring-blue-200' : 'bg-gray-50'}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white text-blue-600 shadow-sm">
                            <IconBook2 className="h-[18px] w-[18px]" stroke={1.6} />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{entry.label}</p>
                            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                              <IconCalendar className="h-3.5 w-3.5" stroke={1.8} />
                              <span className="tabular">
                                Sana: {formatTashkentDate(entry.entryDate)} | Joriy qarz: {formatNumberEn(entry.remainingDebtAmount || 0)}
                              </span>
                            </p>
                          </div>
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
                            onClick={() => handleDeleteCustomerCourse(entry, courseEditorCustomer.courseEntries || [])}
                            disabled={deletingCourseSaleId === entry.saleIncomeId}
                            className="btn btn-danger-soft btn-sm"
                          >
                            <IconTrash className="h-3.5 w-3.5" stroke={1.8} />
                            {deletingCourseSaleId === entry.saleIncomeId ? "O'chirilmoqda..." : "Kursni o'chirish"}
                          </button>
                        </div>
                      </div>

                      {isEditing && (
                        <div className="mt-4 animate-rise-in space-y-3 border-t border-blue-100 pt-4">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div>
                              <label className="field-label">Yangi kurs</label>
                              <select
                                value={courseEditCourseId}
                                onChange={(event) => setCourseEditCourseId(event.target.value)}
                                className="field"
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
                              <label className="field-label">Yangi tarif</label>
                              <select
                                value={courseEditTariffId}
                                onChange={(event) => setCourseEditTariffId(event.target.value)}
                                disabled={!courseEditCourseId}
                                className="field"
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
                              <label className="field-label">Yangi subtarif</label>
                              <select
                                value={courseEditSubTariffId}
                                onChange={(event) => setCourseEditSubTariffId(event.target.value)}
                                disabled={!courseEditTariffId || !editSubTariffOptions.length}
                                className="field"
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
                  );
                })
              ) : (
                <EmptyState title="Bu mijozda aktiv kurs topilmadi." icon={IconBook2} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
