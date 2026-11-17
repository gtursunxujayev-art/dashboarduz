'use client';

import Link from 'next/link';
import { IconArrowLeft } from '@tabler/icons-react';
import { PageHeader } from '@/components/ui/page-header';
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
      <PageHeader
        title={detailQuery.data?.course?.name || course?.name || 'Kurs detali'}
        description={<>Kurs bo&apos;yicha umumiy ko&apos;rsatkichlar, tariflar, menejerlar va mijozlar.</>}
        actions={(
          <Link
            href="/dashboard/course-sales"
            className="btn btn-secondary"
          >
            <IconArrowLeft className="h-4 w-4" stroke={1.8} />
            Orqaga
          </Link>
        )}
      >
        <div className="segmented max-w-full overflow-x-auto">
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
              aria-pressed={tab === item.key}
              className={`segmented-item ${tab === item.key ? 'segmented-item-active' : ''}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </PageHeader>

      <CourseDetailFilters vm={vm} />

      {detailQuery.error && (
        <div className="alert alert-error">
          {detailQuery.error.message || "Kurs detali ma'lumotini yuklashda xatolik."}
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

      <CourseDetailSummaryTabs vm={vm} />

      <CourseDetailCustomers vm={vm} />

      <DetailCourseEditorModal vm={vm} />
    </div>
  );
}
