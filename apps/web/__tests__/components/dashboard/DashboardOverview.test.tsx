import React from 'react';
import { render, screen } from '@testing-library/react';
import DashboardIncomeOverview from '@/components/dashboard/income-overview';
import DashboardSelectedCourses from '@/components/dashboard/selected-courses';

jest.mock('@/lib/trpc', () => ({
  trpc: {
    dashboard: {
      incomeOverview: {
        useQuery: () => ({
          isLoading: false,
          error: null,
          data: {
            daily: { online: 2_000_000, offline: 3_000_000 },
            weekly: { online: 10_000_000, offline: 12_000_000 },
            monthly: { online: 40_000_000, offline: 50_000_000 },
          },
        }),
      },
      selectedCourseOverview: {
        useQuery: () => ({
          isLoading: false,
          error: null,
          data: {
            online: {
              courseId: 'online', name: 'Online-Sentyabr', salesCount: 49, agreementAmount: 76_900_000,
              tariffs: [{ tariffId: 'premium', name: 'Premium', salesCount: 16 }],
            },
            offline: null,
            intensive: {
              courseId: 'intensive', name: 'Intensiv-2026', salesCount: 21, agreementAmount: 33_300_000,
              tariffs: [],
            },
          },
        }),
      },
    },
  },
}));

describe('dashboard overview cards', () => {
  it('renders fixed-period totals and Online/Ofline splits', () => {
    render(<DashboardIncomeOverview />);

    expect(screen.getByText('Kunlik tushum')).toBeInTheDocument();
    expect(screen.getByText("5 000 000 so'm")).toBeInTheDocument();
    expect(screen.getByText("22 000 000 so'm")).toBeInTheDocument();
    expect(screen.getByText("90 000 000 so'm")).toBeInTheDocument();
    expect(screen.getAllByText('Online')).toHaveLength(3);
    expect(screen.getAllByText('Ofline')).toHaveLength(3);
  });

  it('renders selected courses, tariff data, and empty states', () => {
    render(<DashboardSelectedCourses />);

    expect(screen.getByText(/Online-Sentyabr/)).toHaveTextContent('Online-Sentyabr - 49');
    expect(screen.getByText('Premium -')).toHaveTextContent('Premium - 16');
    expect(screen.getByText(/Intensiv-2026/)).toHaveTextContent('Intensiv-2026 - 21');
    expect(screen.getByText("Tarif ma'lumoti topilmadi.")).toBeInTheDocument();
    expect(screen.getByText('Tanlangan kurs topilmadi.')).toBeInTheDocument();
  });
});
