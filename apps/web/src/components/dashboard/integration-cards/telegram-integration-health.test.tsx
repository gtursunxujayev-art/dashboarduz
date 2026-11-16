import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import IntegrationCards from '@/components/dashboard/integration-cards';

jest.mock('@/lib/trpc', () => {
  const healthRefetch = jest.fn();
  const recipientsRefetch = jest.fn();
  (globalThis as any).__telegramHealthRefetch = healthRefetch;
  (globalThis as any).__telegramRecipientsRefetch = recipientsRefetch;
  const mutationStub = () => ({ useMutation: () => ({ mutateAsync: jest.fn() }) });
  const queryStub = (data: unknown = undefined, refetch = jest.fn()) => ({
    useQuery: () => ({ data, refetch, isLoading: false, isFetching: false, error: null }),
  });
  return {
    trpc: {
      integrations: {
        list: queryStub([{ id: 'telegram-integration', type: 'telegram', status: 'active', config: {} }]),
        getAmoCRMPipelines: queryStub({ pipelines: [], hasExplicitSelection: false, selectedPipelineIds: [] }),
        getTelegramReportRecipients: queryStub({
          connected: true,
          recipients: [{
            chatId: '101', displayName: 'Agent One', username: 'agent_one', selectedForReports: false,
            firstName: 'Agent', lastName: 'One', startedAt: null, lastSeenAt: null,
          }],
          courseOptions: [],
          selectedDailyReportCourseIds: [],
        }, recipientsRefetch),
        getTelegramHealth: queryStub({
          connected: true,
          healthy: true,
          recipientCount: 1,
          expectedWebhookUrl: 'https://api.example.com/webhooks/telegram',
          liveWebhookUrl: 'https://api.example.com/webhooks/telegram',
          pendingUpdateCount: 0,
          lastInboundAt: '2026-09-14T10:00:00.000Z',
          lastErrorMessage: null,
          error: null,
        }, healthRefetch),
        connectAmoCRM: mutationStub(), connectTelegram: mutationStub(), connectVoIP: mutationStub(),
        connectFaceId: mutationStub(), updateFaceIdSettings: mutationStub(), rotateFaceIdToken: mutationStub(),
        getFaceIdStatus: queryStub(undefined), getFaceIdMappings: queryStub([]),
        upsertFaceIdMapping: mutationStub(), removeFaceIdMapping: mutationStub(),
        updateAmoCRMPipelines: mutationStub(), updateTelegramReportRecipients: mutationStub(), repairTelegramWebhook: mutationStub(),
        sendTelegramTodayReportNow: mutationStub(), sendTelegramGroupSummaryNow: mutationStub(), sendTelegramWeeklyReportNow: mutationStub(),
        sendTelegramMonthlyReportNow: mutationStub(), disconnect: mutationStub(),
      },
      users: { list: queryStub([]) },
    },
  };
});

describe('Telegram integration health', () => {
  it('shows webhook health and refreshes health and recipients together', () => {
    render(<IntegrationCards />);

    expect(screen.getByText('Telegram webhook holati')).toBeInTheDocument();
    expect(screen.getByText('Sog‘lom')).toBeInTheDocument();
    expect(screen.getByText('Foydalanuvchilar: 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yangilash' }));
    expect((globalThis as any).__telegramHealthRefetch).toHaveBeenCalled();
    expect((globalThis as any).__telegramRecipientsRefetch).toHaveBeenCalled();
  });
});
