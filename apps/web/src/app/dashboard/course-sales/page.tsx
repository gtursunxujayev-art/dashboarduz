'use client';

import Link from 'next/link';
import { CourseEditorModal } from './_components/course-editor-modal';
import { CourseSalesFilters } from './_components/course-sales-filters';
import { CourseSalesResults } from './_components/course-sales-results';
import { useCourseSalesPage } from './_components/use-course-sales-page';

export default function CourseSalesPage() {
  const vm = useCourseSalesPage();
  const { actionError, actionSuccess, courseId, summaryQuery } = vm;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Kurslar sotuvi</h1>
          <p className="mt-1 text-sm text-gray-500">
            Kurs, tarif va subtarif bo&apos;yicha joriy mijozlar hamda sotuv ko&apos;rsatkichlari.
          </p>
        </div>
        {courseId && (
          <Link
            href={`/dashboard/course-sales/${courseId}`}
            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            Batafsil
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Link
          href="/dashboard/course-sales/intensive"
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
        >
          <p className="text-sm font-semibold text-gray-900">Intensiv sahifasi</p>
          <p className="mt-1 text-xs text-gray-500">Intensiv bo&apos;yicha sotilgan, to&apos;langan va qarz holati.</p>
        </Link>
        <Link
          href="/dashboard/course-sales/online"
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
        >
          <p className="text-sm font-semibold text-gray-900">Online sahifasi</p>
          <p className="mt-1 text-xs text-gray-500">Online kurslar bo&apos;yicha joriy ko&apos;rsatkichlar.</p>
        </Link>
        <Link
          href="/dashboard/course-sales/offline"
          className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
        >
          <p className="text-sm font-semibold text-gray-900">Oflayn sahifasi</p>
          <p className="mt-1 text-xs text-gray-500">Oflayn kurslar bo&apos;yicha joriy ko&apos;rsatkichlar.</p>
        </Link>
      </div>

      <CourseSalesFilters vm={vm} />

      {summaryQuery.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {summaryQuery.error.message || "Kurslar sotuvi ma'lumotini yuklashda xatolik."}
        </div>
      )}

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {actionSuccess && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {actionSuccess}
        </div>
      )}

      <CourseSalesResults vm={vm} />

      <CourseEditorModal vm={vm} />
    </div>
  );
}
