'use client';

import VirtualTable from '@/components/ui/VirtualTable';
import LoadingBlock from '@/components/dashboard/loading-block';

type DashboardRange = 'today' | 'week' | 'month' | 'custom';

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
  const crmReason = (() => {
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
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="rounded-lg bg-white shadow">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="mb-4 text-lg font-medium leading-6 text-gray-900">Sotuvchilar</h3>
          {crmUnavailable && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">AmoCRM faoliyat ma&apos;lumotlari to&apos;liq yuklanmadi.</p>
                  {unmappedSellerNames.length > 0 && (
                    <p className="mt-1">
                      AmoCRM menejeri biriktirilmagan: {unmappedSellerNames.join(', ')}.
                    </p>
                  )}
                  {crmReason && <p className="mt-1">{crmReason}</p>}
                </div>
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={isRetrying}
                  className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-slate-800"
                >
                  {isRetrying ? 'Yuklanmoqda...' : 'Qayta urinish'}
                </button>
              </div>
            </div>
          )}
          {isLoading ? (
            <LoadingBlock message="Sotuvchilar ma'lumoti yuklanmoqda..." />
          ) : sellerPerformance.length ? (
            <VirtualTable
              rows={sellerPerformance}
              containerClassName="overflow-x-auto"
              getRowKey={(seller: any) => seller.userId}
              headerContent={
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Ism</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Sotuv</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Follow-up</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Yozuvlar</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Bosqich o&apos;zgarishi</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Muddati o&apos;tgan F/U</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">{getPeriodFollowUpLabel(range)}</th>
                  {!isTashkiliyOnly && (
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Shartnoma summasi</th>
                  )}
                  {!isTashkiliyOnly && (
                    <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Tushum summasi</th>
                  )}
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">Suhbat vaqti</th>
                </tr>
              }
              renderRowCells={(seller: any) => (
                <>
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-900">{seller.name}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                    {renderMetricValue(seller.sales)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                    {renderMetricValue(seller.followUpCount)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                    {renderMetricValue(seller.noteCount)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                    {renderMetricValue(seller.stageChangeCount)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                    {renderMetricValue(seller.overdueFollowUpCount)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                    {renderMetricValue(seller.todayFollowUpCount)}
                  </td>
                  {!isTashkiliyOnly && (
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {seller.agreementsAmount === null || seller.agreementsAmount === undefined
                        ? '-'
                        : formatAmount(seller.agreementsAmount)}
                    </td>
                  )}
                  {!isTashkiliyOnly && (
                    <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                      {seller.incomeAmount === null || seller.incomeAmount === undefined
                        ? '-'
                        : formatAmount(seller.incomeAmount)}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
                    {formatDuration(seller.talkedSeconds)}
                  </td>
                </>
              )}
            />
          ) : (
            <p className="text-sm text-gray-600">Tanlangan filtrlar bo'yicha sotuvchi ma'lumoti topilmadi.</p>
          )}
        </div>
      </div>
    </div>
  );
}
