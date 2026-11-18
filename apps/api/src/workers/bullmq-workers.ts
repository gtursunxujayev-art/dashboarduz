// BullMQ workers for the queues defined in services/queue/queues.ts. Only the worker process (workers/worker.ts)
// imports this module, so request code that enqueues jobs never loads the processors (no import cycle).

import { Worker, type Job } from 'bullmq';

import { errorMessage, errorName, errorStack } from '../lib/errors';
import { logger } from '../lib/logger';
import { reportError } from '../services/observability';
import { getDLQName, getDLQueue, QueueName } from '../services/queue/queues';
import { getRedisClient } from '../services/queue/redis-client';

import { processNotification, processWebhookEvent } from './index';

interface WebhookJobData {
  eventId: string;
  tenantId?: string;
  idempotencyKey?: string;
}

interface NotificationJobData {
  notificationId: string;
  idempotencyKey?: string;
}

// Idempotency helpers
async function checkIdempotency(idempotencyKey: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = `idempotency:${idempotencyKey}`;
  const exists = await redis.exists(key);

  return exists === 1;
}

async function markIdempotent(idempotencyKey: string, ttlSeconds: number = 86400): Promise<void> {
  const redis = getRedisClient();
  const key = `idempotency:${idempotencyKey}`;

  await redis.setex(key, ttlSeconds, 'processed');
}

// DLQ helpers
async function moveToDLQ(job: Job, queueName: QueueName, error: unknown): Promise<void> {
  try {
    const dlq = getDLQueue(queueName);

    await dlq.add(`${queueName}:failed`, {
      originalJobId: job.id,
      originalData: job.data as unknown,
      failedAt: new Date().toISOString(),
      error: {
        message: errorMessage(error),
        stack: errorStack(error),
        name: errorName(error),
      },
      attempts: job.attemptsMade,
      timestamp: job.timestamp,
    }, {
      jobId: `dlq-${queueName}-${job.id}-${Date.now()}`,
    });

    logger.warn({
      jobId: job.id,
      queueName,
      dlqName: getDLQName(queueName),
      attempts: job.attemptsMade,
      error: errorMessage(error),
    }, 'Job moved to DLQ');
  } catch (dlqError: unknown) {
    reportError('Failed to move job to DLQ', {
      jobId: job.id,
      queueName,
      error: errorMessage(dlqError),
    });
  }
}

interface QueueJobHandler<T> {
  queueName: QueueName;
  concurrency: number;
  /** Log fields that identify the job (e.g. `{ eventId }`). */
  describe: (data: T) => Record<string, unknown>;
  process: (data: T) => Promise<void>;
  duplicateMessage: string;
  startMessage: string;
  successMessage: string;
  failureMessage: string;
  logTenant?: (data: T) => Record<string, unknown>;
}

/**
 * Skips a job whose idempotency key was already processed, runs it, marks the key, and on the last failed
 * attempt copies the job to the queue's DLQ before rethrowing (so BullMQ records the failure).
 */
async function runIdempotentJob<T extends { idempotencyKey?: string }>(job: Job<T>, handler: QueueJobHandler<T>): Promise<void> {
  const { idempotencyKey } = job.data;
  const ids = handler.describe(job.data);

  // Check idempotency - skip if already processed
  if (idempotencyKey) {
    const processed = await checkIdempotency(idempotencyKey);

    if (processed) {
      logger.warn({ jobId: job.id, ...ids, idempotencyKey }, handler.duplicateMessage);

      return;
    }
  }

  logger.info({ jobId: job.id, ...ids, ...(handler.logTenant?.(job.data) ?? {}), attempt: job.attemptsMade + 1 }, handler.startMessage);

  try {
    await handler.process(job.data);

    // Mark as processed for idempotency
    if (idempotencyKey) {
      await markIdempotent(idempotencyKey);
    }

    logger.info({ jobId: job.id, ...ids, attempt: job.attemptsMade + 1 }, handler.successMessage);
  } catch (error: unknown) {
    reportError(handler.failureMessage, {
      jobId: job.id,
      ...ids,
      error: errorMessage(error),
      stack: errorStack(error),
      attempt: job.attemptsMade + 1,
    });

    // Move to DLQ if max attempts reached
    if (job.attemptsMade >= (job.opts.attempts || 5) - 1) {
      await moveToDLQ(job, handler.queueName, error);
    }

    throw error;
  }
}

function startWorker<T extends { idempotencyKey?: string }>(handler: QueueJobHandler<T>): Worker<T> {
  return new Worker<T>(handler.queueName, (job: Job<T>) => runIdempotentJob(job, handler), {
    connection: getRedisClient(),
    concurrency: handler.concurrency,
  });
}

// Initialize all workers with DLQ support
export function initializeWorkers(): void {
  startWorker<WebhookJobData>({
    queueName: QueueName.WEBHOOK_PROCESSING,
    concurrency: 5, // Process 5 webhooks concurrently
    describe: (data) => ({ eventId: data.eventId }),
    logTenant: (data) => ({ tenantId: data.tenantId }),
    process: (data) => processWebhookEvent(data.eventId),
    duplicateMessage: 'Skipping duplicate job due to idempotency key',
    startMessage: 'Processing webhook event',
    successMessage: 'Webhook event processed successfully',
    failureMessage: 'Webhook processing failed',
  });

  startWorker<NotificationJobData>({
    queueName: QueueName.NOTIFICATIONS,
    concurrency: 10, // Send 10 notifications concurrently
    describe: (data) => ({ notificationId: data.notificationId }),
    process: (data) => processNotification(data.notificationId),
    duplicateMessage: 'Skipping duplicate notification job',
    startMessage: 'Processing notification',
    successMessage: 'Notification processed successfully',
    failureMessage: 'Notification processing failed',
  });

  logger.info('All workers initialized');
}
