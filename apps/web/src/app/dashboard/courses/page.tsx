'use client';

import { CourseCatalog } from './_components/course-catalog';
import { CourseCreateForms, CoursesHeader } from './_components/course-create-forms';
import { useCoursesPage } from './_components/use-courses-page';

export default function CoursesPage() {
  const vm = useCoursesPage();

  return (
    <div className="space-y-6">
      <CoursesHeader vm={vm} />

      <div className={`grid grid-cols-1 gap-6 ${vm.canManageCourses ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
        {vm.canManageCourses && (
          <aside className="xl:sticky xl:top-6 xl:order-2 xl:self-start">
            <CourseCreateForms vm={vm} />
          </aside>
        )}

        <div className="min-w-0 xl:order-1">
          <CourseCatalog vm={vm} />
        </div>
      </div>
    </div>
  );
}
