import crypto from 'crypto';
import express from 'express';
import { prisma } from '@dashboarduz/db';
import type { Request, Response } from 'express';
import { getDLQMetrics, getQueue, getQueueMetrics, QueueName } from '../services/queue/queues';
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

function isMissingWebhookIdempotencyColumnError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('idempotencykey') && message.includes('does not exist');
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

async function writeWebhookRejectionAudit(params: {
  tenantId: string;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        action: 'webhook_rejected',
        resource: 'webhook',
        metadata: {
          reason: params.reason,
          ...(params.metadata || {}),
        },
      },
    });
  } catch (auditError: any) {
    logger.warn({ err: auditError, msg: 'Failed to write webhook rejection audit log' });
  }
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
      if (isMissingWebhookIdempotencyColumnError(error)) {
        logger.warn({ msg: 'WebhookEvent.idempotencyKey column missing, creating event without idempotency key' });
        event = await prisma.webhookEvent.create({
          data: {
            tenantId: integration.tenantId,
            source: 'amocrm',
            eventType,
            rawPayload: req.body,
            signature: signature || null,
            processed: false,
          },
        });
      } else {
        throw error;
      }
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
  let tenantIdForAudit: string | null = null;
  let providerForAudit = 'utel';

  try {
    const rawBody = getRawBody(req);
    const signature = req.headers['x-signature'] as string | undefined;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
    const authHeader = req.headers.authorization;
    const bearerToken = typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : undefined;
    const integrationKey = String(
      (req.query.integration_key as string | undefined)
      || (req.query.integrationKey as string | undefined)
      || (req.headers['x-integration-key'] as string | undefined)
      || (req.headers['x-webhook-key'] as string | undefined)
      || (typeof body.integration_key === 'string' ? body.integration_key : undefined)
      || (typeof body.integrationKey === 'string' ? body.integrationKey : undefined)
      || (typeof body.webhook_key === 'string' ? body.webhook_key : undefined)
      || (typeof body.key === 'string' ? body.key : undefined)
      || bearerToken
      || '',
    ).trim();

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
    tenantIdForAudit = integration.tenantId;

    const webhookSecret = process.env.UTEL_WEBHOOK_SECRET;
    if (webhookSecret && signature) {
      const isValidSignature = EncryptionService.verifyHMAC(rawBody, signature, webhookSecret);
      if (!isValidSignature) {
        await writeWebhookRejectionAudit({
          tenantId: integration.tenantId,
          reason: 'invalid_signature',
          metadata: {
            source: 'voip',
            hasSignature: true,
          },
        });
        return res.status(403).json({ error: 'Invalid signature' });
      }
    } else if (webhookSecret && !signature) {
      logger.warn({ msg: 'VoIP webhook received without signature; accepted via integration key auth only' });
    } else if (process.env.NODE_ENV === 'production') {
      logger.warn({ msg: 'UTEL_WEBHOOK_SECRET is not configured in production' });
    }

    const webhookLimit = await rateLimiter.isAllowed(integration.tenantId, 'webhook:voip', {
      maxRequests: 300,
      windowMs: 60 * 1000,
      keyPrefix: 'webhook',
    });
    if (!webhookLimit.allowed) {
      await writeWebhookRejectionAudit({
        tenantId: integration.tenantId,
        reason: 'rate_limit_exceeded',
        metadata: {
          source: 'voip',
        },
      });
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    const bodyPayload: Record<string, unknown> = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : { raw: req.body as unknown };
    const provider = resolveVoipProvider(req);
    providerForAudit = provider;
    const idempotencyKey = buildIdempotencyKey(`voip:${provider}`, integration.tenantId, rawBody);
    const eventTypeRaw = bodyPayload['event_type'];
    const eventType = typeof eventTypeRaw === 'string' && eventTypeRaw.trim().length > 0
      ? eventTypeRaw
      : 'call_event';

    let event;
    try {
      event = await prisma.webhookEvent.create({
        data: {
          tenantId: integration.tenantId,
          source: 'voip',
          eventType,
          idempotencyKey: `${provider}:${idempotencyKey}`,
          rawPayload: {
            ...bodyPayload,
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
      if (isMissingWebhookIdempotencyColumnError(error)) {
        logger.warn({ msg: 'WebhookEvent.idempotencyKey column missing, creating VoIP event without idempotency key' });
        event = await prisma.webhookEvent.create({
          data: {
            tenantId: integration.tenantId,
            source: 'voip',
            eventType,
            rawPayload: {
              ...bodyPayload,
              provider,
            },
            signature: signature || null,
            processed: false,
          },
        });
      } else {
        throw error;
      }
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
  } catch (err: any) {
    if (tenantIdForAudit) {
      await writeWebhookRejectionAudit({
        tenantId: tenantIdForAudit,
        reason: 'handler_exception',
        metadata: {
          source: 'voip',
          provider: providerForAudit,
          error: err?.message || 'Unknown error',
        },
      });
    }
    logger.error({ err }, 'VoIP webhook handler failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleVoipWebhookStatus(req: Request, res: Response) {
  try {
    const integrationKey = (req.query.integration_key as string | undefined)
      || (req.headers['x-integration-key'] as string | undefined);
    const debugEnabled = String(req.query.debug || '').toLowerCase() === '1'
      || String(req.query.debug || '').toLowerCase() === 'true';

    if (!integrationKey) {
      return res.status(200).json({
        ok: true,
        endpoint: '/webhooks/utel',
        method: 'POST',
        message: 'Webhook endpoint is alive. Send POST with integration_key query param.',
      });
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
      select: {
        id: true,
        tenantId: true,
      },
    });

    if (!integration) {
      return res.status(404).json({ ok: false, error: 'Integration not found' });
    }

    const [totalCalls, recentCalls, receivedEvents] = await Promise.all([
      prisma.call.count({
        where: {
          tenantId: integration.tenantId,
        },
      }),
      prisma.call.findMany({
        where: {
          tenantId: integration.tenantId,
        },
        orderBy: { startedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          direction: true,
          startedAt: true,
          duration: true,
          from: true,
          to: true,
          provider: true,
          status: true,
          metadata: true,
        },
      }),
      prisma.webhookEvent.count({
        where: {
          tenantId: integration.tenantId,
          source: 'voip',
        },
      }),
    ]);

    let diagnostics: Record<string, unknown> | null = null;
    if (debugEnabled) {
      const [
        processedWebhookEvents,
        pendingWebhookEvents,
        failedWebhookEvents,
        recentWebhookEvents,
        recentWebhookRejections,
      ] = await Promise.all([
        prisma.webhookEvent.count({
          where: {
            tenantId: integration.tenantId,
            source: 'voip',
            processed: true,
          },
        }),
        prisma.webhookEvent.count({
          where: {
            tenantId: integration.tenantId,
            source: 'voip',
            processed: false,
          },
        }),
        prisma.webhookEvent.count({
          where: {
            tenantId: integration.tenantId,
            source: 'voip',
            errorMessage: { not: null },
          },
        }),
        prisma.webhookEvent.findMany({
          where: {
            tenantId: integration.tenantId,
            source: 'voip',
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            eventType: true,
            processed: true,
            processedAt: true,
            retryCount: true,
            errorMessage: true,
            createdAt: true,
            rawPayload: true,
          },
        }),
        prisma.auditLog.findMany({
          where: {
            tenantId: integration.tenantId,
            action: 'webhook_rejected',
            resource: 'webhook',
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            createdAt: true,
            metadata: true,
          },
        }),
      ]);

      let queueMetrics: Record<string, unknown>;
      try {
        const [webhookQueue, webhookDLQ] = await Promise.all([
          getQueueMetrics(QueueName.WEBHOOK_PROCESSING),
          getDLQMetrics(QueueName.WEBHOOK_PROCESSING),
        ]);
        queueMetrics = {
          webhookQueue,
          webhookDLQ,
        };
      } catch (queueError: any) {
        queueMetrics = {
          error: queueError?.message || 'Failed to read queue metrics',
        };
      }

      diagnostics = {
        processedWebhookEvents,
        pendingWebhookEvents,
        failedWebhookEvents,
        queueMetrics,
        recentWebhookRejections,
        recentWebhookEvents: recentWebhookEvents.map((event) => {
          const payload = event.rawPayload && typeof event.rawPayload === 'object'
            ? event.rawPayload as Record<string, unknown>
            : {};
          const provider = typeof payload.provider === 'string' ? payload.provider : null;
          return {
            id: event.id,
            eventType: event.eventType,
            provider,
            processed: event.processed,
            retryCount: event.retryCount,
            errorMessage: event.errorMessage,
            createdAt: event.createdAt,
            processedAt: event.processedAt,
          };
        }),
      };
    }

    return res.status(200).json({
      ok: true,
      endpoint: '/webhooks/utel',
      method: 'POST',
      integration: 'active',
      tenantId: integration.tenantId,
      totalCalls,
      totalWebhookEvents: receivedEvents,
      ...(diagnostics ? { diagnostics } : {}),
      recentCalls: recentCalls.map((call) => {
        const metadata = (call.metadata && typeof call.metadata === 'object')
          ? call.metadata as Record<string, unknown>
          : {};

        const manager = String(
          metadata.manager
          || metadata.agent
          || metadata.operator
          || metadata.user
          || '',
        ).trim();
        const extension = String(
          metadata.extension
          || metadata.ext
          || metadata.internal
          || '',
        ).trim();

        return {
          id: call.id,
          provider: call.provider,
          status: call.status,
          direction: call.direction,
          date: call.startedAt,
          duration: call.duration,
          phone: call.direction === 'outbound' ? call.to : call.from,
          extension: extension || null,
          manager: manager || null,
        };
      }),
    });
  } catch (err) {
    logger.error({ err }, 'VoIP webhook status handler failed');
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
}

router.get('/utel', handleVoipWebhookStatus);
router.get('/voip', handleVoipWebhookStatus);
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
      if (isMissingWebhookIdempotencyColumnError(error)) {
        logger.warn({ msg: 'WebhookEvent.idempotencyKey column missing, creating Telegram event without idempotency key' });
        event = await prisma.webhookEvent.create({
          data: {
            tenantId: integration.tenantId,
            source: 'telegram',
            eventType,
            rawPayload: req.body,
            processed: false,
          },
        });
      } else {
        throw error;
      }
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
