import { systemPrisma } from '@dashboarduz/db';

import { logger } from '../../lib/logger';
import { upsertTelegramRecipientRecord } from '../../services/integrations/telegram-recipient-store';
import { extractTelegramRecipientFromPayload } from '../../services/integrations/telegram-update';

export async function processTelegramWebhook(event: any, tenantId: string) {
  const payload = event.rawPayload as any;
  const integration = await systemPrisma.integration.findFirst({
    where: { tenantId, type: 'telegram' },
  });

  if (!integration) {
    return;
  }

  const recipient = extractTelegramRecipientFromPayload(payload);
  const updateId = payload?.update_id ? String(payload.update_id) : null;

  if (recipient) {
    const seenAt = new Date();

    await upsertTelegramRecipientRecord({
      tenantId,
      integrationId: integration.id,
      chatId: recipient.chatId,
      username: recipient.username,
      firstName: recipient.firstName,
      lastName: recipient.lastName,
      started: recipient.started,
      lastSeenAt: seenAt,
      lastUpdateId: updateId,
    });
    logger.info({
      tenantId,
      integrationId: integration.id,
      chatId: recipient.chatId,
      updateId,
      started: recipient.started,
    }, 'Telegram recipient processed');
  }

  await systemPrisma.integration.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() },
  });
}
