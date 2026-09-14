'use client';

import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';

function formatAmount(value?: number | null): string {
  return `${new Intl.NumberFormat('ru-RU').format(value ?? 0)} so'm`;
}

type IncomeCardProps = {
  title: string;
  online: number;
  offline: number;
};

function IncomeCard({ title, online, offline }: IncomeCardProps) {
  const total = online + offline;

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      <p className="text-base font-medium text-gray-500">{title}</p>
      <p className="mt-2 break-words text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
        {formatAmount(total)}
      </p>
      <div className="mt-5 divide-y divide-gray-100 border-t border-gray-100">
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-sm font-medium text-gray-700 sm:text-base">Online</span>
          <span className="text-right text-base font-bold text-cyan-500 sm:text-lg">{formatAmount(online)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 py-3">
          <span className="text-sm font-medium text-gray-700 sm:text-base">Ofline</span>
          <span className="text-right text-base font-bold text-cyan-500 sm:text-lg">{formatAmount(offline)}</span>
        </div>
      </div>
    </article>
  );
}

export default function DashboardIncomeOverview() {
  const query = trpc.dashboard.incomeOverview.useQuery();

  if (query.isLoading) {
    return <LoadingBlock message="Yuklanmoqda..." />;
  }

  if (query.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Tushum ma&apos;lumotlarini yuklab bo&apos;lmadi.
      </div>
    );
  }

  const daily = query.data?.daily ?? { online: 0, offline: 0 };
  const weekly = query.data?.weekly ?? { online: 0, offline: 0 };
  const monthly = query.data?.monthly ?? { online: 0, offline: 0 };

  return (
    <section>
      <h2 className="mb-3 text-xl font-bold text-gray-900">Tushum ko&apos;rinishi</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <IncomeCard title="Kunlik tushum" online={daily.online} offline={daily.offline} />
        <IncomeCard title="Haftalik tushum" online={weekly.online} offline={weekly.offline} />
        <IncomeCard title="Oylik tushum" online={monthly.online} offline={monthly.offline} />
      </div>
    </section>
  );
}
