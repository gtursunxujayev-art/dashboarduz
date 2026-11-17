'use client';

import { IconCalendar, IconChevronRight, IconSchool } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { EmptyState } from '@/components/ui/empty-state';
import { getCourseCategoryLabel } from '@/lib/course-categories';
import { CourseEditSheet } from './course-edit-sheet';
import { type CourseItem, toDateInputValue } from './courses-helpers';
import type { CoursesPageModel } from './use-courses-page';

/** The course that is open for editing (the page shows it in a right sheet). */
export function findOpenCourse(vm: Pick<CoursesPageModel, 'courses' | 'openCourseIds'>): CourseItem | null {
  return vm.courses.find((course) => vm.openCourseIds[course.id]) || null;
}

function CourseCard({ course, isOpen, onToggle }: { course: CourseItem; isOpen: boolean; onToggle: () => void }) {
  return (
    <article className="panel group flex min-w-0 flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${course.isActive ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
          <IconSchool className="h-5 w-5" stroke={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[15px] font-semibold text-gray-900">{course.name}</h4>
          <p className="tabular mt-1 inline-flex items-center gap-1 text-xs text-gray-500">
            <IconCalendar className="h-3.5 w-3.5" stroke={1.8} />
            {toDateInputValue(course.startDate) || '-'} / {toDateInputValue(course.endDate) || '-'}
          </p>
        </div>
        <span className={`badge ${course.isActive ? 'badge-green' : 'badge-neutral'}`}>{course.isActive ? 'Faol' : 'Faolsiz'}</span>
      </div>

      {course.tariffs.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {course.tariffs.map((tariff) => (
            <span
              key={tariff.id}
              className={`badge max-w-full ${tariff.isActive ? 'badge-neutral' : 'bg-gray-50 text-gray-400 line-through'}`}
            >
              <span className="truncate">{tariff.name}</span>
            </span>
          ))}
        </div>
      )}

      <div aria-hidden="true" className="min-h-5 flex-1" />

      <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-4">
        <span className="badge badge-neutral tabular">{course.tariffs.length} ta tarif</span>
        <span className="badge badge-blue">{getCourseCategoryLabel(course.category)}</span>
        <span className={`badge ${course.isHiddenFromIncomeForm ? 'badge-amber' : 'badge-neutral'}`}>
          {course.isHiddenFromIncomeForm ? "To'lovdan yashirilgan" : "To'lovda ko'rinadi"}
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="btn btn-soft btn-sm ml-auto"
        >
          {isOpen ? 'Yopish' : 'Ochish'}
          <IconChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" stroke={1.8} />
        </button>
      </div>
    </article>
  );
}

/** Courses grouped by category: a section per category with a responsive card grid. */
export function CourseCatalog({ vm }: { vm: CoursesPageModel }) {
  const { catalogQuery, courses, groupedCourses, openCourseIds, toggleCourseOchish } = vm;
  const openCourse = findOpenCourse(vm);

  return (
    <section className="space-y-5">
      <h2 className="section-title">Kurslar katalogi</h2>

      {catalogQuery.isLoading ? (
        <div className="panel p-3 sm:p-4">
          <LoadingBlock message="Kurslar yuklanmoqda..." className="min-h-[200px]" />
        </div>
      ) : catalogQuery.error ? (
        <p className="alert alert-error">
          Kurslarni yuklashda xatolik: {catalogQuery.error.message}
        </p>
      ) : courses.length === 0 ? (
        <div className="panel p-3 sm:p-4">
          <EmptyState icon={IconSchool} title="Hozircha kurslar yo'q." />
        </div>
      ) : (
        <div className="space-y-8">
          {groupedCourses.map((group) => (
            <section key={`group-section-${group.value}`} className="space-y-3">
              <div className="flex items-center gap-2.5 px-1">
                <h3 className="section-title">{group.label} kurslari</h3>
                <span className="badge badge-neutral tabular">{group.courses.length}</span>
              </div>
              {group.courses.length === 0 ? (
                <p className="rounded-[20px] border border-dashed border-gray-200 px-5 py-6 text-sm text-gray-500">
                  Hozircha {group.label.toLowerCase()} kurslari yo'q.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {group.courses.map((course) => (
                    <CourseCard
                      key={course.id}
                      course={course}
                      isOpen={Boolean(openCourseIds[course.id])}
                      onToggle={() => toggleCourseOchish(course.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {openCourse && <CourseEditSheet vm={vm} course={openCourse} />}
    </section>
  );
}
