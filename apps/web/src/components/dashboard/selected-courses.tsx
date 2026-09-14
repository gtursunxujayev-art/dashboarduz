'use client';

import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';

function formatCompactMoney(amount: number) {
  const value = Math.round(amount || 0);
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

type SelectedCourse = {
  courseId: string;
  name: string;
  salesCount: number;
  agreementAmount: number;
  tariffs: Array<{ tariffId: string | null; name: string; salesCount: number }>;
};

const GROUP_LABELS: Record<'online' | 'offline' | 'intensive', string> = {
  online: 'Online',
  offline: 'Offline',
  intensive: 'Intensiv',
};

function CourseCard({ label, course }: { label: string; course: SelectedCourse | null }) {
  return (
    <article className="min-h-[230px] rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">Tanlangan kurs</p>
        <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-700">
          {label}
        </span>
      </div>
      {course ? (
        <>
          <h3 className="mt-3 text-xl font-extrabold tracking-tight text-gray-900 sm:text-2xl">
            {course.name} - <span className="text-blue-600">{course.salesCount}</span>
          </h3>
          <p className="mt-2 text-sm font-medium text-gray-700 sm:text-base">
            Kelishuv - <span className="font-bold text-cyan-500">{formatCompactMoney(course.agreementAmount)} so&apos;m</span>
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {course.tariffs.map((tariff) => (
              <div
                key={`${course.courseId}:${tariff.tariffId || 'none'}`}
                className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2 text-sm font-bold text-gray-700"
              >
                {tariff.name} - <span className="text-cyan-500">{tariff.salesCount}</span>
              </div>
            ))}
            {!course.tariffs.length ? (
              <p className="text-sm text-gray-500">Tarif ma&apos;lumoti topilmadi.</p>
            ) : null}
          </div>
        </>
      ) : (
        <div className="mt-8 rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
          Tanlangan kurs topilmadi.
        </div>
      )}
    </article>
  );
}

export default function DashboardSelectedCourses() {
  const query = trpc.dashboard.selectedCourseOverview.useQuery();

  if (query.isLoading) {
    return <LoadingBlock message="Yuklanmoqda..." />;
  }

  if (query.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Tanlangan kurslar ma&apos;lumotini yuklab bo&apos;lmadi.
      </div>
    );
  }

  const data = query.data ?? { online: null, offline: null, intensive: null };

  return (
    <section>
      <h2 className="mb-3 text-xl font-bold text-gray-900">Tanlangan kurslar</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <CourseCard label={GROUP_LABELS.online} course={data.online} />
        <CourseCard label={GROUP_LABELS.offline} course={data.offline} />
        <CourseCard label={GROUP_LABELS.intensive} course={data.intensive} />
      </div>
    </section>
  );
}
