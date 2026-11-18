import { systemPrisma } from '@dashboarduz/db';

import * as faceIdService from '../../../services/attendance/faceid';
import * as recipientStore from '../../../services/integrations/telegram-recipient-store';
import { processFaceIdWebhook } from '../faceid-webhook';
import { processTelegramWebhook } from '../telegram-webhook';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('processTelegramWebhook', () => {
  it('stores the recipient of a private message and touches the integration', async () => {
    jest.spyOn(systemPrisma.integration, 'findFirst').mockResolvedValue({ id: 'int-1' } as never);
    const upsert = jest.spyOn(recipientStore, 'upsertTelegramRecipientRecord').mockResolvedValue(undefined as never);
    const update = jest.spyOn(systemPrisma.integration, 'update').mockResolvedValue({} as never);

    await processTelegramWebhook({
      rawPayload: { update_id: 77, message: { chat: { id: 42, type: 'private', first_name: 'Ali' }, text: 'hi' } },
    }, 'tenant-1');

    expect(upsert).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      integrationId: 'int-1',
      chatId: '42',
      username: null,
      firstName: 'Ali',
      lastName: null,
      started: true,
      lastSeenAt: expect.any(Date),
      lastUpdateId: '77',
    }, systemPrisma);
    expect(update).toHaveBeenCalledWith({ where: { id: 'int-1' }, data: { lastSyncAt: expect.any(Date) } });
  });

  it('touches the integration only, for an update without a private chat', async () => {
    jest.spyOn(systemPrisma.integration, 'findFirst').mockResolvedValue({ id: 'int-1' } as never);
    const upsert = jest.spyOn(recipientStore, 'upsertTelegramRecipientRecord');
    const update = jest.spyOn(systemPrisma.integration, 'update').mockResolvedValue({} as never);

    await processTelegramWebhook({ rawPayload: { update_id: 1, message: { chat: { id: -5, type: 'group' } } } }, 'tenant-1');

    expect(upsert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a telegram integration', async () => {
    const findFirst = jest.spyOn(systemPrisma.integration, 'findFirst').mockResolvedValue(null);
    const update = jest.spyOn(systemPrisma.integration, 'update');

    await processTelegramWebhook({ rawPayload: {} }, 'tenant-1');

    expect(findFirst).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1', type: 'telegram' } });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('processFaceIdWebhook', () => {
  it('ingests the stored payload with the integration config', async () => {
    jest.spyOn(systemPrisma.integration, 'findFirst').mockResolvedValue({ config: { branches: ['main'] } } as never);
    const ingest = jest.spyOn(faceIdService, 'ingestFaceIdEvent').mockResolvedValue({ ignored: true });

    await processFaceIdWebhook({ rawPayload: { event_type: 'check_in' } }, 'tenant-1');

    expect(ingest).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      integrationConfig: { branches: ['main'] },
      payload: { event_type: 'check_in' },
    });
  });

  it('fails without an active Face ID integration', async () => {
    jest.spyOn(systemPrisma.integration, 'findFirst').mockResolvedValue(null);

    await expect(processFaceIdWebhook({ rawPayload: {} }, 'tenant-1')).rejects.toThrow('No active Face ID integration found');
  });
});
