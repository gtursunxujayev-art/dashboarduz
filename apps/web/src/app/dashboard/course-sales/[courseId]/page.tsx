'use client';

import Link from 'next/link';
import { CourseDetailCustomers } from './_components/course-detail-customers';
import { CourseDetailFilters } from './_components/course-detail-filters';
import type { DetailTab } from './_components/course-detail-helpers';
import { CourseDetailSummaryTabs } from './_components/course-detail-summary-tabs';
import { DetailCourseEditorModal } from './_components/detail-course-editor-modal';
import { useCourseDetailPage } from './_components/use-course-detail-page';

export default function CourseSalesDetailPage() {
  const vm = useCourseDetailPage();
  const { actionError, actionSuccess, course, detailQuery, setTab, tab } = vm;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {detailQuery.data?.course?.name || course?.name || 'Kurs detali'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Kurs bo&apos;yicha umumiy ko&apos;rsatkichlar, tariflar, menejerlar va mijozlar.
          </p>
        </div>
        <Link
          href="/dashboard/course-sales"
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Orqaga
        </Link>
      </div>

      <CourseDetailFilters vm={vm} />

      <div className="rounded-lg bg-white p-2 shadow">
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'umumiy', label: 'Umumiy' },
            { key: 'tariflar', label: 'Tariflar' },
            { key: 'menejerlar', label: 'Menejerlar' },
            { key: 'mijozlar', label: 'Mijozlar' },
          ] as Array<{ key: DetailTab; label: string }>).map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`rounded-md px-3 py-2 text-sm font-medium ${
                tab === item.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {detailQuery.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {detailQuery.error.message || "Kurs detali ma'lumotini yuklashda xatolik."}
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

      <CourseDetailSummaryTabs vm={vm} />

      <CourseDetailCustomers vm={vm} />

      <DetailCourseEditorModal vm={vm} />
    </div>
  );
}
