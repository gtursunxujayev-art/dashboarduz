'use client';

import { COURSE_CATEGORY_OPTIONS } from '@/lib/course-categories';
import type { CourseItem } from './courses-helpers';
import type { CoursesPageModel } from './use-courses-page';

export function CourseCreateForms({ vm }: { vm: CoursesPageModel }) {
  const { canManageCourses, createCourse, createTariff, error, groupedCourses, handleCreateCourse, handleCreateTariff, newCourseCategory, newCourseEndDate, newCourseName, newCourseStartDate, newTariffName, selectedCourseId, setNewCourseCategory, setNewCourseEndDate, setNewCourseName, setNewCourseStartDate, setNewTariffName, setSelectedCourseId, success } = vm;

  return (
    <div className="rounded-lg bg-white shadow">
      <div className="border-b border-gray-100 px-6 py-5">
        <h1 className="text-xl font-semibold text-gray-900">Kurslar</h1>
        <p className="mt-1 text-sm text-gray-500">Kurs qo'shing, tarif biriktiring va ularni tahrirlang.</p>
      </div>

      <div className="space-y-4 p-6">
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {success && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{success}</p>}
        {!canManageCourses && (
          <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
            Siz bu bo'limni ko'rishingiz mumkin, lekin kurs va tariflarni faqat admin yoki manager o'zgartiradi.
          </p>
        )}

        {canManageCourses && (
          <>
            <form onSubmit={handleCreateCourse} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_180px_180px_auto]">
              <input
                value={newCourseName}
                onChange={(event) => setNewCourseName(event.target.value)}
                placeholder="Yangi kurs nomi"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <select
                value={newCourseCategory}
                onChange={(event) => setNewCourseCategory(event.target.value as CourseItem['category'])}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {COURSE_CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={newCourseStartDate}
                onChange={(event) => setNewCourseStartDate(event.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <input
                type="date"
                value={newCourseEndDate}
                onChange={(event) => setNewCourseEndDate(event.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={createCourse.isLoading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createCourse.isLoading ? "Saqlanmoqda..." : "Kurs qo'shish"}
              </button>
            </form>

            <form onSubmit={handleCreateTariff} className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_auto]">
              <select
                value={selectedCourseId}
                onChange={(event) => setSelectedCourseId(event.target.value)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Kursni tanlang</option>
                {groupedCourses.map((group) =>
                  group.courses.length > 0 ? (
                    <optgroup key={`group-select-${group.value}`} label={group.label}>
                      {group.courses.map((course) => (
                        <option key={course.id} value={course.id}>
                          {course.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null,
                )}
              </select>
              <input
                value={newTariffName}
                onChange={(event) => setNewTariffName(event.target.value)}
                placeholder="Yangi tarif nomi"
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={createTariff.isLoading}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createTariff.isLoading ? "Saqlanmoqda..." : "Tarif qo'shish"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
