import crypto from 'crypto';

import { systemPrisma } from '@dashboarduz/db';
import type { Request } from 'express';

import { logger } from '../lib/logger';
import { getQueue, QueueName } from '../services/queue/queues';

export function getRawBody(req: Request): string {
  const rawBody = (req as any).rawBody;

  if (typeof rawBody === 'string') {
    return rawBody;
  }

  return JSON.stringify(req.body ?? {});
}

export function buildWebhookIdempotencyKey(source: string, tenantId: string, payload: string): string {
  return crypto.createHash('sha256').update(`${source}:${tenantId}:${payload}`).digest('hex');
}

export function isUniqueViolation(error: any): boolean {
  return error?.code === 'P2002';
}

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
  } catch (auditError: any) {
    logger.warn({ err: auditError, msg: 'Failed to write webhook rejection audit log' });
  }
}
