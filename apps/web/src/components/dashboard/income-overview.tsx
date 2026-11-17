'use client';

import Image from 'next/image';
import { IconCalendarWeek, IconSun } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { trpc } from '@/lib/trpc';
import LoadingBlock from '@/components/dashboard/loading-block';
import { SplitBar, sharePercent } from '@/components/ui/split-bar';
import { formatSom } from '@/lib/format';

type IncomeCardProps = {
  title: string;
  online: number;
  offline: number;
};

/** The month at a glance: dark in both themes, carried by the brand artwork. */
function IncomeHero({ title, online, offline }: IncomeCardProps) {
  const total = online + offline;

  return (
    <article className="relative isolate flex min-h-[236px] flex-col justify-between overflow-hidden rounded-[18px] bg-slate-950 p-6 text-white shadow-lg ring-1 ring-inset ring-white/10 sm:p-8">
      <Image
        src="/art/hero-wave.webp"
        alt=""
        fill
        priority
        sizes="(min-width: 1280px) 60vw, 100vw"
        className="-z-10 object-cover object-right"
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-slate-950/95 via-slate-950/35 to-transparent" aria-hidden="true" />

      <div>
        <p className="text-sm font-medium text-white/70">{title}</p>
        <p className="tabular mt-3 break-words text-4xl font-semibold leading-none tracking-tight sm:text-5xl">
          {formatSom(total)}
        </p>
      </div>

      <div className="mt-8 max-w-md">
        <div className="flex items-center justify-between text-sm">
          <p className="flex items-baseline gap-2">
            <span className="font-medium">Online</span>
            <span className="tabular text-white/60">{sharePercent(online, total)}</span>
          </p>
          <p className="flex items-baseline gap-2">
            <span className="tabular text-white/60">{sharePercent(offline, total)}</span>
            <span className="font-medium">Ofline</span>
          </p>
        </div>
        <SplitBar first={online} second={offline} tone="ink" className="mt-2.5" />
        <div className="tabular mt-2.5 flex items-center justify-between text-sm text-white/80">
          <span>{formatSom(online)}</span>
          <span>{formatSom(offline)}</span>
        </div>
      </div>
    </article>
  );
}

function IncomeStat({ title, online, offline, icon: StatIcon }: IncomeCardProps & { icon: Icon }) {
  const total = online + offline;

  return (
    <article className="panel flex flex-col justify-between p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-blue-50 text-blue-600">
          <StatIcon className="h-5 w-5" stroke={1.6} />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-gray-500">{title}</p>
          <p className="tabular break-words text-xl font-semibold leading-tight tracking-tight text-gray-900">
            {formatSom(total)}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <SplitBar first={online} second={offline} />
        <div className="mt-2.5 grid grid-cols-2 gap-3 text-[13px]">
          <p className="min-w-0">
            <span className="text-gray-500">Online</span>
            <span className="tabular block truncate font-medium text-gray-900">{formatSom(online)}</span>
          </p>
          <p className="min-w-0 text-right">
            <span className="text-gray-500">Ofline</span>
            <span className="tabular block truncate font-medium text-gray-900">{formatSom(offline)}</span>
          </p>
        </div>
      </div>
    </article>
  );
}

export default function DashboardIncomeOverview() {
  const query = trpc.dashboard.incomeOverview.useQuery();

  if (query.isLoading) {
    return <LoadingBlock message="Yuklanmoqda..." className="min-h-[236px]" />;
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
    <section aria-labelledby="income-overview-title">
      <h2 id="income-overview-title" className="sr-only">Tushum ko&apos;rinishi</h2>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <IncomeHero title="Oylik tushum" online={monthly.online} offline={monthly.offline} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <IncomeStat title="Kunlik tushum" online={daily.online} offline={daily.offline} icon={IconSun} />
          <IncomeStat title="Haftalik tushum" online={weekly.online} offline={weekly.offline} icon={IconCalendarWeek} />
        </div>
      </div>
    </section>
  );
}
