import crypto from 'crypto';
import express from 'express';
import { prisma } from '@dashboarduz/db';
import type { Request, Response } from 'express';
import { getQueue, QueueName } from '../services/queue/queues';
import { amocrmService } from '../services/integrations/amocrm';
import { logger } from '../lib/logger';
import { rateLimiter } from '../services/security/rate-limiter';
import { EncryptionService } from '../services/security/encryption';

const router = express.Router();

function getRawBody(req: Request): string {
  const rawBody = (req as any).rawBody;
  if (typeof rawBody === 'string') {
    return rawBody;
  }
  return JSON.stringify(req.body ?? {});
}

function buildIdempotencyKey(source: string, tenantId: string, payload: string): string {
  return crypto.createHash('sha256').update(`${source}:${tenantId}:${payload}`).digest('hex');
}

function resolveVoipProvider(req: Request): string {
  const headerProvider = req.headers['x-voip-provider'];
  const queryProvider = req.query.provider;
  const bodyProvider = req.body?.provider || req.body?.operator || req.body?.vendor;

  const provider = String(
    (Array.isArray(headerProvider) ? headerProvider[0] : headerProvider)
      || (Array.isArray(queryProvider) ? queryProvider[0] : queryProvider)
      || bodyProvider
      || 'utel',
  ).trim().toLowerCase();

  return provider || 'utel';
}

function isUniqueViolation(error: any): boolean {
  return error?.code === 'P2002';
}

async function enqueueWebhookJob(params: {
  jobName: string;
  eventId: string;
  tenantId: string;
  idempotencyKey: string;
}) {
  const webhookQueue = getQueue(QueueName.WEBHOOK_PROCESSING);
  await webhookQueue.add(
    params.jobName,
    {
      eventId: params.eventId,
      tenantId: params.tenantId,
      idempotencyKey: params.idempotencyKey,
    },
    {
      jobId: `${params.jobName}:${params.tenantId}:${params.idempotencyKey}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true,
    },
  );
}

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
    const integration = await prisma.integration.findFirst({
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

    const idempotencyKey = buildIdempotencyKey('amocrm', integration.tenantId, rawBody);
    const eventType = req.body?.event_type
      || (req.body?.leads ? 'leads' : req.body?.contacts ? 'contacts' : 'unknown');

    let event;
    try {
      event = await prisma.webhookEvent.create({
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

    await prisma.auditLog.create({
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

async function handleVoipWebhook(req: Request, res: Response) {
  try {
    const rawBody = getRawBody(req);
    const signature = req.headers['x-signature'] as string | undefined;
    const integrationKey = (req.query.integration_key as string | undefined)
      || (req.headers['x-integration-key'] as string | undefined);

    if (!integrationKey) {
      return res.status(400).json({ error: 'Missing integration key' });
    }

    const integration = await prisma.integration.findFirst({
      where: {
        type: 'voip_utel',
        status: 'active',
        config: {
          path: ['webhookKey'],
          equals: integrationKey,
        },
      },
    });

    if (!integration) {
      logger.warn({ msg: 'UTeL integration not found for key' });
      return res.status(404).json({ error: 'Integration not found' });
    }

    const webhookSecret = process.env.UTEL_WEBHOOK_SECRET;
    if (webhookSecret) {
      if (!signature) {
        return res.status(403).json({ error: 'Missing signature' });
      }
      const isValidSignature = EncryptionService.verifyHMAC(rawBody, signature, webhookSecret);
      if (!isValidSignature) {
        return res.status(403).json({ error: 'Invalid signature' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      logger.warn({ msg: 'UTEL_WEBHOOK_SECRET is not configured in production' });
    }

    const webhookLimit = await rateLimiter.isAllowed(integration.tenantId, 'webhook:voip', {
      maxRequests: 300,
      windowMs: 60 * 1000,
      keyPrefix: 'webhook',
    });
    if (!webhookLimit.allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    const provider = resolveVoipProvider(req);
    const idempotencyKey = buildIdempotencyKey(`voip:${provider}`, integration.tenantId, rawBody);
    const eventType = req.body?.event_type || 'call_event';

    let event;
    try {
      event = await prisma.webhookEvent.create({
        data: {
          tenantId: integration.tenantId,
          source: 'voip',
          eventType,
          idempotencyKey: `${provider}:${idempotencyKey}`,
          rawPayload: {
            ...req.body,
            provider,
          },
          signature: signature || null,
          processed: false,
        },
      });
    } catch (error: any) {
      if (isUniqueViolation(error)) {
        logger.info({ msg: 'Duplicate VoIP webhook ignored', idempotencyKey, provider });
        return res.status(200).json({ received: true, duplicate: true });
      }
      throw error;
    }

    await enqueueWebhookJob({
      jobName: 'process-voip-webhook',
      eventId: event.id,
      tenantId: integration.tenantId,
      idempotencyKey,
    });

    await prisma.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: 'webhook_received',
        resource: 'webhook',
        resourceId: event.id,
        metadata: { source: 'voip', provider, eventType },
      },
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'VoIP webhook handler failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
}

router.post('/utel', handleVoipWebhook);
router.post('/voip', handleVoipWebhook);

router.post('/telegram', async (req: Request, res: Response) => {
  try {
    const rawBody = getRawBody(req);
    const secretToken = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    if (!secretToken) {
      return res.status(403).json({ error: 'Missing Telegram secret token' });
    }

    const integration = await prisma.integration.findFirst({
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

    const idempotencyKey = buildIdempotencyKey('telegram', integration.tenantId, rawBody);
    const eventType = req.body?.message ? 'message' : req.body?.callback_query ? 'callback_query' : 'update';

    let event;
    try {
      event = await prisma.webhookEvent.create({
        data: {
          tenantId: integration.tenantId,
          source: 'telegram',
          eventType,
          idempotencyKey,
          rawPayload: req.body,
          processed: false,
        },
      });
    } catch (error: any) {
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

    await prisma.auditLog.create({
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
});

export default router;
