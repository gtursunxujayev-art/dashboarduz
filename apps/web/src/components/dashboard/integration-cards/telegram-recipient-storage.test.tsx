import React from 'react';
import { render, screen } from '@testing-library/react';
import IntegrationCards from '@/components/dashboard/integration-cards';

jest.mock('@/lib/trpc', () => {
  const mutationStub = () => ({ useMutation: () => ({ mutateAsync: jest.fn() }) });
  const queryStub = (data: unknown = undefined) => ({
    useQuery: () => ({ data, refetch: jest.fn(), isLoading: false, isFetching: false, error: null }),
  });
  return {
    trpc: {
      integrations: {
        list: queryStub([{ id: 'telegram-integration', type: 'telegram', status: 'active', config: {} }]),
        getAmoCRMPipelines: queryStub({ pipelines: [], hasExplicitSelection: false, selectedPipelineIds: [] }),
        getTelegramReportRecipients: queryStub({
          connected: true,
          recipientStorageReady: false,
          recipientError: "Railway'da `npm run db:migrate:deploy` ni ishga tushiring.",
          recipients: [],
          courseOptions: [{ id: 'course-1', name: 'Intensiv', category: 'intensive', isActive: true }],
          selectedDailyReportCourseIds: [],
        }),
        getTelegramHealth: queryStub({
          connected: true, healthy: false, recipientCount: 0, recipientStorageReady: false,
          recipientError: 'Recipient storage unavailable', onlineGroupCount: 1, offlineGroupCount: 1,
          schedulerReady: true, expectedWebhookUrl: 'https://api.example.com/webhooks/telegram',
          liveWebhookUrl: 'https://api.example.com/webhooks/telegram', pendingUpdateCount: 0,
          lastInboundAt: null, lastErrorMessage: null, error: null,
        }),
        connectAmoCRM: mutationStub(), connectTelegram: mutationStub(), connectVoIP: mutationStub(),
        connectFaceId: mutationStub(), updateFaceIdSettings: mutationStub(), rotateFaceIdToken: mutationStub(),
        getFaceIdStatus: queryStub(undefined), getFaceIdMappings: queryStub([]),
        upsertFaceIdMapping: mutationStub(), removeFaceIdMapping: mutationStub(),
        updateAmoCRMPipelines: mutationStub(), updateTelegramReportRecipients: mutationStub(), repairTelegramWebhook: mutationStub(),
        sendTelegramTodayReportNow: mutationStub(), sendTelegramGroupSummaryNow: mutationStub(),
        sendTelegramWeeklyReportNow: mutationStub(), sendTelegramMonthlyReportNow: mutationStub(),
        disconnect: mutationStub(),
      },
      users: { list: queryStub([]) },
    },
  };
});

describe('Telegram recipient storage diagnostics', () => {
  it('shows the deployment warning without hiding report course options', () => {
    render(<IntegrationCards />);
    expect(screen.getByText('Telegram foydalanuvchilari ombori tayyor emas')).toBeInTheDocument();
    expect(screen.queryByText(/Hozircha foydalanuvchi yo'q/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'Intensiv' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Bugungi guruh hisobotini hozir yuborish' })).toBeEnabled();
  });
});
