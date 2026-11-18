import { systemPrisma } from '@dashboarduz/db';

import { thrownText } from '../lib/errors';
import { createIntervalJob } from '../lib/interval-job';
import { logger } from '../lib/logger';
import { enqueueWebhookJob, WEBHOOK_JOB_NAMES, type WebhookSource } from '../webhooks/shared';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** Only events this old: a younger one may still be between its insert and its enqueue. */
const MIN_AGE_MS = 5 * 60 * 1000;
const BATCH_SIZE = 500;

/**
 * Re-queues webhook events that were stored but never reached the queue (the enqueue after the insert failed and
 * the sender did not retry). Only rows that were never attempted (`processed: false`, `retryCount: 0`) are picked:
 * a row the worker already tried is BullMQ's to retry or dead-letter. Idempotent: the job id is the same one the
 * handler uses, so an event that is in fact still queued is not added twice.
 */
export async function requeueStrandedWebhookEvents(now = new Date()): Promise<{ requeued: number; failed: number }> {
  const sources = Object.keys(WEBHOOK_JOB_NAMES) as WebhookSource[];
  const stranded = await systemPrisma.webhookEvent.findMany({
    where: {
      processed: false,
      retryCount: 0,
      source: { in: sources },
      tenantId: { not: null },
      idempotencyKey: { not: null },
      createdAt: { lt: new Date(now.getTime() - MIN_AGE_MS) },
    },
    select: { id: true, tenantId: true, source: true, idempotencyKey: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });
  let requeued = 0;
  let failed = 0;

  for (const event of stranded) {
    try {
      await enqueueWebhookJob({
        jobName: WEBHOOK_JOB_NAMES[event.source as WebhookSource],
        eventId: event.id,
        tenantId: event.tenantId!,
        idempotencyKey: event.idempotencyKey!,
      });
      requeued += 1;
    } catch (error: unknown) {
      failed += 1;
      logger.warn({ eventId: event.id, error: thrownText(error) }, 'Webhook re-queue failed; will retry on the next sweep');
    }
  }

  if (stranded.length > 0) logger.info({ requeued, failed }, 'Re-queued stranded webhook events');

  return { requeued, failed };
}

const job = createIntervalJob({
  intervalMs: SWEEP_INTERVAL_MS,
  run: requeueStrandedWebhookEvents,
  skipWhileRunning: true,
  onError: (error) => {
    logger.warn({ error: thrownText(error) }, 'Webhook re-queue sweep failed');
  },
});

export function startWebhookRequeueSweeper(): void {
  job.start();
}

export function stopWebhookRequeueSweeper(): void {
  job.stop();
}
