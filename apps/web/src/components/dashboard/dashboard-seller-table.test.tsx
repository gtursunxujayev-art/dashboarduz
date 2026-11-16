import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import DashboardSellerTable from '@/components/dashboard/DashboardSellerTable';

jest.mock('@/components/ui/VirtualTable', () => ({
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
          talkedSeconds: 0, followUpCount: null, noteCount: null, stageChangeCount: null,
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
});
