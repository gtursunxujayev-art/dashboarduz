'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { trpc } from '@/lib/trpc';

type LeadPeriod = { total: number; qualified: number; nonQualified: number };

function LeadCard({ title, period }: { title: string; period: LeadPeriod }) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-base font-medium text-gray-500">{title}</p>
      <div className="mt-3 flex items-end justify-between gap-4">
        <span className="text-sm font-semibold text-gray-700">Jami</span>
        <span className="text-2xl font-extrabold tracking-tight text-cyan-500 sm:text-3xl">{period.total}</span>
      </div>
      <div className="mt-4 divide-y divide-gray-100 border-t border-gray-100">
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-sm font-medium text-gray-700 sm:text-base">Sifatli</span>
          <span className="text-base font-bold text-cyan-500 sm:text-lg">{period.qualified}</span>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-sm font-medium text-gray-700 sm:text-base">Sifatsiz</span>
          <span className="text-base font-bold text-cyan-500 sm:text-lg">{period.nonQualified}</span>
        </div>
      </div>
    </article>
  );
}

export default function DashboardLeadOverview() {
  const query = trpc.dashboard.leadOverview.useQuery(undefined, {
    retry: 1,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (query.isLoading) return <LoadingBlock message="Yangi lidlar yuklanmoqda..." />;

  if (query.error || !query.data?.available) {
    return (
      <section>
        <h2 className="mb-3 text-xl font-bold text-gray-900">Yangi lidlar</h2>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          AmoCRM yangi lidlar ma&apos;lumotini hozir yuklab bo&apos;lmadi.
          <button type="button" onClick={() => query.refetch()} className="ml-2 font-semibold underline">
            Qayta urinish
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-3 text-xl font-bold text-gray-900">Yangi lidlar</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <LeadCard title="Bugungi" period={query.data.daily} />
        <LeadCard title="Haftadagi" period={query.data.weekly} />
        <LeadCard title="Oydagi" period={query.data.monthly} />
      </div>
    </section>
  );
}
