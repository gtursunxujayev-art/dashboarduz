import { systemPrisma } from '@dashboarduz/db';
import { Router, type Request, type Response } from 'express';

import { asyncRoute } from '../lib/express-async';
import { logger } from '../lib/logger';
import { upsertTelegramRecipientRecord } from '../services/integrations/telegram-recipient-store';
import { extractTelegramRecipientFromPayload } from '../services/integrations/telegram-update';
import { rateLimiter } from '../services/security/rate-limiter';

import { telegramWebhookEventType, telegramWebhookUpdateId, webhookPayloadJson } from './payloads';
import { buildWebhookIdempotencyKey, enqueueWebhookJob, getRawBody, isUniqueViolation } from './shared';

const router = Router();

router.get('/telegram', (_req: Request, res: Response) => {
  return res.status(200).json({
    ok: true,
    endpoint: '/webhooks/telegram',
    method: 'POST',
    message: 'Telegram webhook endpoint is alive. Telegram will send POST requests here.',
    requiredHeader: 'x-telegram-bot-api-secret-token',
  });
});

router.post('/telegram', asyncRoute(async (req: Request, res: Response) => {
  try {
    const rawBody = getRawBody(req);
    const body: unknown = req.body;
    const secretToken = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;

    if (!secretToken) {
      return res.status(403).json({ error: 'Missing Telegram secret token' });
    }

    const integration = await systemPrisma.integration.findFirst({
      where: {
        type: 'telegram',
        status: 'active',
        config: {
          path: ['webhookSecret'],
          equals: secretToken,
        },
      },
    });

    if (!integration) {
      return res.status(404).json({ error: 'Integration not found' });
    }

    const webhookLimit = await rateLimiter.isAllowed(integration.tenantId, 'webhook:telegram', {
      maxRequests: 300,
      windowMs: 60 * 1000,
      keyPrefix: 'webhook',
    });

    if (!webhookLimit.allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    const idempotencyKey = buildWebhookIdempotencyKey('telegram', integration.tenantId, rawBody);
    const eventType = telegramWebhookEventType(body);
    const recipient = extractTelegramRecipientFromPayload(body);

    if (recipient) {
      try {
        const updateId = telegramWebhookUpdateId(body);
        const seenAt = new Date();

        await upsertTelegramRecipientRecord({
          tenantId: integration.tenantId,
          integrationId: integration.id,
          chatId: recipient.chatId,
          username: recipient.username,
          firstName: recipient.firstName,
          lastName: recipient.lastName,
          started: recipient.started,
          lastSeenAt: seenAt,
          lastUpdateId: updateId,
        }, systemPrisma);
        await systemPrisma.integration.update({
          where: { id: integration.id },
          data: { lastSyncAt: seenAt },
        });
        logger.info({
          tenantId: integration.tenantId,
          integrationId: integration.id,
          chatId: recipient.chatId,
          updateId,
          started: recipient.started,
        }, 'Telegram recipient discovered');
      } catch (error) {
        logger.warn({ err: error, integrationId: integration.id }, 'Failed to upsert Telegram recipient synchronously');
      }
    }

    let event;

    try {
      event = await systemPrisma.webhookEvent.create({
        data: {
          tenantId: integration.tenantId,
          source: 'telegram',
          eventType,
          idempotencyKey,
          rawPayload: webhookPayloadJson(body),
          processed: false,
        },
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        logger.info({ msg: 'Duplicate Telegram webhook ignored', idempotencyKey });

        return res.status(200).json({ received: true, duplicate: true });
      }
      throw error;
    }

    await enqueueWebhookJob({
      jobName: 'process-telegram-webhook',
      eventId: event.id,
      tenantId: integration.tenantId,
      idempotencyKey,
    });

    await systemPrisma.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: 'webhook_received',
        resource: 'webhook',
        resourceId: event.id,
        metadata: { source: 'telegram', eventType },
      },
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Telegram webhook handler failed');

    return res.status(500).json({ error: 'Internal server error' });
  }
}));

export { router as telegramWebhookRouter };
