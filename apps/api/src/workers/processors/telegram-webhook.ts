import { systemPrisma } from '@dashboarduz/db';
import type { WebhookEvent } from '@prisma/client';

import { logger } from '../../lib/logger';
import { upsertTelegramRecipientRecord } from '../../services/integrations/telegram-recipient-store';
import { extractTelegramRecipientFromPayload } from '../../services/integrations/telegram-update';
import { telegramWebhookUpdateId } from '../../webhooks/payloads';

export async function processTelegramWebhook(event: Pick<WebhookEvent, 'rawPayload'>, tenantId: string) {
  const payload = event.rawPayload;
  const integration = await systemPrisma.integration.findFirst({
    where: { tenantId, type: 'telegram' },
  });

  if (!integration) {
    return;
  }

  const recipient = extractTelegramRecipientFromPayload(payload);
  const updateId = telegramWebhookUpdateId(payload);

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
    }, systemPrisma);
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
