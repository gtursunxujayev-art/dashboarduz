'use client';

import { IconAlertCircle, IconCash, IconCircleCheck, IconFileText, IconReceipt, IconUserExclamation } from '@tabler/icons-react';
import { StatTile } from '@/components/ui/stat-tile';
import { formatSom } from '@/lib/format';
import TariffBreakdownList from '../tariff-breakdown-list';
import type { CategorySalesViewModel } from './use-category-sales-view';

export function CategorySalesSummary({ vm }: { vm: CategorySalesViewModel }) {
  const { isTashkiliyOnly, salesBreakdown, summary, tariffBreakdown } = vm;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid grid-cols-1 content-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile
          label="Sotilganlar soni"
          value={summary?.soldCount ?? 0}
          icon={IconReceipt}
          tone="blue"
          hint={(
            <span className="mt-1 block space-y-1 text-xs text-gray-500">
              <span className="block">Yangi sotuv - {salesBreakdown?.newSalesCount ?? 0}</span>
              <span className="block">Ko'chirgan - {salesBreakdown?.movedInCount ?? 0}</span>
              <span className="block">Xizmat almashinuvi - {salesBreakdown?.serviceExchangeCount ?? 0}</span>
            </span>
          )}
        />

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

      <div className="panel p-4 sm:p-5">
        <p className="text-[13px] font-medium text-gray-500">Tariflar</p>
        <TariffBreakdownList rows={tariffBreakdown} />
      </div>
    </div>
  );
}
