import crypto from 'crypto';

import { systemPrisma } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

import { logger } from '../lib/logger';
import { isUniqueViolation } from '../lib/prisma-errors';
import { getQueue, QueueName } from '../services/queue/queues';

/** The body exactly as received (captured by the body parsers in app.ts), else the parsed body re-serialized. */
export function getRawBody(req: Request): string {
  const rawBody: unknown = 'rawBody' in req ? req.rawBody : undefined;

  if (typeof rawBody === 'string') {
    return rawBody;
  }

  const body: unknown = req.body;

  return JSON.stringify(body ?? {});
}

export function buildWebhookIdempotencyKey(source: string, tenantId: string, payload: string): string {
  return crypto.createHash('sha256').update(`${source}:${tenantId}:${payload}`).digest('hex');
}

export { isUniqueViolation };

export async function enqueueWebhookJob(params: {
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

/** The queue job that processes each webhook source. */
export const WEBHOOK_JOB_NAMES = {
  amocrm: 'process-amocrm-webhook',
  faceid: 'process-faceid-webhook',
  telegram: 'process-telegram-webhook',
} as const;

export type WebhookSource = keyof typeof WEBHOOK_JOB_NAMES;

/** The event is stored but could not be queued; the sender must retry (the retry re-queues the stored row). */
export class WebhookEnqueueError extends Error {
  constructor(readonly eventId: string, readonly cause: unknown) {
    super(`Webhook event ${eventId} was stored but could not be queued`);
    this.name = 'WebhookEnqueueError';
  }
}

async function enqueueStoredEvent(source: WebhookSource, eventId: string, tenantId: string, idempotencyKey: string): Promise<void> {
  try {
    await enqueueWebhookJob({ jobName: WEBHOOK_JOB_NAMES[source], eventId, tenantId, idempotencyKey });
  } catch (error: unknown) {
    throw new WebhookEnqueueError(eventId, error);
  }
}

/**
 * Stores a webhook event once (unique tenant + source + idempotency key) and queues it. A repeat delivery of an event
 * that is stored but not processed yet queues it again (the job id is deterministic, so a job that is still queued is
 * not duplicated); that is how a sender's retry recovers an event whose first enqueue failed. Throws
 * WebhookEnqueueError when queueing fails, so the handler can answer with a retryable status.
 */
export async function storeAndEnqueueWebhookEvent(params: {
  source: WebhookSource;
  tenantId: string;
  eventType: string;
  idempotencyKey: string;
  rawPayload: Prisma.InputJsonValue;
  signature?: string | null;
}): Promise<{ eventId: string; duplicate: boolean }> {
  const { source, tenantId, idempotencyKey } = params;
  let eventId: string;

  try {
    const event = await systemPrisma.webhookEvent.create({
      data: {
        tenantId,
        source,
        eventType: params.eventType,
        idempotencyKey,
        rawPayload: params.rawPayload,
        ...(params.signature !== undefined ? { signature: params.signature } : {}),
        processed: false,
      },
    });

    eventId = event.id;
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await systemPrisma.webhookEvent.findFirst({
      where: { tenantId, source, idempotencyKey },
      select: { id: true, processed: true },
    });

    if (existing && !existing.processed) {
      await enqueueStoredEvent(source, existing.id, tenantId, idempotencyKey);
    }
    logger.info({ source, idempotencyKey, requeued: Boolean(existing && !existing.processed) }, 'Duplicate webhook delivery');

    return { eventId: existing?.id ?? '', duplicate: true };
  }

  await enqueueStoredEvent(source, eventId, tenantId, idempotencyKey);

  return { eventId, duplicate: false };
}

/** The error answer of a webhook handler: 503 + Retry-After when the event is stored but not queued, else 500. */
export function sendWebhookFailure(res: Response, error: unknown, label: string): Response {
  if (error instanceof WebhookEnqueueError) {
    logger.error({ err: error.cause, eventId: error.eventId }, `${label}: event stored but not queued; asking the sender to retry`);

    return res.status(503).set('Retry-After', '30').json({ error: 'Temporarily unavailable, please retry' });
  }
  logger.error({ err: error }, `${label} failed`);

  return res.status(500).json({ error: 'Internal server error' });
}

export async function writeWebhookRejectionAudit(params: {
  tenantId: string;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await systemPrisma.auditLog.create({
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
  } catch (auditError: unknown) {
    logger.warn({ err: auditError, msg: 'Failed to write webhook rejection audit log' });
  }
}
