import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AmoLeadSnapshotRefresh, formatSnapshotAge } from '@/components/dashboard/amo-lead-snapshot-refresh';

const refreshMock = jest.fn();
const invalidateMock = jest.fn().mockResolvedValue(undefined);
let statusData: Record<string, unknown> | undefined;

jest.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ invalidate: invalidateMock }),
    integrations: {
      getAmoLeadSnapshotStatus: { useQuery: () => ({ data: statusData, refetch: jest.fn() }) },
      refreshAmoLeadSnapshot: { useMutation: () => ({ mutateAsync: refreshMock, isLoading: false }) },
    },
  },
}));

const NOW = new Date('2026-11-17T10:00:00.000Z').getTime();

describe('formatSnapshotAge', () => {
  it('describes how old the snapshot is in Uzbek', () => {
    expect(formatSnapshotAge(null, NOW)).toBe('hali yangilanmagan');
    expect(formatSnapshotAge('2026-11-17T09:59:40.000Z', NOW)).toBe('hozirgina');
    expect(formatSnapshotAge('2026-11-17T09:35:00.000Z', NOW)).toBe('25 daqiqa oldin');
    expect(formatSnapshotAge('2026-11-17T07:00:00.000Z', NOW)).toBe('3 soat oldin');
  });
});

describe('AmoLeadSnapshotRefresh', () => {
  beforeEach(() => {
    refreshMock.mockReset();
    invalidateMock.mockClear();
  });

  it('lets an admin refresh now and reloads the dashboard data', async () => {
    statusData = { connected: true, lastRefreshedAt: new Date().toISOString(), lastError: null, refreshing: false, refreshIntervalMinutes: 60 };
    refreshMock.mockResolvedValue({ status: 'refreshed', refreshedAt: new Date().toISOString() });
    render(<AmoLeadSnapshotRefresh isAdmin />);

    const button = screen.getByRole('button', { name: "amoCRM ma'lumotlarini hozir yangilash" });

    expect(button).toHaveTextContent('amoCRM: hozirgina');
    await act(async () => {
      fireEvent.click(button);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalled();
  });

  it('shows the error the server returns, such as the rate limit', async () => {
    statusData = { connected: true, lastRefreshedAt: null, lastError: null, refreshing: false, refreshIntervalMinutes: 60 };
    refreshMock.mockRejectedValue(new Error("Ma'lumotlar yaqinda yangilandi. Birozdan keyin qayta urinib ko'ring."));
    render(<AmoLeadSnapshotRefresh isAdmin />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('yaqinda yangilandi');
  });

  it('shows only the refresh time to non-admins, and nothing without amoCRM', () => {
    statusData = { connected: true, lastRefreshedAt: null, lastError: null, refreshing: false, refreshIntervalMinutes: 60 };
    const { rerender } = render(<AmoLeadSnapshotRefresh isAdmin={false} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('amoCRM: hali yangilanmagan')).toBeInTheDocument();

    statusData = { connected: false };
    rerender(<AmoLeadSnapshotRefresh isAdmin={false} />);
    expect(screen.queryByTestId('amo-lead-snapshot-refresh')).toBeNull();
  });
});
