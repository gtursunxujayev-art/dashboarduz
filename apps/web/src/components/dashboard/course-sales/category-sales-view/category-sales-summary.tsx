'use client';

import { formatSom } from '@/lib/format';
import TariffBreakdownList from '../tariff-breakdown-list';
import type { CategorySalesViewModel } from './use-category-sales-view';

export function CategorySalesSummary({ vm }: { vm: CategorySalesViewModel }) {
  const { isTashkiliyOnly, salesBreakdown, summary, tariffBreakdown } = vm;

  return (
    <div className={`grid grid-cols-1 gap-3 ${isTashkiliyOnly ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-2 xl:grid-cols-6'}`}>
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-gray-500">Sotilganlar soni</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.soldCount ?? 0}</p>
        <div className="mt-1 space-y-1 text-xs text-gray-500">
          <p>Yangi sotuv - {salesBreakdown?.newSalesCount ?? 0}</p>
          <p>Ko'chirgan - {salesBreakdown?.movedInCount ?? 0}</p>
          <p>Xizmat almashinuvi - {salesBreakdown?.serviceExchangeCount ?? 0}</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-gray-500">To'liq to'langanlar</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.fullyPaidCount ?? 0}</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-gray-500">Qarzdorlar</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.debtorsCount ?? 0}</p>
      </div>

      {!isTashkiliyOnly && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Kelishuv summasi</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{formatSom(summary?.agreementAmount)}</p>
        </div>
      )}

      {!isTashkiliyOnly && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">To'langan summasi</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{formatSom(summary?.paidAmount)}</p>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-gray-500">Qolgan qarz</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">{formatSom(summary?.remainingDebtAmount)}</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-gray-500">Tariflar</p>
        <TariffBreakdownList rows={tariffBreakdown} />
      </div>
    </div>
  );
}
