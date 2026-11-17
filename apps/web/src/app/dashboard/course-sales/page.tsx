'use client';

import Link from 'next/link';
import { IconArrowRight, IconBolt, IconBuildingStore, IconWorld } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
import { CourseEditorModal } from './_components/course-editor-modal';
import { CourseSalesFilters } from './_components/course-sales-filters';
import { CourseSalesResults } from './_components/course-sales-results';
import { useCourseSalesPage } from './_components/use-course-sales-page';

export default function CourseSalesPage() {
  const vm = useCourseSalesPage();
  const { actionError, actionSuccess, courseId, summaryQuery } = vm;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kurslar sotuvi"
        description={<>Kurs, tarif va subtarif bo&apos;yicha joriy mijozlar hamda sotuv ko&apos;rsatkichlari.</>}
        actions={courseId ? (
          <Link
            href={`/dashboard/course-sales/${courseId}`}
            className="btn btn-primary"
          >
            Batafsil
            <IconArrowRight className="h-4 w-4" stroke={1.8} />
          </Link>
        ) : null}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Link
          href="/dashboard/course-sales/intensive"
          className="panel group flex items-start gap-3.5 p-4 transition hover:-translate-y-0.5 sm:p-5"
        >
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-amber-50 text-amber-600">
            <IconBolt className="h-5 w-5" stroke={1.6} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Intensiv sahifasi</p>
            <p className="mt-1 text-xs text-gray-500">Intensiv bo&apos;yicha sotilgan, to&apos;langan va qarz holati.</p>
          </div>
          <IconArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" stroke={1.8} />
        </Link>
        <Link
          href="/dashboard/course-sales/online"
          className="panel group flex items-start gap-3.5 p-4 transition hover:-translate-y-0.5 sm:p-5"
        >
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
            <IconWorld className="h-5 w-5" stroke={1.6} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Online sahifasi</p>
            <p className="mt-1 text-xs text-gray-500">Online kurslar bo&apos;yicha joriy ko&apos;rsatkichlar.</p>
          </div>
          <IconArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" stroke={1.8} />
        </Link>
        <Link
          href="/dashboard/course-sales/offline"
          className="panel group flex items-start gap-3.5 p-4 transition hover:-translate-y-0.5 sm:p-5"
        >
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-emerald-50 text-emerald-600">
            <IconBuildingStore className="h-5 w-5" stroke={1.6} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Oflayn sahifasi</p>
            <p className="mt-1 text-xs text-gray-500">Oflayn kurslar bo&apos;yicha joriy ko&apos;rsatkichlar.</p>
          </div>
          <IconArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" stroke={1.8} />
        </Link>
      </div>

      <CourseSalesFilters vm={vm} />

      {summaryQuery.error && (
        <div className="alert alert-error">
          {summaryQuery.error.message || "Kurslar sotuvi ma'lumotini yuklashda xatolik."}
        </div>
      )}

      {actionError && (
        <div className="alert alert-error">
          {actionError}
        </div>
      )}

      {actionSuccess && (
        <div className="alert alert-success">
          {actionSuccess}
        </div>
      )}

      <CourseSalesResults vm={vm} />

      <CourseEditorModal vm={vm} />
    </div>
  );
}
