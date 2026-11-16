import { systemPrisma } from '@dashboarduz/db';
import { Router, type Request, type Response } from 'express';

import { logger } from '../lib/logger';
import { amocrmService } from '../services/integrations/amocrm';
import { rateLimiter } from '../services/security/rate-limiter';

import { buildWebhookIdempotencyKey, enqueueWebhookJob, getRawBody, isUniqueViolation } from './shared';

const router = Router();

router.post('/amocrm', async (req: Request, res: Response) => {
  try {
    const signature = (req.headers['x-signature'] || req.headers['x-amocrm-signature']) as string | undefined;
    const rawBody = getRawBody(req);

    const isValid = amocrmService.verifyWebhookSignature(rawBody, signature);

    if (!isValid) {
      logger.warn({ msg: 'Invalid AmoCRM webhook signature' });

      return res.status(403).json({ error: 'Invalid signature' });
    }

    const accountIdRaw = req.body?.account?.id ?? req.body?.account_id;

    if (!accountIdRaw) {
      return res.status(400).json({ error: 'Missing AmoCRM account id' });
    }

    const accountId = String(accountIdRaw);
    const integration = await systemPrisma.integration.findFirst({
      where: {
        type: 'amocrm',
        status: 'active',
        config: {
          path: ['account_id'],
          equals: accountId,
        },
      },
    });

    if (!integration) {
      logger.warn({ msg: 'AmoCRM integration not found', accountId });

      return res.status(404).json({ error: 'Integration not found' });
    }

    const webhookLimit = await rateLimiter.isAllowed(integration.tenantId, 'webhook:amocrm', {
      maxRequests: 600,
      windowMs: 60 * 1000,
      keyPrefix: 'webhook',
    });

    if (!webhookLimit.allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    const idempotencyKey = buildWebhookIdempotencyKey('amocrm', integration.tenantId, rawBody);
    const eventType = req.body?.event_type
      || (req.body?.leads ? 'leads' : req.body?.contacts ? 'contacts' : 'unknown');

    let event;

    try {
      event = await systemPrisma.webhookEvent.create({
        data: {
          tenantId: integration.tenantId,
          source: 'amocrm',
          eventType,
          idempotencyKey,
          rawPayload: req.body,
          signature: signature || null,
          processed: false,
        },
      });
    } catch (error: any) {
      if (isUniqueViolation(error)) {
        logger.info({ msg: 'Duplicate AmoCRM webhook ignored', idempotencyKey });

        return res.status(200).json({ received: true, duplicate: true });
      }
      throw error;
    }

    await enqueueWebhookJob({
      jobName: 'process-amocrm-webhook',
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
        metadata: { source: 'amocrm', eventType },
      },
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'AmoCRM webhook handler failed');

    return res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as amocrmWebhookRouter };
