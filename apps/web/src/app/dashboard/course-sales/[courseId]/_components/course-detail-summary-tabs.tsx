'use client';

import type { ReactNode } from 'react';
import { IconTag, IconUserStar } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import TariffBreakdownList from '@/components/dashboard/course-sales/tariff-breakdown-list';
import { UserAvatar } from '@/components/ui/user-avatar';
import { formatSom } from '@/lib/format';
import type { CourseDetailPageModel } from './use-course-detail-page';

function TablePanel({ title, count, icon: PanelIcon, children }: { title: ReactNode; count: number; icon: Icon; children: ReactNode }) {
  return (
    <section className="panel animate-fade-in">
      <div className="panel-header">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <PanelIcon className="h-[18px] w-[18px]" stroke={1.6} />
          </span>
          <h2 className="section-title">{title}</h2>
          <span className="badge badge-neutral tabular">{count}</span>
        </div>
      </div>
      <div className="px-2 pb-2 pt-3 sm:px-3">
        <div className="overflow-x-auto">{children}</div>
      </div>
    </section>
  );
}

/**
 * The "Umumiy", "Tariflar" and "Menejerlar" views of the course detail page. The headline numbers
 * live in the page hero, so "Umumiy" shows the per-tariff sales breakdown.
 */
export function CourseDetailSummaryTabs({ vm }: { vm: CourseDetailPageModel }) {
  const { isTashkiliyOnly, managerRows, summary, tab, tariffRows } = vm;

  return (
    <>
      {tab === 'umumiy' && (
        <section className="panel animate-fade-in">
          <div className="panel-header">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <IconTag className="h-[18px] w-[18px]" stroke={1.6} />
              </span>
              <h2 className="section-title">Tariflar</h2>
            </div>
          </div>
          <div className="panel-body pt-4">
            <TariffBreakdownList rows={summary?.tariffBreakdown} variant="cards" />
          </div>
        </section>
      )}

      {tab === 'tariflar' && (
        <TablePanel title="Tariflar kesimi" count={tariffRows.length} icon={IconTag}>
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
                <tr key={row.tariffId} className={row.isSelected ? 'bg-blue-50' : 'transition-colors hover:bg-gray-50'}>
                  <td className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-2 font-medium text-gray-900">
                      <IconTag className="h-4 w-4 text-gray-400" stroke={1.8} />
                      {row.tariffName}
                    </span>
                  </td>
                  <td className="tabular whitespace-nowrap text-right">{row.customerCount}</td>
                  <td className="tabular whitespace-nowrap text-right">{row.saleCount}</td>
                  {!isTashkiliyOnly && <td className="tabular whitespace-nowrap text-right">{formatSom(row.agreementAmount)}</td>}
                  {!isTashkiliyOnly && <td className="tabular whitespace-nowrap text-right text-emerald-700">{formatSom(row.incomeAmount)}</td>}
                  <td className="tabular whitespace-nowrap text-right font-medium text-gray-900">{formatSom(row.debtAmount)}</td>
                  {!isTashkiliyOnly && (
                    <td className="whitespace-nowrap text-right">
                      <span className="badge badge-blue tabular">{row.collectionPercent}%</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TablePanel>
      )}

      {tab === 'menejerlar' && (
        <TablePanel title="Menejerlar kesimi" count={managerRows.length} icon={IconUserStar}>
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
                <tr key={row.managerUserId} className="transition-colors hover:bg-gray-50">
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
                  <td className="tabular whitespace-nowrap text-right font-medium text-gray-900">{formatSom(row.debtAmount)}</td>
                  {!isTashkiliyOnly && (
                    <td className="whitespace-nowrap text-right">
                      <span className="badge badge-blue tabular">{row.collectionPercent}%</span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TablePanel>
      )}
    </>
  );
}
