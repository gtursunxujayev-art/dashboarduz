'use client';

import LoadingBlock from '@/components/dashboard/loading-block';
import { SplitBar, sharePercent } from '@/components/ui/split-bar';
import { trpc } from '@/lib/trpc';

type LeadPeriod = { total: number; qualified: number; nonQualified: number };

function LeadColumn({ title, period }: { title: string; period: LeadPeriod }) {
  return (
    <div className="p-5 sm:p-6">
      <p className="text-[13px] font-medium text-gray-500">{title}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="tabular text-3xl font-semibold leading-none tracking-tight text-gray-900">{period.total}</span>
        <span className="text-[13px] text-gray-500">Jami</span>
      </div>
      <SplitBar first={period.qualified} second={period.nonQualified} className="mt-4" />
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-2 text-gray-600">
            <span className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-500" aria-hidden="true" />
            <span>Sifatli</span>
          </dt>
          <dd className="tabular font-medium text-gray-900">
            {period.qualified}
            <span className="ml-2 font-normal text-gray-400">{sharePercent(period.qualified, period.total)}</span>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-2 text-gray-600">
            <span className="h-2 w-2 rounded-full bg-gray-300" aria-hidden="true" />
            <span>Sifatsiz</span>
          </dt>
          <dd className="tabular font-medium text-gray-900">
            {period.nonQualified}
            <span className="ml-2 font-normal text-gray-400">{sharePercent(period.nonQualified, period.total)}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

export default function DashboardLeadOverview() {
  const query = trpc.dashboard.leadOverview.useQuery(undefined, {
    retry: 1,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (query.isLoading) return <LoadingBlock message="Yangi lidlar yuklanmoqda..." className="min-h-[220px]" />;

  if (query.error || !query.data?.available) {
    return (
      <section className="panel p-5 sm:p-6">
        <h2 className="section-title">Yangi lidlar</h2>
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          AmoCRM yangi lidlar ma&apos;lumotini hozir yuklab bo&apos;lmadi.
          <button type="button" onClick={() => query.refetch()} className="ml-2 font-semibold underline">
            Qayta urinish
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <h2 className="section-title">Yangi lidlar</h2>
      </div>
      <div className="grid grid-cols-1 divide-y divide-gray-100 md:grid-cols-3 md:divide-x md:divide-y-0">
        <LeadColumn title="Bugungi" period={query.data.daily} />
        <LeadColumn title="Haftadagi" period={query.data.weekly} />
        <LeadColumn title="Oydagi" period={query.data.monthly} />
      </div>
    </section>
  );
}
