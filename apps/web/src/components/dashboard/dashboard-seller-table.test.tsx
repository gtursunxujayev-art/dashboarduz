import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DashboardSellerTable from '@/components/dashboard/dashboard-seller-table';

jest.mock('@/components/ui/virtual-table', () => ({
  __esModule: true,
  default: ({ rows, headerContent, renderRowCells }: any) => (
    <table><thead>{headerContent}</thead><tbody>{rows.map((row: any) => <tr key={row.userId}>{renderRowCells(row)}</tr>)}</tbody></table>
  ),
}));

describe('DashboardSellerTable CRM availability', () => {
  it('shows dashes and a retryable warning for unavailable CRM metrics', () => {
    const retry = jest.fn();
    render(
      <DashboardSellerTable
        isLoading={false}
        sellerPerformance={[{
          userId: '1', name: 'Agent A', sales: 2, agreementsAmount: 100, incomeAmount: 50,
          talkedSeconds: 0, callsCount: 0, longCallsCount: 0, followUpCount: null, noteCount: null, stageChangeCount: null,
          overdueFollowUpCount: null, todayFollowUpCount: null,
        }]}
        isTashkiliyOnly={false}
        range="week"
        formatAmount={(value) => String(value)}
        formatDuration={(value) => String(value)}
        renderMetricValue={(value) => value === null || value === undefined ? '-' : String(value)}
        getPeriodFollowUpLabel={() => 'Haftalik F/U'}
        crmSourceStatus={{ state: 'partial', reason: 'mapping_missing' }}
        unmappedSellerNames={['Agent A']}
        onRetry={retry}
        isRetrying={false}
      />,
    );

    expect(screen.getByText(/AmoCRM faoliyat ma'lumotlari to'liq yuklanmadi/)).toBeInTheDocument();
    expect(screen.getAllByText(/Agent A/)).toHaveLength(2);
    expect(screen.getAllByText('-')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Qayta urinish' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows calls and 4+ minute calls right before talk time, 0 as 0', () => {
    render(
      <DashboardSellerTable
        isLoading={false}
        sellerPerformance={[
          { userId: '1', name: 'Agent A', sales: 1, callsCount: 12, longCallsCount: 5, talkedSeconds: 3600, followUpCount: 0, noteCount: 0, stageChangeCount: 0, overdueFollowUpCount: 0, todayFollowUpCount: 0 },
          { userId: '2', name: 'Agent B', sales: 0, callsCount: 0, longCallsCount: 0, talkedSeconds: 0, followUpCount: 0, noteCount: 0, stageChangeCount: 0, overdueFollowUpCount: 0, todayFollowUpCount: 0 },
        ]}
        isTashkiliyOnly={false}
        range="month"
        formatAmount={(value) => String(value)}
        formatDuration={(value) => `${value}s`}
        renderMetricValue={(value) => value === null || value === undefined ? '-' : String(value)}
        getPeriodFollowUpLabel={() => 'Oylik F/U'}
        onRetry={jest.fn()}
        isRetrying={false}
      />,
    );

    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    const [rowA, rowB] = screen.getAllByRole('row').slice(1).map((row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent));

    expect(headers.slice(-3)).toEqual(["Qo'ng'iroqlar", "4 daq+ qo'ng'iroqlar", 'Suhbat vaqti']);
    expect(rowA?.slice(-3)).toEqual(['12', '5', '3600s']);
    expect(rowB?.slice(-3)).toEqual(['0', '0', '0s']);
  });

  it('says activity is still loading instead of failed', () => {
    render(
      <DashboardSellerTable
        isLoading={false}
        sellerPerformance={[]}
        isTashkiliyOnly={false}
        range="today"
        formatAmount={(value) => String(value)}
        formatDuration={(value) => String(value)}
        renderMetricValue={(value) => String(value ?? '-')}
        getPeriodFollowUpLabel={() => 'Bugungi F/U'}
        crmSourceStatus={{ state: 'partial', reason: 'activity_loading' }}
        onRetry={jest.fn()}
        isRetrying={false}
      />,
    );

    expect(screen.getByText(/AmoCRM faoliyat ma'lumotlari yuklanmoqda/)).toBeInTheDocument();
    expect(screen.getByText(/fonda yuklanmoqda/)).toBeInTheDocument();
    expect(screen.queryByText(/to'liq yuklanmadi/)).toBeNull();
  });
});
