'use client';

import { IconAlertCircle, IconCash, IconFileText, IconReceipt, IconUsers } from '@tabler/icons-react';
import TariffBreakdownList from '@/components/dashboard/course-sales/tariff-breakdown-list';
import { StatTile } from '@/components/ui/stat-tile';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatSom } from '@/lib/format';
import type { CourseDetailPageModel } from './use-course-detail-page';

export function CourseDetailSummaryTabs({ vm }: { vm: CourseDetailPageModel }) {
  const { isTashkiliyOnly, managerRows, summary, tab, tariffRows } = vm;

  return (
    <>
      {tab === 'umumiy' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid grid-cols-1 content-start gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile label="Fakt sotuvlar" value={summary?.factSalesCount ?? 0} icon={IconReceipt} tone="blue" />
            <StatTile label="Jami mijozlar" value={summary?.currentCustomerCount ?? 0} icon={IconUsers} />
            {!isTashkiliyOnly && (
              <StatTile
                label="Kelishuv summasi"
                value={formatSom(summary?.currentAgreementAmount ?? summary?.rangeAgreementAmount)}
                icon={IconFileText}
              />
            )}
            {!isTashkiliyOnly && (
              <StatTile
                label="Tushum"
                value={formatSom(summary?.currentIncomeAmount ?? summary?.rangeIncomeAmount)}
                icon={IconCash}
                tone="green"
              />
            )}
            <StatTile label="Joriy qarz" value={formatSom(summary?.currentDebtAmount)} icon={IconAlertCircle} tone="amber" />
          </div>
          <div className="panel p-4 sm:p-5">
            <p className="text-[13px] font-medium text-gray-500">Tariflar</p>
            <TariffBreakdownList rows={summary?.tariffBreakdown} />
          </div>
        </div>
      )}

      {tab === 'tariflar' && (
        <div className="panel">
          <div className="panel-header">
            <h2 className="section-title">Tariflar kesimi</h2>
            <span className="badge badge-neutral tabular">{tariffRows.length}</span>
          </div>
          <div className="p-2 sm:p-3">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left">Tarif</th>
                    <th className="text-right">Mijozlar</th>
                    <th className="text-right">Sotuvlar</th>
                    {!isTashkiliyOnly && <th className="text-right">Kelishuv</th>}
                    {!isTashkiliyOnly && <th className="text-right">Tushum</th>}
                    <th className="text-right">Qarz</th>
                    {!isTashkiliyOnly && <th className="text-right">Yig&apos;im %</th>}
                  </tr>
                </thead>
                <tbody>
                  {tariffRows.map((row: any) => (
                    <tr key={row.tariffId} className={row.isSelected ? 'bg-blue-50' : ''}>
                      <td className="whitespace-nowrap font-medium text-gray-900">{row.tariffName}</td>
                      <td className="tabular whitespace-nowrap text-right">{row.customerCount}</td>
                      <td className="tabular whitespace-nowrap text-right">{row.saleCount}</td>
                      {!isTashkiliyOnly && <td className="tabular whitespace-nowrap text-right">{formatSom(row.agreementAmount)}</td>}
                      {!isTashkiliyOnly && <td className="tabular whitespace-nowrap text-right text-emerald-700">{formatSom(row.incomeAmount)}</td>}
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.debtAmount)}</td>
                      {!isTashkiliyOnly && (
                        <td className="whitespace-nowrap text-right">
                          <span className="badge badge-blue tabular">{row.collectionPercent}%</span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'menejerlar' && (
        <div className="panel">
          <div className="panel-header">
            <h2 className="section-title">Menejerlar kesimi</h2>
            <span className="badge badge-neutral tabular">{managerRows.length}</span>
          </div>
          <div className="p-2 sm:p-3">
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-left">Menejer</th>
                    <th className="text-right">Mijozlar</th>
                    <th className="text-right">Sotuvlar</th>
                    {!isTashkiliyOnly && <th className="text-right">Kelishuv</th>}
                    {!isTashkiliyOnly && <th className="text-right">Tushum</th>}
                    <th className="text-right">Qarz</th>
                    {!isTashkiliyOnly && <th className="text-right">Yig&apos;im %</th>}
                  </tr>
                </thead>
                <tbody>
                  {managerRows.map((row: any) => (
                    <tr key={row.managerUserId}>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar name={String(row.managerLabel || '?')} size="sm" />
                          <span className="font-medium text-gray-900">{row.managerLabel}</span>
                        </div>
                      </td>
                      <td className="tabular whitespace-nowrap text-right">{row.customerCount}</td>
                      <td className="tabular whitespace-nowrap text-right">{row.saleCount}</td>
                      {!isTashkiliyOnly && <td className="tabular whitespace-nowrap text-right">{formatSom(row.agreementAmount)}</td>}
                      {!isTashkiliyOnly && <td className="tabular whitespace-nowrap text-right text-emerald-700">{formatSom(row.incomeAmount)}</td>}
                      <td className="tabular whitespace-nowrap text-right">{formatSom(row.debtAmount)}</td>
                      {!isTashkiliyOnly && (
                        <td className="whitespace-nowrap text-right">
                          <span className="badge badge-blue tabular">{row.collectionPercent}%</span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
