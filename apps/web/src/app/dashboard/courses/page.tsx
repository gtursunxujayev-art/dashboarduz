'use client';

import { useState } from 'react';
import { CourseCatalog, findOpenCourse } from './_components/course-catalog';
import { CourseCreateForms, CoursesHeader, type CreateSheetKind } from './_components/course-create-forms';
import { useCoursesPage } from './_components/use-courses-page';

export default function CoursesPage() {
  const vm = useCoursesPage();
  // UI only: which create sheet ("Yangi kurs" / "Yangi tarif") is open.
  const [createSheet, setCreateSheet] = useState<CreateSheetKind | null>(null);
  const sheetOpen = Boolean((vm.canManageCourses && createSheet) || findOpenCourse(vm));

  return (
    <div className="space-y-6">
      <CoursesHeader vm={vm} onCreate={setCreateSheet} hideMessages={sheetOpen} />

      <CourseCatalog vm={vm} />

      <CourseCreateForms vm={vm} open={createSheet} onClose={() => setCreateSheet(null)} />
    </div>
  );
}
