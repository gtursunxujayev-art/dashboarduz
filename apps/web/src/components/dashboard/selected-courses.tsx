'use client';

import { IconBuildingCommunity, IconFlame, IconWorld } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';
import { formatCompactMoney } from '@/lib/format';

type SelectedCourse = {
  courseId: string;
  name: string;
  salesCount: number;
  agreementAmount: number;
  tariffs: Array<{ tariffId: string | null; name: string; salesCount: number }>;
};

type GroupKey = 'online' | 'offline' | 'intensive';

const GROUPS: Record<GroupKey, { label: string; icon: Icon }> = {
  online: { label: 'Online', icon: IconWorld },
  offline: { label: 'Offline', icon: IconBuildingCommunity },
  intensive: { label: 'Intensiv', icon: IconFlame },
};

function CourseCard({ group, course }: { group: GroupKey; course: SelectedCourse | null }) {
  const { label, icon: GroupIcon } = GROUPS[group];

  return (
    <article className="panel flex min-h-[212px] flex-col p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-gray-100 text-gray-700">
          <GroupIcon className="h-5 w-5" stroke={1.6} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-gray-500">Tanlangan kurs</p>
          <p className="text-sm font-medium text-gray-900">{label}</p>
        </div>
      </div>
      {course ? (
        <>
          <h3 className="mt-5 text-xl font-semibold tracking-tight text-gray-900">
            {course.name} - <span className="tabular text-blue-600 dark:text-blue-400">{course.salesCount}</span>
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Kelishuv - <span className="tabular font-medium text-gray-900">{formatCompactMoney(course.agreementAmount)} so&apos;m</span>
          </p>
          <div className="mt-auto flex flex-wrap gap-2 pt-5">
            {course.tariffs.map((tariff) => (
              <div
                key={`${course.courseId}:${tariff.tariffId || 'none'}`}
                className="rounded-md bg-gray-100 px-2.5 py-1.5 text-[13px] text-gray-600"
              >
                {tariff.name} - <span className="tabular font-semibold text-gray-900">{tariff.salesCount}</span>
              </div>
            ))}
            {!course.tariffs.length ? (
              <p className="text-sm text-gray-500">Tarif ma&apos;lumoti topilmadi.</p>
            ) : null}
          </div>
        </>
      ) : (
        <div className="mt-5 flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
          Tanlangan kurs topilmadi.
        </div>
      )}
    </article>
  );
}

export default function DashboardSelectedCourses() {
  const query = trpc.dashboard.selectedCourseOverview.useQuery();

  if (query.isLoading) {
    return <LoadingBlock message="Yuklanmoqda..." className="min-h-[212px]" />;
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
      <h2 className="section-title mb-3">Tanlangan kurslar</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <CourseCard group="online" course={data.online} />
        <CourseCard group="offline" course={data.offline} />
        <CourseCard group="intensive" course={data.intensive} />
      </div>
    </section>
  );
}
