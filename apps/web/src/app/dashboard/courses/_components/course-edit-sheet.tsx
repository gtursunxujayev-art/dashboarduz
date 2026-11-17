'use client';

import { IconCalendar, IconChevronDown, IconDeviceFloppy, IconEye, IconEyeOff, IconPlayerPause, IconPlayerPlay, IconPlus, IconSchool, IconTag, IconX } from '@tabler/icons-react';
import { COURSE_CATEGORY_OPTIONS, getCourseCategoryLabel } from '@/lib/course-categories';
import { CoursesMessages } from './course-create-forms';
import { type CourseItem, toDateInputValue } from './courses-helpers';
import type { CoursesPageModel } from './use-courses-page';

/** Toggle button tone: amber while the item is active (the action deactivates), green while it is inactive. */
export function activeToggleClass(isActive: boolean) {
  return isActive
    ? 'btn btn-warning-soft'
    : 'btn bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
}

/** Right sheet for one open course: its fields and actions, then its tariffs and sub-tariffs. */
export function CourseEditSheet({ vm, course }: { vm: CoursesPageModel; course: CourseItem }) {
  const { courseEditCategory, courseEditEndDate, courseEditName, courseEditStartDate, handleCreateSubTariff, handleToggleCourse, handleToggleCourseIncomeVisibility, handleToggleSubTariff, handleToggleTariff, handleUpdateCourse, handleUpdateSubTariff, handleUpdateTariff, newSubTariffName, openTariffIds, setCourseEditCategory, setCourseEditEndDate, setCourseEditName, setCourseEditStartDate, setNewSubTariffName, setSubTariffEditName, setTariffEditName, showSubTariffForm, subTariffEditName, tariffEditName, toggleCourseOchish, toggleSubTariffForm, toggleTariffOchish } = vm;
  const titleId = `course-edit-sheet-${course.id}`;

  return (
    <div className="modal-backdrop">
      <div className="modal-panel max-w-[640px]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${course.isActive ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                <IconSchool className="h-5 w-5" stroke={1.6} />
              </span>
              <div className="min-w-0">
                <h2 id={titleId} className="modal-title break-words">{course.name}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="badge badge-neutral tabular">{course.tariffs.length} ta tarif</span>
                  <span className={`badge ${course.isActive ? 'badge-green' : 'badge-neutral'}`}>{course.isActive ? 'Faol' : 'Faolsiz'}</span>
                  <span className="badge badge-blue">{getCourseCategoryLabel(course.category)}</span>
                  <span className={`badge ${course.isHiddenFromIncomeForm ? 'badge-amber' : 'badge-neutral'}`}>
                    {course.isHiddenFromIncomeForm ? "To'lovdan yashirilgan" : "To'lovda ko'rinadi"}
                  </span>
                  <span className="tabular inline-flex items-center gap-1 text-xs text-gray-500">
                    <IconCalendar className="h-3.5 w-3.5" stroke={1.8} />
                    {toDateInputValue(course.startDate) || '-'} / {toDateInputValue(course.endDate) || '-'}
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => toggleCourseOchish(course.id)}
              aria-expanded
              className="btn btn-ghost btn-sm"
            >
              <IconX className="h-4 w-4" stroke={1.8} />
              Yopish
            </button>
          </div>
        </div>

        <div className="modal-body space-y-6">
          <CoursesMessages vm={vm} />

          <div className="panel-inset space-y-3">
            <input
              value={courseEditName[course.id] ?? course.name}
              onChange={(event) =>
                setCourseEditName((prev) => ({ ...prev, [course.id]: event.target.value }))
              }
              className="field"
            />
            <select
              value={courseEditCategory[course.id] ?? course.category}
              onChange={(event) =>
                setCourseEditCategory((prev) => ({
                  ...prev,
                  [course.id]: event.target.value as CourseItem['category'],
                }))
              }
              className="field"
            >
              {COURSE_CATEGORY_OPTIONS.map((option) => (
                <option key={`edit-${course.id}-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="date"
                value={courseEditStartDate[course.id] ?? toDateInputValue(course.startDate)}
                onChange={(event) =>
                  setCourseEditStartDate((prev) => ({ ...prev, [course.id]: event.target.value }))
                }
                className="field"
              />
              <input
                type="date"
                value={courseEditEndDate[course.id] ?? toDateInputValue(course.endDate)}
                onChange={(event) =>
                  setCourseEditEndDate((prev) => ({ ...prev, [course.id]: event.target.value }))
                }
                className="field"
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleToggleCourseIncomeVisibility(course)}
                className={course.isHiddenFromIncomeForm
                  ? 'btn btn-sm bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'btn btn-secondary btn-sm'}
              >
                {course.isHiddenFromIncomeForm
                  ? <IconEye className="h-4 w-4" stroke={1.8} />
                  : <IconEyeOff className="h-4 w-4" stroke={1.8} />}
                {course.isHiddenFromIncomeForm ? "To'lovda ko'rsatish" : "To'lovdan yashirish"}
              </button>
              <button
                type="button"
                onClick={() => handleToggleCourse(course)}
                className={`${activeToggleClass(course.isActive)} btn-sm`}
              >
                {course.isActive
                  ? <IconPlayerPause className="h-4 w-4" stroke={1.8} />
                  : <IconPlayerPlay className="h-4 w-4" stroke={1.8} />}
                {course.isActive ? 'Faolsizlantirish' : 'Faollashtirish'}
              </button>
              <button
                type="button"
                onClick={() => handleUpdateCourse(course)}
                className="btn btn-primary btn-sm"
              >
                <IconDeviceFloppy className="h-4 w-4" stroke={1.8} />
                Saqlash
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="caption">Tariflar</p>
              <span className="badge badge-neutral tabular">{course.tariffs.length}</span>
            </div>

            {course.tariffs.length === 0 ? (
              <p className="rounded-[16px] border border-dashed border-gray-200 px-4 py-4 text-sm text-gray-500">Tarif biriktirilmagan.</p>
            ) : (
              <div className="overflow-hidden rounded-[16px] ring-1 ring-gray-200">
                <div className="divide-y divide-gray-100">
                  {course.tariffs.map((tariff) => (
                    <div key={tariff.id}>
                      <button
                        type="button"
                        onClick={() => toggleTariffOchish(tariff.id)}
                        aria-expanded={Boolean(openTariffIds[tariff.id])}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50"
                      >
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                          <IconTag className="h-4 w-4" stroke={1.8} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{tariff.name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className="badge badge-neutral tabular">{tariff.subTariffs?.length || 0} ta sub-tarif</span>
                            <span className={`badge ${tariff.isActive ? 'badge-green' : 'badge-neutral'}`}>{tariff.isActive ? 'Faol' : 'Faolsiz'}</span>
                          </div>
                        </div>
                        <span className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-medium text-blue-600">
                          {openTariffIds[tariff.id] ? 'Yopish' : 'Ochish'}
                          <IconChevronDown className={`h-4 w-4 transition-transform ${openTariffIds[tariff.id] ? 'rotate-180' : ''}`} stroke={1.8} />
                        </span>
                      </button>

                      {openTariffIds[tariff.id] && (
                        <div className="animate-rise-in space-y-3 bg-gray-50 px-4 py-4">
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                            <input
                              value={tariffEditName[tariff.id] ?? tariff.name}
                              onChange={(event) =>
                                setTariffEditName((prev) => ({ ...prev, [tariff.id]: event.target.value }))
                              }
                              className="field"
                            />
                            <button
                              type="button"
                              onClick={() => handleUpdateTariff(tariff)}
                              className="btn btn-secondary"
                            >
                              Saqlash
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleTariff(tariff)}
                              className={activeToggleClass(tariff.isActive)}
                            >
                              {tariff.isActive ? 'Faolsizlantirish' : 'Faollashtirish'}
                            </button>
                          </div>

                          <div className="rounded-[16px] bg-white p-3 shadow sm:p-4">
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <p className="text-[13px] font-semibold text-gray-500">Sub-tariflar (ixtiyoriy)</p>
                              <button
                                type="button"
                                onClick={() => toggleSubTariffForm(tariff.id)}
                                className={showSubTariffForm[tariff.id] ? 'btn btn-ghost btn-sm' : 'btn btn-soft btn-sm'}
                              >
                                {showSubTariffForm[tariff.id]
                                  ? <IconX className="h-4 w-4" stroke={1.8} />
                                  : <IconPlus className="h-4 w-4" stroke={2} />}
                                {showSubTariffForm[tariff.id] ? "Bekor qilish" : "Sub-tarif qo'shish"}
                              </button>
                            </div>

                            {showSubTariffForm[tariff.id] && (
                              <div className="mb-3 grid animate-rise-in grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                                <input
                                  value={newSubTariffName[tariff.id] || ''}
                                  onChange={(event) =>
                                    setNewSubTariffName((prev) => ({ ...prev, [tariff.id]: event.target.value }))
                                  }
                                  placeholder="Yangi sub-tarif"
                                  className="field"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleCreateSubTariff(tariff.id)}
                                  className="btn btn-primary"
                                >
                                  Sub-tarifni saqlash
                                </button>
                              </div>
                            )}

                            {tariff.subTariffs?.length ? (
                              <div className="divide-y divide-gray-100">
                                {tariff.subTariffs.map((subTariff) => (
                                  <div key={subTariff.id} className="grid grid-cols-1 gap-2 py-2 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                                    <input
                                      value={subTariffEditName[subTariff.id] ?? subTariff.name}
                                      onChange={(event) =>
                                        setSubTariffEditName((prev) => ({ ...prev, [subTariff.id]: event.target.value }))
                                      }
                                      className="field"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleUpdateSubTariff(subTariff)}
                                      className="btn btn-secondary btn-sm"
                                    >
                                      Saqlash
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleSubTariff(subTariff)}
                                      className={`${activeToggleClass(subTariff.isActive)} btn-sm`}
                                    >
                                      {subTariff.isActive ? 'Faolsizlantirish' : 'Faollashtirish'}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-gray-500">Hozircha sub-tariflar yo'q.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
