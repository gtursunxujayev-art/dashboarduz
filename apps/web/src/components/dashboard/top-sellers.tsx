'use client';

import Link from 'next/link';
import { IconArrowRight } from '@tabler/icons-react';
import LoadingBlock from '@/components/dashboard/loading-block';
import { UserAvatar } from '@/components/ui/user-avatar';
import { sharePercent } from '@/components/ui/split-bar';
import { formatSom } from '@/lib/format';

type SellerRow = { userId: string; name: string; incomeAmount?: number | null };

const SHOWN = 4;

/** Ranking of sellers by income for the selected period. Bars are relative to the leader. */
export default function DashboardTopSellers({ sellers, isLoading }: { sellers: SellerRow[]; isLoading: boolean }) {
  const ranked = [...sellers]
    .filter((seller) => (seller.incomeAmount ?? 0) > 0)
    .sort((a, b) => (b.incomeAmount ?? 0) - (a.incomeAmount ?? 0));
  const top = ranked.slice(0, SHOWN);
  const total = ranked.reduce((sum, seller) => sum + (seller.incomeAmount ?? 0), 0);
  const leader = top[0]?.incomeAmount ?? 0;

  return (
    <section className="panel flex flex-col p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">Top sotuvchilar</h2>
        <Link
          href="/dashboard/sotuvchilar"
          className="inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Barchasini ko&apos;rish
          <IconArrowRight className="h-4 w-4" stroke={1.6} />
        </Link>
      </div>

      {isLoading ? (
        <LoadingBlock message="Yuklanmoqda..." className="mt-4 flex-1" />
      ) : top.length ? (
        <ol className="mt-4 flex flex-1 flex-col justify-around gap-1">
          {top.map((seller, index) => {
            const amount = seller.incomeAmount ?? 0;
            return (
              <li key={seller.userId} className="flex items-center gap-3 py-1.5">
                <span className="tabular w-4 flex-shrink-0 text-[13px] text-gray-400">{index + 1}.</span>
                <UserAvatar name={seller.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-tight text-gray-900">{seller.name}</p>
                  <div className="mt-1.5 h-1 w-full max-w-[190px] overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                    <div
                      className="h-full origin-left animate-grow-x rounded-full bg-blue-600 dark:bg-blue-500"
                      style={{ width: `${leader > 0 ? Math.max(4, (amount / leader) * 100) : 0}%`, animationDelay: `${index * 60}ms` }}
                    />
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className="tabular text-sm font-semibold leading-tight text-gray-900">{formatSom(amount)}</p>
                  <p className="tabular mt-0.5 text-xs leading-tight text-gray-500">{sharePercent(amount, total)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="mt-4 flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
          Tanlangan davrda tushum yozuvi yo&apos;q.
        </div>
      )}
    </section>
  );
}
