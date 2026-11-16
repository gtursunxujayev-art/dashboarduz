import { systemPrisma } from '@dashboarduz/db';

import { logger } from '../../lib/logger';
import { reportError } from '../../services/observability';

import { processAmoCRMWebhook } from './amocrm-webhook';
import { processFaceIdWebhook } from './faceid-webhook';
import { processTelegramWebhook } from './telegram-webhook';
import { processVoIPWebhook } from './voip-webhook';

export async function processWebhookEvent(eventId: string) {
  let tenantIdForAudit: string | null = null;

  try {
    logger.info({ eventId }, 'Processing webhook event');
    const event = await systemPrisma.webhookEvent.findUnique({ where: { id: eventId } });

    if (!event) {
      throw new Error(`Webhook event ${eventId} not found`);
    }

    if (event.processed) {
      logger.warn({ eventId }, 'Webhook event already processed');

      return;
    }

    let tenantId = event.tenantId;

    if (!tenantId && event.source === 'amocrm') {
      const accountId = (event.rawPayload as any)?.account?.id ?? (event.rawPayload as any)?.account_id;

      if (accountId) {
        const integration = await systemPrisma.integration.findFirst({
          where: {
            type: 'amocrm',
            config: {
              path: ['account_id'],
              equals: String(accountId),
            },
          },
        });

        tenantId = integration?.tenantId || null;
      }
    }

    if (!tenantId) {
      await systemPrisma.webhookEvent.update({
        where: { id: eventId },
        data: {
          processed: true,
          errorMessage: 'Cannot determine tenant',
        },
      });

      return;
    }

    tenantIdForAudit = tenantId;

    switch (event.source) {
      case 'amocrm':
        await processAmoCRMWebhook(event, tenantId);
        break;
      case 'voip':
      case 'utel':
        await processVoIPWebhook(event, tenantId);
        break;
      case 'telegram':
        await processTelegramWebhook(event, tenantId);
        break;
      case 'faceid':
        await processFaceIdWebhook(event, tenantId);
        break;
      default:
        logger.warn({ eventId, source: event.source }, 'Unknown webhook source');
    }

    await systemPrisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        processed: true,
        processedAt: new Date(),
        errorMessage: null,
      },
    });

    await systemPrisma.auditLog.create({
      data: {
        tenantId,
        action: 'webhook_processed',
        resource: 'webhook',
        resourceId: eventId,
        metadata: { source: event.source, eventType: event.eventType },
      },
    });
  } catch (error: any) {
    await systemPrisma.webhookEvent.update({
      where: { id: eventId },
      data: {
        errorMessage: error.message,
        retryCount: { increment: 1 },
      },
    });

    if (tenantIdForAudit) {
      await systemPrisma.auditLog.create({
        data: {
          tenantId: tenantIdForAudit,
          action: 'webhook_failed',
          resource: 'webhook',
          resourceId: eventId,
          metadata: { error: error.message },
        },
      });
    }

    reportError('Webhook processing failed', {
      eventId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
