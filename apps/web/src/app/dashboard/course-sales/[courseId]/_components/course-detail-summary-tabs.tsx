'use client';

import TariffBreakdownList from '@/components/dashboard/course-sales/tariff-breakdown-list';
import { formatSom } from '@/lib/format';
import type { CourseDetailPageModel } from './use-course-detail-page';

export function CourseDetailSummaryTabs({ vm }: { vm: CourseDetailPageModel }) {
  const { isTashkiliyOnly, managerRows, summary, tab, tariffRows } = vm;

  return (
    <>
      {tab === 'umumiy' && (
        <div className={`grid grid-cols-1 gap-3 ${isTashkiliyOnly ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2 xl:grid-cols-6'}`}>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500">Fakt sotuvlar</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.factSalesCount ?? 0}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500">Jami mijozlar</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{summary?.currentCustomerCount ?? 0}</p>
          </div>
          {!isTashkiliyOnly && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Kelishuv summasi</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">
                {formatSom(summary?.currentAgreementAmount ?? summary?.rangeAgreementAmount)}
              </p>
            </div>
          )}
          {!isTashkiliyOnly && (
            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">Tushum</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">
                {formatSom(summary?.currentIncomeAmount ?? summary?.rangeIncomeAmount)}
              </p>
            </div>
          )}
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500">Joriy qarz</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{formatSom(summary?.currentDebtAmount)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase tracking-wide text-gray-500">Tariflar</p>
            <TariffBreakdownList rows={summary?.tariffBreakdown} />
          </div>
        </div>
      )}

      {tab === 'tariflar' && (
        <div className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Tariflar kesimi</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tarif</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mijozlar</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Sotuvlar</th>
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kelishuv</th>}
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum</th>}
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Qarz</th>
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Yig&apos;im %</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {tariffRows.map((row: any) => (
                  <tr key={row.tariffId} className={row.isSelected ? 'bg-blue-50' : ''}>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.tariffName}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.customerCount}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.saleCount}</td>
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatSom(row.agreementAmount)}</td>}
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatSom(row.incomeAmount)}</td>}
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatSom(row.debtAmount)}</td>
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.collectionPercent}%</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'menejerlar' && (
        <div className="rounded-lg bg-white p-5 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Menejerlar kesimi</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Menejer</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Mijozlar</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Sotuvlar</th>
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Kelishuv</th>}
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum</th>}
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Qarz</th>
                  {!isTashkiliyOnly && <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Yig&apos;im %</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {managerRows.map((row: any) => (
                  <tr key={row.managerUserId}>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{row.managerLabel}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.customerCount}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.saleCount}</td>
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatSom(row.agreementAmount)}</td>}
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatSom(row.incomeAmount)}</td>}
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{formatSom(row.debtAmount)}</td>
                    {!isTashkiliyOnly && <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{row.collectionPercent}%</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
