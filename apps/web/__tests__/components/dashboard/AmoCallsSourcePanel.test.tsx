import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AmoCallsSourcePanel } from '@/components/dashboard/amo-calls-source-panel';

const setSourceMock = jest.fn().mockResolvedValue({ success: true });
let statusData: Record<string, unknown> = {};

jest.mock('@/lib/trpc', () => ({
  trpc: {
    integrations: {
      getCallsSource: { useQuery: () => ({ data: statusData, refetch: jest.fn() }) },
      setCallsSource: { useMutation: () => ({ mutateAsync: setSourceMock, isLoading: false }) },
      syncAmoCallsNow: { useMutation: () => ({ mutateAsync: jest.fn(), isLoading: false }) },
    },
  },
}));

describe('AmoCallsSourcePanel', () => {
  beforeEach(() => setSourceMock.mockClear());

  it('switches the calls source to amoCRM', () => {
    statusData = { amoConnected: true, source: 'utel', importedCalls: 0, backfillComplete: false };
    render(<AmoCallsSourcePanel />);
    expect(screen.getByRole('radio', { name: 'Utel webhook' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'AmoCRM' }));
    expect(setSourceMock).toHaveBeenCalledWith({ source: 'amocrm' });
    expect(screen.queryByText(/Hozir sinxronlash/)).toBeNull();
  });

  it('shows sync progress while amoCRM is the source', () => {
    statusData = {
      amoConnected: true,
      source: 'amocrm',
      importedCalls: 1234,
      backfillComplete: false,
      lastRunAt: '2026-11-07T10:00:00Z',
      syncedUntil: '2026-11-07T09:55:00Z',
      lastError: 'Failed to fetch AmoCRM notes: 429',
    };
    render(<AmoCallsSourcePanel />);
    expect(screen.getByText(/yuklanmoqda — raqamlar hali to'liq emas/)).toBeInTheDocument();
    expect(screen.getByText(/429/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hozir sinxronlash' })).toBeInTheDocument();
  });
});
