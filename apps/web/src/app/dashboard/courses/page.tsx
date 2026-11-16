'use client';

import { CourseCatalog } from './_components/course-catalog';
import { CourseCreateForms } from './_components/course-create-forms';
import { useCoursesPage } from './_components/use-courses-page';

export default function CoursesPage() {
  const vm = useCoursesPage();

  return (
    <div className="space-y-6">
      <CourseCreateForms vm={vm} />

      <CourseCatalog vm={vm} />
    </div>
  );
}
