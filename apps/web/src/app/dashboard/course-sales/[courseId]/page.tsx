'use client';

import Link from 'next/link';
import { IconArrowLeft, IconSchool } from '@tabler/icons-react';
import { ActionMessages, isCustomerCourseSheetOpen } from '@/components/dashboard/course-sales/course-sales-kit';
import { formatSom } from '@/lib/format';
import { CourseDetailCustomers } from './_components/course-detail-customers';
import { CourseDetailFilters } from './_components/course-detail-filters';
import type { DetailTab } from './_components/course-detail-helpers';
import { CourseDetailSummaryTabs } from './_components/course-detail-summary-tabs';
import { DetailCourseEditorModal } from './_components/detail-course-editor-modal';
import { useCourseDetailPage } from './_components/use-course-detail-page';

const TABS: Array<{ key: DetailTab; label: string }> = [
  { key: 'umumiy', label: 'Umumiy' },
  { key: 'tariflar', label: 'Tariflar' },
  { key: 'menejerlar', label: 'Menejerlar' },
  { key: 'mijozlar', label: 'Mijozlar' },
];

export default function CourseSalesDetailPage() {
  const vm = useCourseDetailPage();
  const { actionError, actionSuccess, course, detailQuery, isTashkiliyOnly, setTab, summary, tab } = vm;
  const sheetOpen = isCustomerCourseSheetOpen(vm);
  const categoryLabel = detailQuery.data?.course?.categoryLabel || course?.categoryLabel;

  const headline: Array<{ label: string; value: string | number; tone?: string }> = [
    { label: 'Fakt sotuvlar', value: summary?.factSalesCount ?? 0 },
    { label: 'Jami mijozlar', value: summary?.currentCustomerCount ?? 0 },
    ...(!isTashkiliyOnly
      ? [
          { label: 'Kelishuv summasi', value: formatSom(summary?.currentAgreementAmount ?? summary?.rangeAgreementAmount) },
          { label: 'Tushum', value: formatSom(summary?.currentIncomeAmount ?? summary?.rangeIncomeAmount), tone: 'text-emerald-300' },
        ]
      : []),
    { label: 'Joriy qarz', value: formatSom(summary?.currentDebtAmount), tone: 'text-amber-300' },
  ];

  return (
    <div className="space-y-6">
      <header className="relative isolate overflow-hidden rounded-[20px] bg-slate-950 p-6 text-white shadow-lg ring-1 ring-inset ring-white/10 sm:p-8">
        <div aria-hidden="true" className="absolute -right-24 -top-24 -z-10 h-72 w-72 rounded-full bg-blue-600/25 blur-3xl" />

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span className="hidden h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white sm:flex">
              <IconSchool className="h-6 w-6" stroke={1.6} />
            </span>
            <div className="min-w-0">
              {categoryLabel ? (
                <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-white/80 ring-1 ring-inset ring-white/15">
                  {categoryLabel}
                </span>
              ) : null}
              <h1 className="mt-2 break-words text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[32px]">
                {detailQuery.data?.course?.name || course?.name || 'Kurs detali'}
              </h1>
              <p className="mt-1.5 max-w-[70ch] text-[15px] text-white/60">
                Kurs bo&apos;yicha umumiy ko&apos;rsatkichlar, tariflar, menejerlar va mijozlar.
              </p>
            </div>
          </div>
          <Link
            href="/dashboard/course-sales"
            className="btn bg-white/10 text-white ring-1 ring-inset ring-white/15 hover:bg-white/20"
          >
            <IconArrowLeft className="h-4 w-4" stroke={1.8} />
            Orqaga
          </Link>
        </div>

        <dl className={`mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/10 pt-6 ${isTashkiliyOnly ? 'sm:grid-cols-3' : 'sm:grid-cols-3 xl:grid-cols-5'}`}>
          {headline.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-white/50">{item.label}</dt>
              <dd className={`tabular mt-1.5 break-words text-xl font-semibold leading-tight tracking-tight sm:text-2xl ${item.tone || 'text-white'}`}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <CourseDetailFilters vm={vm} />

      {detailQuery.error && (
        <div className="alert alert-error">
          {detailQuery.error.message || "Kurs detali ma'lumotini yuklashda xatolik."}
        </div>
      )}

      {!sheetOpen && <ActionMessages actionError={actionError} actionSuccess={actionSuccess} />}

      <div className="tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            className={`tab ${tab === item.key ? 'tab-active' : ''}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <CourseDetailSummaryTabs vm={vm} />

      <CourseDetailCustomers vm={vm} />

      <DetailCourseEditorModal vm={vm} />
    </div>
  );
}
