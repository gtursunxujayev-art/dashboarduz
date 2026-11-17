'use client';

import { IconPlus, IconSchool, IconTag, IconX } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { COURSE_CATEGORY_OPTIONS } from '@/lib/course-categories';
import type { CourseItem } from './courses-helpers';
import type { CoursesPageModel } from './use-courses-page';

export type CreateSheetKind = 'course' | 'tariff';

/** Error and success messages of the page (shown inside an open sheet instead of under it). */
export function CoursesMessages({ vm }: { vm: CoursesPageModel }) {
  const { error, success } = vm;
  return (
    <>
      {error && <p className="alert alert-error">{error}</p>}
      {success && <p className="alert alert-success">{success}</p>}
    </>
  );
}

/** Page title, the create actions (managers only) and the page-level messages. */
export function CoursesHeader({
  vm,
  onCreate,
  hideMessages = false,
}: {
  vm: CoursesPageModel;
  onCreate?: (kind: CreateSheetKind) => void;
  hideMessages?: boolean;
}) {
  const { canManageCourses } = vm;

  return (
    <>
      <PageHeader
        title="Kurslar"
        description="Kurs qo'shing, tarif biriktiring va ularni tahrirlang."
        actions={canManageCourses && onCreate ? (
          <>
            <button type="button" onClick={() => onCreate('tariff')} className="btn btn-secondary">
              <IconTag className="h-4 w-4" stroke={1.8} />
              Tarif qo&apos;shish
            </button>
            <button type="button" onClick={() => onCreate('course')} className="btn btn-primary">
              <IconPlus className="h-4 w-4" stroke={2} />
              Kurs qo&apos;shish
            </button>
          </>
        ) : null}
      />

      {!hideMessages && <CoursesMessages vm={vm} />}
      {!canManageCourses && (
        <p className="alert alert-info">
          Siz bu bo'limni ko'rishingiz mumkin, lekin kurs va tariflarni faqat admin yoki manager o'zgartiradi.
        </p>
      )}
    </>
  );
}

/**
 * Right sheet with the "new course" or "new tariff" form, opened from the page header.
 * Renders nothing for read-only users or while closed.
 */
export function CourseCreateForms({
  vm,
  open,
  onClose,
}: {
  vm: CoursesPageModel;
  open: CreateSheetKind | null;
  onClose: () => void;
}) {
  const { canManageCourses, createCourse, createTariff, groupedCourses, handleCreateCourse, handleCreateTariff, newCourseCategory, newCourseEndDate, newCourseName, newCourseStartDate, newTariffName, selectedCourseId, setNewCourseCategory, setNewCourseEndDate, setNewCourseName, setNewCourseStartDate, setNewTariffName, setSelectedCourseId } = vm;

  if (!canManageCourses || !open) {
    return null;
  }

  const isCourse = open === 'course';

  return (
    <div className="modal-backdrop">
      <div className="modal-panel max-w-[520px]" role="dialog" aria-modal="true" aria-labelledby="course-create-sheet-title">
        <div className="modal-header">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${isCourse ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-600'}`}>
                {isCourse ? <IconSchool className="h-5 w-5" stroke={1.6} /> : <IconTag className="h-5 w-5" stroke={1.6} />}
              </span>
              <h2 id="course-create-sheet-title" className="modal-title">{isCourse ? 'Yangi kurs' : 'Yangi tarif'}</h2>
            </div>
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
              <IconX className="h-4 w-4" stroke={1.8} />
              Yopish
            </button>
          </div>
        </div>

        {isCourse ? (
          <form onSubmit={handleCreateCourse} className="flex flex-1 flex-col">
            <div className="modal-body">
              <CoursesMessages vm={vm} />
              <div className="space-y-3">
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
              </div>
              <div className="panel-inset grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            </div>
            <div className="modal-footer">
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
        ) : (
          <form onSubmit={handleCreateTariff} className="flex flex-1 flex-col">
            <div className="modal-body">
              <CoursesMessages vm={vm} />
              <div className="space-y-3">
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
              </div>
            </div>
            <div className="modal-footer">
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
        )}
      </div>
    </div>
  );
}
