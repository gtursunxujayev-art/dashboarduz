'use client';

import { IconAlertCircle, IconCash, IconCircleCheck, IconFileText, IconReceipt, IconTag, IconUserExclamation } from '@tabler/icons-react';
import { StatTile } from '@/components/ui/stat-tile';
import { formatSom } from '@/lib/format';
import TariffBreakdownList from '../tariff-breakdown-list';
import type { CategorySalesViewModel } from './use-category-sales-view';

/** KPI band: the sold count as a dark lead tile (with its breakdown), then the other totals. */
export function CategorySalesSummary({ vm }: { vm: CategorySalesViewModel }) {
  const { isTashkiliyOnly, salesBreakdown, summary } = vm;
  const breakdown = [
    { label: 'Yangi sotuv', value: salesBreakdown?.newSalesCount ?? 0 },
    { label: "Ko'chirgan", value: salesBreakdown?.movedInCount ?? 0 },
    { label: 'Xizmat almashinuvi', value: salesBreakdown?.serviceExchangeCount ?? 0 },
  ];

  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${isTashkiliyOnly ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
      <article className="relative isolate flex min-w-0 flex-col justify-between gap-2 overflow-hidden rounded-[20px] bg-slate-950 px-4 py-3.5 text-white shadow-lg ring-1 ring-inset ring-white/10">
        <div aria-hidden="true" className="absolute -right-16 -top-16 -z-10 h-44 w-44 rounded-full bg-blue-600/30 blur-3xl" />
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-medium uppercase leading-snug tracking-[0.08em] text-white/60">Sotilganlar soni</p>
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
            <IconReceipt className="h-4 w-4" stroke={1.7} />
          </span>
        </div>
        <div className="min-w-0">
          <p className="tabular text-[22px] font-semibold leading-tight tracking-[-0.02em]">{summary?.soldCount ?? 0}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {breakdown.map((item) => (
              <span key={item.label} className="tabular rounded-full bg-white/10 px-2 py-0.5 text-white/70">
                {item.label} - <span className="font-semibold text-white">{item.value}</span>
              </span>
            ))}
          </div>
        </div>
      </article>

      <StatTile label="To'liq to'langanlar" value={summary?.fullyPaidCount ?? 0} icon={IconCircleCheck} tone="green" />

      <StatTile label="Qarzdorlar" value={summary?.debtorsCount ?? 0} icon={IconUserExclamation} tone="amber" />

      {!isTashkiliyOnly && (
        <StatTile label="Kelishuv summasi" value={formatSom(summary?.agreementAmount)} icon={IconFileText} />
      )}

      {!isTashkiliyOnly && (
        <StatTile label="To'langan summasi" value={formatSom(summary?.paidAmount)} icon={IconCash} tone="green" />
      )}

      <StatTile label="Qolgan qarz" value={formatSom(summary?.remainingDebtAmount)} icon={IconAlertCircle} tone="amber" />
    </div>
  );
}

/**
 * Sales per tariff and sub-tariff for the current filters. Sits at the end of the number tiles row: on wide
 * screens it fills the row's height (set by the tiles) and scrolls when there are many tariffs.
 */
export function CategoryTariffPanel({ vm }: { vm: CategorySalesViewModel }) {
  const { tariffBreakdown } = vm;

  return (
    <section className="panel flex flex-col xl:absolute xl:inset-0">
      <div className="panel-header py-3">
        <h2 className="section-title">Tariflar</h2>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <IconTag className="h-4 w-4" stroke={1.6} />
        </span>
      </div>
      <div className="panel-body min-h-0 flex-1 overflow-y-auto pb-3 pt-1">
        <TariffBreakdownList rows={tariffBreakdown} dense />
      </div>
    </section>
  );
}
