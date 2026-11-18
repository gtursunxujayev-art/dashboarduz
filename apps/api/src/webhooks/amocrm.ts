import { systemPrisma } from '@dashboarduz/db';
import { Router, type Request, type Response } from 'express';

import { asyncRoute } from '../lib/express-async';
import { logger } from '../lib/logger';
import { amocrmService } from '../services/integrations/amocrm';
import { rateLimiter } from '../services/security/rate-limiter';

import { amoWebhookAccountId, amoWebhookEventType, webhookPayloadJson } from './payloads';
import { buildWebhookIdempotencyKey, getRawBody, sendWebhookFailure, storeAndEnqueueWebhookEvent } from './shared';

const router = Router();

router.post('/amocrm', asyncRoute(async (req: Request, res: Response) => {
  try {
    const signature = (req.headers['x-signature'] || req.headers['x-amocrm-signature']) as string | undefined;
    const rawBody = getRawBody(req);

    const isValid = amocrmService.verifyWebhookSignature(rawBody, signature);

    if (!isValid) {
      logger.warn({ msg: 'Invalid AmoCRM webhook signature' });

      return res.status(403).json({ error: 'Invalid signature' });
    }

    const body: unknown = req.body;
    const accountIdRaw = amoWebhookAccountId(body);

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
    const eventType = amoWebhookEventType(body);

    const stored = await storeAndEnqueueWebhookEvent({
      source: 'amocrm',
      tenantId: integration.tenantId,
      eventType,
      idempotencyKey,
      rawPayload: webhookPayloadJson(body),
      signature: signature || null,
    });

    if (stored.duplicate) {
      return res.status(200).json({ received: true, duplicate: true });
    }

    await systemPrisma.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: 'webhook_received',
        resource: 'webhook',
        resourceId: stored.eventId,
        metadata: { source: 'amocrm', eventType },
      },
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    return sendWebhookFailure(res, err, 'AmoCRM webhook handler');
  }
}));

export { router as amocrmWebhookRouter };
