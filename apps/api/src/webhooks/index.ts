// src/webhooks/index.ts
import express from 'express';
import { prisma } from '@dashboarduz/db';
import type { Request, Response } from 'express';
import { getQueue, QueueName } from '../services/queue/queues';
import { amocrmService } from '../services/integrations/amocrm';
import { logger } from '../lib/logger';
import { rateLimiter } from '../services/security/rate-limiter';
import { EncryptionService } from '../services/security/encryption';

const router = express.Router();

// AmoCRM webhook receiver — verify -> persist -> enqueue -> ack
router.post('/amocrm', async (req: Request, res: Response) => {
  try {
    const signature = (req.headers['x-signature'] || req.headers['x-amocrm-signature']) as string | undefined;
    const rawBody = (req as any).rawBody ?? req.body; // ensure raw body available (Express rawBody middleware)

    // 1) Verify signature
    const isValid = amocrmService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      logger.warn({ msg: 'Invalid AmoCRM webhook signature' });
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // 2) Resolve tenant via integration mapping (account id from payload)
    const accountId = req.body?.account?.id ?? req.body?.account_id;
    if (!accountId) {
      return res.status(400).json({ error: 'Missing AmoCRM account id' });
    }

    const webhookLimit = await rateLimiter.isAllowed(String(accountId), 'webhook:amocrm', {
      maxRequests: 600,
      windowMs: 60 * 1000,
      keyPrefix: 'webhook',
    });
    if (!webhookLimit.allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    const integration = await prisma.integration.findFirst({
      where: {
        type: 'amocrm',
        config: {
          path: ['account_id'],
          equals: String(accountId),
        },
      },
    });

    if (!integration) {
      logger.warn({ msg: 'AmoCRM integration not found', accountId });
      return res.status(404).json({ error: 'Integration not found' });
    }

    // 3) Persist raw event to webhook_events (durable)
    const event = await prisma.webhookEvent.create({
      data: {
        tenantId: integration.tenantId,
        source: 'amocrm',
        eventType: req.body.account?.id ? 'account_update' : 'unknown',
        rawPayload: req.body,
        signature: signature || null,
        processed: false,
      },
    });

    // 4) Enqueue background job to process this event
    const webhookQueue = getQueue(QueueName.WEBHOOK_PROCESSING);
    await webhookQueue.add('process-amocrm-webhook', {
      eventId: event.id,
      tenantId: integration.tenantId,
      idempotencyKey: `webhook-${event.id}`,
    }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true
    });

    await prisma.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: 'webhook_received',
        resource: 'webhook',
        resourceId: event.id,
        metadata: { source: 'amocrm', eventType: event.eventType },
      },
    });

    // 5) ACK
    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'AmoCRM webhook handler failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// UTeL VoIP webhook receiver
router.post('/utel', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-signature'] as string | undefined;
    const rawBody = (req as any).rawBody ?? JSON.stringify(req.body);

    const webhookSecret = process.env.UTEL_WEBHOOK_SECRET;
    if (process.env.NODE_ENV === 'production') {
      if (!webhookSecret) {
        logger.error({ msg: 'UTEL_WEBHOOK_SECRET is not configured in production' });
        return res.status(500).json({ error: 'Webhook verification is not configured' });
      }
      if (!signature) {
        return res.status(403).json({ error: 'Missing signature' });
      }
      const validSignature = EncryptionService.verifyHMAC(
        typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody),
        signature,
        webhookSecret,
      );
      if (!validSignature) {
        logger.warn({ msg: 'Invalid UTeL webhook signature' });
        return res.status(403).json({ error: 'Invalid signature' });
      }
    } else if (!webhookSecret) {
      logger.warn({ msg: 'UTEL_WEBHOOK_SECRET not configured; skipping signature verification in non-production' });
    }

    // Resolve tenant via integration
    const integration = await prisma.integration.findFirst({
      where: { type: 'voip_utel', status: 'active' },
    });

    if (!integration) {
      logger.warn({ msg: 'UTeL integration not found' });
      return res.status(404).json({ error: 'Integration not found' });
    }

    const webhookLimit = await rateLimiter.isAllowed(integration.tenantId, 'webhook:utel', {
      maxRequests: 300,
      windowMs: 60 * 1000,
      keyPrefix: 'webhook',
    });
    if (!webhookLimit.allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // Persist event
    const event = await prisma.webhookEvent.create({
      data: {
        tenantId: integration.tenantId,
        source: 'utel',
        eventType: req.body.event_type || 'call_event',
        rawPayload: req.body,
        signature: signature || null,
        processed: false,
      },
    });

    // Enqueue processing
    const webhookQueue = getQueue(QueueName.WEBHOOK_PROCESSING);
    await webhookQueue.add('process-utel-webhook', {
      eventId: event.id,
      tenantId: integration.tenantId,
      idempotencyKey: `webhook-${event.id}`,
    }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true
    });

    await prisma.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: 'webhook_received',
        resource: 'webhook',
        resourceId: event.id,
        metadata: { source: 'utel', eventType: event.eventType },
      },
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'UTeL webhook handler failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Telegram webhook receiver
router.post('/telegram', async (req: Request, res: Response) => {
  try {
    // Telegram webhooks don't typically have signatures, but we can validate the bot token
    const botToken = req.headers['x-telegram-bot-token'] as string | undefined;
    
    if (!botToken) {
      logger.warn({ msg: 'Missing Telegram bot token in webhook' });
      return res.status(403).json({ error: 'Missing bot token' });
    }

    // Find integration with this bot token
    const integration = await prisma.integration.findFirst({
      where: { 
        type: 'telegram',
        config: {
          path: ['botToken'],
          equals: botToken,
        },
      },
    });

    if (!integration) {
      logger.warn({ msg: 'Telegram integration not found for bot token' });
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

    // Persist event
    const event = await prisma.webhookEvent.create({
      data: {
        tenantId: integration.tenantId,
        source: 'telegram',
        eventType: 'message',
        rawPayload: req.body,
        processed: false,
      },
    });

    // Enqueue processing
    const webhookQueue = getQueue(QueueName.WEBHOOK_PROCESSING);
    await webhookQueue.add('process-telegram-webhook', {
      eventId: event.id,
      tenantId: integration.tenantId,
      idempotencyKey: `webhook-${event.id}`,
    }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
      removeOnComplete: true
    });

    await prisma.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: 'webhook_received',
        resource: 'webhook',
        resourceId: event.id,
        metadata: { source: 'telegram', eventType: event.eventType },
      },
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Telegram webhook handler failed');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
