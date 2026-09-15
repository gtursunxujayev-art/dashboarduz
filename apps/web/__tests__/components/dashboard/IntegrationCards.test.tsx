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
        getTelegramHealth: queryStub({ connected: false, healthy: false, recipientCount: 0 }),
        connectAmoCRM: mutationStub(),
        connectTelegram: mutationStub(),
        connectVoIP: mutationStub(),
        connectFaceId: mutationStub(),
        updateFaceIdSettings: mutationStub(),
        rotateFaceIdToken: mutationStub(),
        getFaceIdStatus: queryStub(undefined),
        getFaceIdMappings: queryStub([]),
        upsertFaceIdMapping: mutationStub(),
        removeFaceIdMapping: mutationStub(),
        updateAmoCRMPipelines: mutationStub(),
        updateTelegramReportRecipients: mutationStub(),
        repairTelegramWebhook: mutationStub(),
        sendTelegramTodayReportNow: mutationStub(),
        sendTelegramGroupSummaryNow: mutationStub(),
        sendTelegramWeeklyReportNow: mutationStub(),
        sendTelegramMonthlyReportNow: mutationStub(),
        disconnect: mutationStub(),
      },
      users: {
        list: queryStub([]),
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
