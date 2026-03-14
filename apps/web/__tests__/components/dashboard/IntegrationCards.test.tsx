import React from 'react';
import { render, screen } from '@testing-library/react';
import IntegrationCards from '@/components/dashboard/integration-cards';

jest.mock('@/lib/trpc', () => ({
  trpc: {
    integrations: {
      list: {
        useQuery: () => ({
          data: [],
          refetch: jest.fn(),
        }),
      },
      connectAmoCRM: {
        useMutation: () => ({ mutateAsync: jest.fn() }),
      },
      connectTelegram: {
        useMutation: () => ({ mutateAsync: jest.fn() }),
      },
      connectVoIP: {
        useMutation: () => ({ mutateAsync: jest.fn() }),
      },
      disconnect: {
        useMutation: () => ({ mutateAsync: jest.fn() }),
      },
    },
  },
}));

describe('IntegrationCards', () => {
  it('renders all MVP integration cards', () => {
    render(<IntegrationCards />);
    expect(screen.getByText('AmoCRM')).toBeInTheDocument();
    expect(screen.getByText('Telegram Bot')).toBeInTheDocument();
    expect(screen.getByText('VoIP (UTeL)')).toBeInTheDocument();
    expect(screen.getByText('Google Sheets')).toBeInTheDocument();
  });
});
