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
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="rounded-lg bg-white shadow">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="mb-4 text-lg font-medium leading-6 text-gray-900">Sotuvchilar</h3>
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
