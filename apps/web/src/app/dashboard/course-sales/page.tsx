'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { IconArrowRight, IconBolt, IconBuildingStore, IconWorld } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { ActionMessages, isCustomerCourseSheetOpen } from '@/components/dashboard/course-sales/course-sales-kit';
import { PageHeader } from '@/components/ui/page-header';
import { CourseEditorModal } from './_components/course-editor-modal';
import { CourseSalesFilters } from './_components/course-sales-filters';
import { CourseSalesResults } from './_components/course-sales-results';
import { useCourseSalesPage } from './_components/use-course-sales-page';

const CATEGORY_CARDS: Array<{
  href: string;
  title: string;
  description: ReactNode;
  icon: Icon;
  tile: string;
  bar: string;
}> = [
  {
    href: '/dashboard/course-sales/intensive',
    title: 'Intensiv sahifasi',
    description: <>Intensiv bo&apos;yicha sotilgan, to&apos;langan va qarz holati.</>,
    icon: IconBolt,
    tile: 'bg-amber-50 text-amber-600',
    bar: 'bg-amber-500',
  },
  {
    href: '/dashboard/course-sales/online',
    title: 'Online sahifasi',
    description: <>Online kurslar bo&apos;yicha joriy ko&apos;rsatkichlar.</>,
    icon: IconWorld,
    tile: 'bg-blue-50 text-blue-600',
    bar: 'bg-blue-600',
  },
  {
    href: '/dashboard/course-sales/offline',
    title: 'Oflayn sahifasi',
    description: <>Oflayn kurslar bo&apos;yicha joriy ko&apos;rsatkichlar.</>,
    icon: IconBuildingStore,
    tile: 'bg-emerald-50 text-emerald-600',
    bar: 'bg-emerald-500',
  },
];

export default function CourseSalesPage() {
  const vm = useCourseSalesPage();
  const { actionError, actionSuccess, courseId, summaryQuery } = vm;
  const sheetOpen = isCustomerCourseSheetOpen(vm);

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
      >
        <nav className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {CATEGORY_CARDS.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="panel group relative flex items-center gap-4 overflow-hidden p-5 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span aria-hidden="true" className={`absolute inset-y-5 left-0 w-[3px] rounded-r-full ${card.bar}`} />
              <span className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full ${card.tile}`}>
                <card.icon className="h-6 w-6" stroke={1.6} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-gray-900">{card.title}</p>
                <p className="mt-1 text-[13px] leading-snug text-gray-500">{card.description}</p>
              </div>
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition group-hover:bg-blue-600 group-hover:text-white">
                <IconArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" stroke={1.8} />
              </span>
            </Link>
          ))}
        </nav>

        <CourseSalesFilters vm={vm} />
      </PageHeader>

      {summaryQuery.error && (
        <div className="alert alert-error">
          {summaryQuery.error.message || "Kurslar sotuvi ma'lumotini yuklashda xatolik."}
        </div>
      )}

      {!sheetOpen && <ActionMessages actionError={actionError} actionSuccess={actionSuccess} />}

      <CourseSalesResults vm={vm} />

      <CourseEditorModal vm={vm} />
    </div>
  );
}
