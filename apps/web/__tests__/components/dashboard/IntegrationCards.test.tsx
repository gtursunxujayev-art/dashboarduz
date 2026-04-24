import React from 'react';
import { render, screen } from '@testing-library/react';
import IntegrationCards from '@/components/dashboard/integration-cards';

jest.mock('@/lib/trpc', () => {
  const mutationStub = () => ({ useMutation: () => ({ mutateAsync: jest.fn() }) });
  const queryStub = (data: unknown = undefined) => ({
    useQuery: () => ({ data, refetch: jest.fn(), isLoading: false }),
  });

  return {
    trpc: {
      integrations: {
        list: queryStub([]),
        getAmoCRMPipelines: queryStub({ pipelines: [], hasExplicitSelection: false, selectedPipelineIds: [] }),
        getTelegramReportRecipients: queryStub({ connected: false, recipients: [] }),
        connectAmoCRM: mutationStub(),
        connectTelegram: mutationStub(),
        connectVoIP: mutationStub(),
        updateAmoCRMPipelines: mutationStub(),
        updateTelegramReportRecipients: mutationStub(),
        sendTelegramTodayReportNow: mutationStub(),
        sendTelegramWeeklyReportNow: mutationStub(),
        sendTelegramMonthlyReportNow: mutationStub(),
        disconnect: mutationStub(),
      },
    },
  };
});

describe('IntegrationCards', () => {
  it('renders all MVP integration cards', () => {
    render(<IntegrationCards />);
    expect(screen.getByText('AmoCRM')).toBeInTheDocument();
    expect(screen.getByText('Telegram Bot')).toBeInTheDocument();
    expect(screen.getByText('VoIP (Webhook)')).toBeInTheDocument();
    expect(screen.getByText('Google Sheets')).toBeInTheDocument();
  });
});
