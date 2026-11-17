'use client';

import { IconAlertTriangle, IconRefresh, IconUsersGroup } from '@tabler/icons-react';
import VirtualTable from '@/components/ui/virtual-table';
import { EmptyState } from '@/components/ui/empty-state';
import { UserAvatar } from '@/components/ui/user-avatar';
import LoadingBlock from '@/components/dashboard/loading-block';
import { type ReportRangePreset as DashboardRange } from '@dashboarduz/shared';


type Props = {
  isLoading: boolean;
  sellerPerformance: any[];
  isTashkiliyOnly: boolean;
  range: DashboardRange;
  formatAmount: (value?: number | null) => string;
  formatDuration: (seconds?: number | null) => string;
  renderMetricValue: (value?: number | null, suffix?: string) => string;
  getPeriodFollowUpLabel: (range: DashboardRange) => string;
  crmSourceStatus?: {
    state?: 'ok' | 'partial' | 'unavailable' | 'timeout' | 'mapping_missing';
    reason?: string | null;
  };
  unmappedSellerNames?: string[];
  onRetry: () => void;
  isRetrying: boolean;
};

export default function DashboardSellerTable({
  isLoading,
  sellerPerformance,
  isTashkiliyOnly,
  range,
  formatAmount,
  formatDuration,
  renderMetricValue,
  getPeriodFollowUpLabel,
  crmSourceStatus,
  unmappedSellerNames = [],
  onRetry,
  isRetrying,
}: Props) {
  const crmUnavailable = crmSourceStatus?.state && crmSourceStatus.state !== 'ok';
  const crmLoading = Boolean(crmSourceStatus?.reason?.includes('activity_loading'));
  const crmReason = (() => {
    if (crmLoading) {
      return "AmoCRM faoliyat ma'lumotlari (vazifalar, izohlar, bosqichlar) fonda yuklanmoqda — bir necha soniyadan so'ng avtomatik ko'rinadi.";
    }
    if (crmSourceStatus?.state === 'timeout' || crmSourceStatus?.reason?.includes('timeout')) {
      return 'AmoCRM javob berish vaqti tugadi.';
    }
    if (crmSourceStatus?.reason?.includes('network_error')) {
      return 'AmoCRM bilan tarmoq aloqasida xatolik yuz berdi.';
    }
    if (crmSourceStatus?.reason?.includes('amo_unavailable')) {
      return 'AmoCRM integratsiyasi mavjud emas yoki faol emas.';
    }
    if (crmSourceStatus?.reason?.includes('fetch_failed')) {
      return "AmoCRM vazifa yoki hodisa so'rovini qaytarmadi.";
    }
    return null;
  })();
  // Leader's sales, so each row can show a small bar against the best result.
  const maxSales = sellerPerformance.reduce((max, seller: any) => Math.max(max, Number(seller?.sales ?? 0)), 0);
  return (
    <section className="panel overflow-hidden">
      <div className="panel-header">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <IconUsersGroup className="h-4 w-4" stroke={1.8} />
          </span>
          <h3 className="section-title">Sotuvchilar</h3>
          {!isLoading && sellerPerformance.length > 0 && (
            <span className="badge badge-neutral tabular">{sellerPerformance.length}</span>
          )}
        </div>
      </div>
      <div className="space-y-4 px-2 pb-2 pt-4 sm:px-3">
        {crmUnavailable && (
          <div className="alert alert-warning mx-2 sm:mx-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <IconAlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" stroke={1.8} />
                <div className="min-w-0">
                  <p className="font-semibold">
                    {crmLoading
                      ? <>AmoCRM faoliyat ma&apos;lumotlari yuklanmoqda.</>
                      : <>AmoCRM faoliyat ma&apos;lumotlari to&apos;liq yuklanmadi.</>}
                  </p>
                  {unmappedSellerNames.length > 0 && (
                    <p className="mt-1">
                      AmoCRM menejeri biriktirilmagan: {unmappedSellerNames.join(', ')}.
                    </p>
                  )}
                  {crmReason && <p className="mt-1">{crmReason}</p>}
                </div>
              </div>
              <button
                type="button"
                onClick={onRetry}
                disabled={isRetrying}
                className="btn btn-sm btn-secondary"
              >
                <IconRefresh className={`h-3.5 w-3.5 ${isRetrying ? 'animate-spin' : ''}`} stroke={1.8} />
                {isRetrying ? 'Yuklanmoqda...' : 'Qayta urinish'}
              </button>
            </div>
          </div>
        )}
        {isLoading ? (
          <LoadingBlock message="Sotuvchilar ma'lumoti yuklanmoqda..." className="m-1" />
        ) : sellerPerformance.length ? (
          <VirtualTable
            rows={sellerPerformance}
            tableClassName="data-table"
            containerClassName="overflow-x-auto"
            getRowKey={(seller: any) => seller.userId}
            headerContent={
              <tr>
                <th>Ism</th>
                <th className="text-right">Sotuv</th>
                <th className="text-right">Follow-up</th>
                <th className="text-right">Yozuvlar</th>
                <th className="text-right">Bosqich o&apos;zgarishi</th>
                <th className="text-right">Muddati o&apos;tgan F/U</th>
                <th className="text-right">{getPeriodFollowUpLabel(range)}</th>
                {!isTashkiliyOnly && (
                  <th className="text-right">Shartnoma summasi</th>
                )}
                {!isTashkiliyOnly && (
                  <th className="text-right">Tushum summasi</th>
                )}
                <th className="text-right">Suhbat vaqti</th>
              </tr>
            }
            renderRowCells={(seller: any) => (
              <>
                <td className="whitespace-nowrap">
                  <div className="flex items-center gap-3">
                    <UserAvatar name={String(seller.name || '?')} />
                    <span className="font-medium text-gray-900">{seller.name}</span>
                  </div>
                </td>
                <td className="tabular whitespace-nowrap text-right font-semibold text-gray-900">
                  <span className="block">{renderMetricValue(seller.sales)}</span>
                  <span className="ml-auto mt-1.5 block h-1 w-16 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                    <span
                      className="block h-full rounded-full bg-blue-600"
                      style={{ width: `${maxSales > 0 ? Math.min(100, (Number(seller.sales ?? 0) / maxSales) * 100) : 0}%` }}
                    />
                  </span>
                </td>
                <td className="tabular whitespace-nowrap text-right">
                  {renderMetricValue(seller.followUpCount)}
                </td>
                <td className="tabular whitespace-nowrap text-right">
                  {renderMetricValue(seller.noteCount)}
                </td>
                <td className="tabular whitespace-nowrap text-right">
                  {renderMetricValue(seller.stageChangeCount)}
                </td>
                <td className={`tabular whitespace-nowrap text-right ${(seller.overdueFollowUpCount ?? 0) > 0 ? 'font-medium text-amber-700' : ''}`}>
                  {renderMetricValue(seller.overdueFollowUpCount)}
                </td>
                <td className="tabular whitespace-nowrap text-right">
                  {renderMetricValue(seller.todayFollowUpCount)}
                </td>
                {!isTashkiliyOnly && (
                  <td className="tabular whitespace-nowrap text-right">
                    {seller.agreementsAmount === null || seller.agreementsAmount === undefined
                      ? '-'
                      : formatAmount(seller.agreementsAmount)}
                  </td>
                )}
                {!isTashkiliyOnly && (
                  <td className="tabular whitespace-nowrap text-right font-medium text-gray-900">
                    {seller.incomeAmount === null || seller.incomeAmount === undefined
                      ? '-'
                      : formatAmount(seller.incomeAmount)}
                  </td>
                )}
                <td className="tabular whitespace-nowrap text-right">
                  {formatDuration(seller.talkedSeconds)}
                </td>
              </>
            )}
          />
        ) : (
          <EmptyState title="Tanlangan filtrlar bo'yicha sotuvchi ma'lumoti topilmadi." icon={IconUsersGroup} className="m-1" />
        )}
      </div>
    </section>
  );
}
