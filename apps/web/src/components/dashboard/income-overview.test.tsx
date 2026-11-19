import React from 'react';
import { render, screen } from '@testing-library/react';
import DashboardIncomeOverview from '@/components/dashboard/income-overview';

jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/trpc', () => ({
  trpc: {
    dashboard: {
      incomeOverview: {
        useQuery: () => ({
          isLoading: false,
          error: null,
          data: {
            daily: { online: 1_000, offline: 2_000, other: 0 },
            weekly: { online: 10_000, offline: 20_000, other: 0 },
            monthly: { online: 179_565_000, offline: 195_400_000, other: 18_850_000 },
          },
        }),
      },
    },
  },
}));

describe('DashboardIncomeOverview', () => {
  it('counts every category in the monthly total, with a third part for the rest', () => {
    render(<DashboardIncomeOverview />);

    // Same total as the income dynamics chart.
    expect(screen.getByText("393 815 000 so'm")).toBeInTheDocument();
    expect(screen.getByText('Intensiv va boshqa')).toBeInTheDocument();
    expect(screen.getByText("18 850 000 so'm")).toBeInTheDocument();
  });

  it('keeps two parts when there is no other income', () => {
    render(<DashboardIncomeOverview />);

    // Only the monthly card has "other" income here.
    expect(screen.getAllByText('Intensiv va boshqa')).toHaveLength(1);
    expect(screen.getByText("3 000 so'm")).toBeInTheDocument();
  });
});
