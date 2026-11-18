import { systemPrisma } from '@dashboarduz/db';
import { Router, type Request, type Response } from 'express';

import { asyncRoute } from '../lib/express-async';
import { logger } from '../lib/logger';
import { hashFaceIdWebhookToken } from '../services/attendance/faceid';
import { rateLimiter } from '../services/security/rate-limiter';

import { faceIdWebhookEventType, webhookPayloadJson } from './payloads';
import { buildWebhookIdempotencyKey, enqueueWebhookJob, getRawBody, isUniqueViolation } from './shared';

const router = Router();

function extractBearerToken(req: Request): string | null {
  const raw = req.headers.authorization;

  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const match = raw.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return null;
  }
  const token = String(match[1] || '').trim();

  return token || null;
}

export function extractFaceIdToken(req: Request): string | null {
  const bearer = extractBearerToken(req);

  if (bearer) {
    return bearer;
  }

  const queryToken = typeof req.query?.token === 'string'
    ? req.query.token.trim()
    : typeof req.query?.webhook_token === 'string'
      ? req.query.webhook_token.trim()
      : typeof req.query?.access_token === 'string'
        ? req.query.access_token.trim()
        : '';

  if (queryToken) {
    return queryToken;
  }

  const body = req.body as Record<string, unknown> | null | undefined;

  if (body && typeof body === 'object') {
    const bodyToken = typeof body.token === 'string'
      ? body.token.trim()
      : typeof body.webhook_token === 'string'
        ? body.webhook_token.trim()
        : typeof body.access_token === 'string'
          ? body.access_token.trim()
          : '';

    if (bodyToken) {
      return bodyToken;
    }
  }

  return null;
}

router.get('/faceid', (_req: Request, res: Response) => {
  return res.status(200).json({
    ok: true,
    endpoint: '/webhooks/faceid',
    method: 'POST',
    message: 'Face ID webhook endpoint is alive. Token can be sent via Bearer header or token query/body field.',
    requiredHeader: 'Authorization: Bearer <token>',
    alternateAuth: ['?token=<token>', '?webhook_token=<token>', 'body.token'],
  });
});

router.post('/faceid', asyncRoute(async (req: Request, res: Response) => {
  try {
    const rawBody = getRawBody(req);
    const body: unknown = req.body;
    const webhookToken = extractFaceIdToken(req);

    if (!webhookToken) {
      return res.status(401).json({
        error: 'Missing Face ID token',
        acceptedAuth: ['Authorization: Bearer <token>', '?token=<token>', '?webhook_token=<token>', 'body.token'],
      });
    }

    const webhookTokenHash = hashFaceIdWebhookToken(webhookToken);
    const integration = await systemPrisma.integration.findFirst({
      where: {
        type: 'faceid_attendance',
        status: 'active',
        config: {
          path: ['webhookTokenHash'],
          equals: webhookTokenHash,
        },
      },
    });

    if (!integration) {
      return res.status(403).json({ error: 'Invalid Face ID webhook token' });
    }

    const webhookLimit = await rateLimiter.isAllowed(integration.tenantId, 'webhook:faceid', {
      maxRequests: 600,
      windowMs: 60 * 1000,
      keyPrefix: 'webhook',
    });

    if (!webhookLimit.allowed) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    const idempotencyKey = buildWebhookIdempotencyKey('faceid', integration.tenantId, rawBody);
    const eventType = faceIdWebhookEventType(body);

    let event;

    try {
      event = await systemPrisma.webhookEvent.create({
        data: {
          tenantId: integration.tenantId,
          source: 'faceid',
          eventType,
          idempotencyKey,
          rawPayload: webhookPayloadJson(body),
          processed: false,
        },
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        logger.info({ msg: 'Duplicate Face ID webhook ignored', idempotencyKey });

        return res.status(200).json({ received: true, duplicate: true });
      }
      throw error;
    }

    await enqueueWebhookJob({
      jobName: 'process-faceid-webhook',
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
        metadata: { source: 'faceid', eventType },
      },
    });

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err }, 'Face ID webhook handler failed');

    return res.status(500).json({ error: 'Internal server error' });
  }
}));

export { router as faceIdWebhookRouter };
