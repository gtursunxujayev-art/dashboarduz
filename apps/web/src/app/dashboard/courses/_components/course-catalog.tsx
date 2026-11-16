'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { COURSE_CATEGORY_OPTIONS, getCourseCategoryLabel } from '@/lib/course-categories';
import { type CourseItem, toDateInputValue } from './courses-helpers';
import type { CoursesPageModel } from './use-courses-page';

export function CourseCatalog({ vm }: { vm: CoursesPageModel }) {
  const { catalogQuery, courseEditCategory, courseEditEndDate, courseEditName, courseEditStartDate, courses, groupedCourses, handleCreateSubTariff, handleToggleCourse, handleToggleCourseIncomeVisibility, handleToggleSubTariff, handleToggleTariff, handleUpdateCourse, handleUpdateSubTariff, handleUpdateTariff, newSubTariffName, openCourseIds, openTariffIds, setCourseEditCategory, setCourseEditEndDate, setCourseEditName, setCourseEditStartDate, setNewSubTariffName, setSubTariffEditName, setTariffEditName, showSubTariffForm, subTariffEditName, tariffEditName, toggleCourseOchish, toggleSubTariffForm, toggleTariffOchish } = vm;

  return (
    <div className="rounded-lg bg-white shadow">
      <div className="border-b border-gray-100 px-6 py-5">
        <h2 className="text-lg font-medium text-gray-900">Kurslar katalogi</h2>
      </div>

      <div className="p-6">
        {catalogQuery.isLoading ? (
          <LoadingBlock message="Kurslar yuklanmoqda..." />
        ) : catalogQuery.error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            Kurslarni yuklashda xatolik: {catalogQuery.error.message}
          </p>
        ) : courses.length === 0 ? (
          <p className="text-sm text-gray-600">Hozircha kurslar yo'q.</p>
        ) : (
          <div className="space-y-5">
            {groupedCourses.map((group) => (
              <section key={`group-section-${group.value}`} className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-600">{group.label} kurslari</h3>
                {group.courses.length === 0 ? (
                  <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                    Hozircha {group.label.toLowerCase()} kurslari yo'q.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {group.courses.map((course) => (
                      <div key={course.id} className="overflow-hidden rounded-md border border-gray-200">
                        <button
                          type="button"
                          onClick={() => toggleCourseOchish(course.id)}
                          className="flex w-full items-center justify-between bg-gray-50 px-4 py-3 text-left hover:bg-gray-100"
                        >
                          <div>
                            <p className="text-base font-medium text-gray-900">{course.name}</p>
                            <p className="text-xs text-gray-500">
                              {course.tariffs.length} ta tarif - {course.isActive ? 'Faol' : 'Faolsiz'} - {getCourseCategoryLabel(course.category)} - {course.isHiddenFromIncomeForm ? "To'lovdan yashirilgan" : "To'lovda ko'rinadi"} - {toDateInputValue(course.startDate) || '-'} / {toDateInputValue(course.endDate) || '-'}
                            </p>
                          </div>
                          <span className="text-sm text-blue-600">{openCourseIds[course.id] ? 'Yopish' : 'Ochish'}</span>
                        </button>

                        {openCourseIds[course.id] && (
                          <div className="space-y-3 border-t border-gray-200 p-4">
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_170px_170px_auto_auto_auto] md:items-center">
                              <input
                                value={courseEditName[course.id] ?? course.name}
                                onChange={(event) =>
                                  setCourseEditName((prev) => ({ ...prev, [course.id]: event.target.value }))
                                }
                                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <select
                                value={courseEditCategory[course.id] ?? course.category}
                                onChange={(event) =>
                                  setCourseEditCategory((prev) => ({
                                    ...prev,
                                    [course.id]: event.target.value as CourseItem['category'],
                                  }))
                                }
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              >
                                {COURSE_CATEGORY_OPTIONS.map((option) => (
                                  <option key={`edit-${course.id}-${option.value}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="date"
                                value={courseEditStartDate[course.id] ?? toDateInputValue(course.startDate)}
                                onChange={(event) =>
                                  setCourseEditStartDate((prev) => ({ ...prev, [course.id]: event.target.value }))
                                }
                                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <input
                                type="date"
                                value={courseEditEndDate[course.id] ?? toDateInputValue(course.endDate)}
                                onChange={(event) =>
                                  setCourseEditEndDate((prev) => ({ ...prev, [course.id]: event.target.value }))
                                }
                                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <button
                                type="button"
                                onClick={() => handleUpdateCourse(course)}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                              >
                                Saqlash
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleCourse(course)}
                                className={`rounded-md px-3 py-2 text-sm font-medium ${
                                  course.isActive
                                    ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                    : 'bg-green-100 text-green-700 hover:bg-green-200'
                                }`}
                              >
                                {course.isActive ? 'Faolsizlantirish' : 'Faollashtirish'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleCourseIncomeVisibility(course)}
                                className={`rounded-md px-3 py-2 text-sm font-medium ${
                                  course.isHiddenFromIncomeForm
                                    ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                    : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                }`}
                              >
                                {course.isHiddenFromIncomeForm ? "To'lovda ko'rsatish" : "To'lovdan yashirish"}
                              </button>
                            </div>

                            {course.tariffs.length === 0 ? (
                              <p className="text-sm text-gray-500">Tarif biriktirilmagan.</p>
                            ) : (
                              <div className="space-y-2">
                                {course.tariffs.map((tariff) => (
                                  <div key={tariff.id} className="overflow-hidden rounded-md border border-gray-200 bg-gray-50">
                                    <button
                                      type="button"
                                      onClick={() => toggleTariffOchish(tariff.id)}
                                      className="flex w-full items-center justify-between bg-white px-3 py-2 text-left hover:bg-gray-50"
                                    >
                                      <div>
                                        <p className="text-sm font-medium text-gray-900">{tariff.name}</p>
                                        <p className="text-xs text-gray-500">
                                          {tariff.subTariffs?.length || 0} ta sub-tarif - {tariff.isActive ? 'Faol' : 'Faolsiz'}
                                        </p>
                                      </div>
                                      <span className="text-xs text-blue-600">{openTariffIds[tariff.id] ? 'Yopish' : 'Ochish'}</span>
                                    </button>

                                    {openTariffIds[tariff.id] && (
                                      <div className="space-y-3 border-t border-gray-200 p-3">
                                        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                                          <input
                                            value={tariffEditName[tariff.id] ?? tariff.name}
                                            onChange={(event) =>
                                              setTariffEditName((prev) => ({ ...prev, [tariff.id]: event.target.value }))
                                            }
                                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => handleUpdateTariff(tariff)}
                                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                          >
                                            Saqlash
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleToggleTariff(tariff)}
                                            className={`rounded-md px-3 py-2 text-sm font-medium ${
                                              tariff.isActive
                                                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                                : 'bg-green-100 text-green-700 hover:bg-green-200'
                                            }`}
                                          >
                                            {tariff.isActive ? 'Faolsizlantirish' : 'Faollashtirish'}
                                          </button>
                                        </div>

                                        <div className="rounded-md border border-gray-200 bg-white p-3">
                                          <div className="mb-3 flex items-center justify-between">
                                            <p className="text-xs font-semibold uppercase text-gray-500">Sub-tariflar (ixtiyoriy)</p>
                                            <button
                                              type="button"
                                              onClick={() => toggleSubTariffForm(tariff.id)}
                                              className="rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
                                            >
                                              {showSubTariffForm[tariff.id] ? "Bekor qilish" : "Sub-tarif qo'shish"}
                                            </button>
                                          </div>

                                          {showSubTariffForm[tariff.id] && (
                                            <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
                                              <input
                                                value={newSubTariffName[tariff.id] || ''}
                                                onChange={(event) =>
                                                  setNewSubTariffName((prev) => ({ ...prev, [tariff.id]: event.target.value }))
                                                }
                                                placeholder="Yangi sub-tarif"
                                                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                              />
                                              <button
                                                type="button"
                                                onClick={() => handleCreateSubTariff(tariff.id)}
                                                className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                                              >
                                                Sub-tarifni saqlash
                                              </button>
                                            </div>
                                          )}

                                          {tariff.subTariffs?.length ? (
                                            <div className="space-y-2">
                                              {tariff.subTariffs.map((subTariff) => (
                                                <div key={subTariff.id} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto] md:items-center">
                                                  <input
                                                    value={subTariffEditName[subTariff.id] ?? subTariff.name}
                                                    onChange={(event) =>
                                                      setSubTariffEditName((prev) => ({ ...prev, [subTariff.id]: event.target.value }))
                                                    }
                                                    className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                  />
                                                  <button
                                                    type="button"
                                                    onClick={() => handleUpdateSubTariff(subTariff)}
                                                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                                  >
                                                    Saqlash
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => handleToggleSubTariff(subTariff)}
                                                    className={`rounded-md px-3 py-2 text-sm font-medium ${
                                                      subTariff.isActive
                                                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                                        : 'bg-green-100 text-green-700 hover:bg-green-200'
                                                    }`}
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
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
