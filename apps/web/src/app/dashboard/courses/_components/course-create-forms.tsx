'use client';

import { IconPlus, IconSchool, IconTag } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { COURSE_CATEGORY_OPTIONS } from '@/lib/course-categories';
import type { CourseItem } from './courses-helpers';
import type { CoursesPageModel } from './use-courses-page';

/** Page title plus the page-level messages (errors, success, read-only notice). */
export function CoursesHeader({ vm }: { vm: CoursesPageModel }) {
  const { canManageCourses, error, success } = vm;

  return (
    <>
      <PageHeader
        title="Kurslar"
        description="Kurs qo'shing, tarif biriktiring va ularni tahrirlang."
      />

      {error && <p className="alert alert-error">{error}</p>}
      {success && <p className="alert alert-success">{success}</p>}
      {!canManageCourses && (
        <p className="alert alert-info">
          Siz bu bo'limni ko'rishingiz mumkin, lekin kurs va tariflarni faqat admin yoki manager o'zgartiradi.
        </p>
      )}
    </>
  );
}

/** Side panel with the "new course" and "new tariff" forms. Renders nothing for read-only users. */
export function CourseCreateForms({ vm }: { vm: CoursesPageModel }) {
  const { canManageCourses, createCourse, createTariff, groupedCourses, handleCreateCourse, handleCreateTariff, newCourseCategory, newCourseEndDate, newCourseName, newCourseStartDate, newTariffName, selectedCourseId, setNewCourseCategory, setNewCourseEndDate, setNewCourseName, setNewCourseStartDate, setNewTariffName, setSelectedCourseId } = vm;

  if (!canManageCourses) {
    return null;
  }

  return (
    <div className="panel divide-y divide-gray-100">
      <form onSubmit={handleCreateCourse} className="space-y-3 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-blue-50 text-blue-600">
            <IconSchool className="h-4 w-4" stroke={1.8} />
          </span>
          <h2 className="section-title">Yangi kurs</h2>
        </div>
        <input
          value={newCourseName}
          onChange={(event) => setNewCourseName(event.target.value)}
          placeholder="Yangi kurs nomi"
          className="field"
        />
        <select
          value={newCourseCategory}
          onChange={(event) => setNewCourseCategory(event.target.value as CourseItem['category'])}
          className="field"
        >
          {COURSE_CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="date"
            value={newCourseStartDate}
            onChange={(event) => setNewCourseStartDate(event.target.value)}
            className="field"
          />
          <input
            type="date"
            value={newCourseEndDate}
            onChange={(event) => setNewCourseEndDate(event.target.value)}
            className="field"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={createCourse.isLoading}
            className="btn btn-primary"
          >
            <IconPlus className="h-4 w-4" stroke={2} />
            {createCourse.isLoading ? "Saqlanmoqda..." : "Kurs qo'shish"}
          </button>
        </div>
      </form>

      <form onSubmit={handleCreateTariff} className="space-y-3 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-gray-100 text-gray-600">
            <IconTag className="h-4 w-4" stroke={1.8} />
          </span>
          <h2 className="section-title">Yangi tarif</h2>
        </div>
        <select
          value={selectedCourseId}
          onChange={(event) => setSelectedCourseId(event.target.value)}
          className="field"
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
          className="field"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={createTariff.isLoading}
            className="btn btn-primary"
          >
            <IconPlus className="h-4 w-4" stroke={2} />
            {createTariff.isLoading ? "Saqlanmoqda..." : "Tarif qo'shish"}
          </button>
        </div>
      </form>
    </div>
  );
}
