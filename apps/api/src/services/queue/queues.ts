// BullMQ queue definitions

import { Queue, Worker, Job } from 'bullmq';

import { logger } from '../../lib/logger';
import { processWebhookEvent, processNotification } from '../../workers/index';
import { reportError } from '../observability';

import { getRedisClient } from './redis-client';

// Queue names
export enum QueueName {
  WEBHOOK_PROCESSING = 'webhook-processing',
  NOTIFICATIONS = 'notifications',
}

// Queue configurations with DLQ support
const queueConfigs = {
  [QueueName.WEBHOOK_PROCESSING]: {
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 3000,
        jitter: 0.3, // Add jitter to prevent thundering herd
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: false, // Don't remove failed jobs - they go to DLQ
      failParentOnFailure: true,
    },
    streams: {
      events: {
        maxLen: 10000, // Keep last 10k events
      },
    },
  },
  [QueueName.NOTIFICATIONS]: {
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 5000,
        jitter: 0.3,
      },
      removeOnComplete: 1000,
      removeOnFail: false, // Don't remove failed jobs - they go to DLQ
    },
  },
};

// Dead Letter Queue configuration
const dlqConfig = {
  defaultJobOptions: {
    attempts: 1, // DLQ jobs don't retry
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
};

function getDLQName(name: QueueName): string {
  return `${name}-dlq`;
}

// Queue instances cache
const queues: Map<QueueName, Queue> = new Map();
const dlqQueues: Map<QueueName, Queue> = new Map();

// Get or create queue instance
export function getQueue(name: QueueName): Queue {
  if (!queues.has(name)) {
    const config = queueConfigs[name] || {};
    const mainQueue = new Queue(name, {
      connection: getRedisClient() as any,
      ...config,
    });
    
    // Create corresponding DLQ
    const dlqName = getDLQName(name);
    const dlqQueue = new Queue(dlqName, {
      connection: getRedisClient() as any,
      ...dlqConfig,
    });

    queues.set(name, mainQueue);
    dlqQueues.set(name, dlqQueue);

    logger.info(`Created queue: ${name}`);
    
    logger.info(`Created DLQ: ${dlqName}`);
  }

  return queues.get(name)!;
}

// Get DLQ for a queue
function getDLQueue(name: QueueName): Queue {
  if (!dlqQueues.has(name)) {
    // Ensure main queue exists first
    getQueue(name);
  }

  return dlqQueues.get(name)!;
}

// Initialize all workers with DLQ support
export function initializeWorkers() {
  // Webhook processing worker with DLQ
  new Worker(
    QueueName.WEBHOOK_PROCESSING,
    async (job: Job) => {
      const { eventId, tenantId, idempotencyKey } = job.data;
      
      // Check idempotency - skip if already processed
      if (idempotencyKey) {
        const processed = await checkIdempotency(idempotencyKey);

        if (processed) {
          logger.warn({ 
            jobId: job.id, 
            eventId, 
            idempotencyKey 
          }, 'Skipping duplicate job due to idempotency key');

          return;
        }
      }
      
      logger.info({ 
        jobId: job.id, 
        eventId, 
        tenantId,
        attempt: job.attemptsMade + 1 
      }, 'Processing webhook event');
      
      try {
        await processWebhookEvent(eventId);
        
        // Mark as processed for idempotency
        if (idempotencyKey) {
          await markIdempotent(idempotencyKey);
        }
        
        logger.info({ 
          jobId: job.id, 
          eventId,
          attempt: job.attemptsMade + 1 
        }, 'Webhook event processed successfully');
      } catch (error: any) {
        reportError('Webhook processing failed', { 
          jobId: job.id, 
          eventId, 
          error: error.message,
          stack: error.stack,
          attempt: job.attemptsMade + 1
        });
        
        // Move to DLQ if max attempts reached
        if (job.attemptsMade >= (job.opts.attempts || 5) - 1) {
          await moveToDLQ(job, QueueName.WEBHOOK_PROCESSING, error);
        }
        
        throw error;
      }
    },
    {
      connection: getRedisClient() as any,
      concurrency: 5, // Process 5 webhooks concurrently
    }
  );

  // Notifications worker with DLQ
  new Worker(
    QueueName.NOTIFICATIONS,
    async (job: Job) => {
      const { notificationId, idempotencyKey } = job.data;
      
      // Check idempotency
      if (idempotencyKey) {
        const processed = await checkIdempotency(idempotencyKey);

        if (processed) {
          logger.warn({ 
            jobId: job.id, 
            notificationId, 
            idempotencyKey 
          }, 'Skipping duplicate notification job');

          return;
        }
      }
      
      logger.info({ 
        jobId: job.id, 
        notificationId,
        attempt: job.attemptsMade + 1 
      }, 'Processing notification');
      
      try {
        await processNotification(notificationId);
        
        // Mark as processed for idempotency
        if (idempotencyKey) {
          await markIdempotent(idempotencyKey);
        }
        
        logger.info({ 
          jobId: job.id, 
          notificationId,
          attempt: job.attemptsMade + 1 
        }, 'Notification processed successfully');
      } catch (error: any) {
        reportError('Notification processing failed', { 
          jobId: job.id, 
          notificationId, 
          error: error.message,
          stack: error.stack,
          attempt: job.attemptsMade + 1
        });
        
        // Move to DLQ if max attempts reached
        if (job.attemptsMade >= (job.opts.attempts || 5) - 1) {
          await moveToDLQ(job, QueueName.NOTIFICATIONS, error);
        }
        
        throw error;
      }
    },
    {
      connection: getRedisClient() as any,
      concurrency: 10, // Send 10 notifications concurrently
    }
  );

  logger.info('All workers initialized');
}

// Add job to queue with proper typing and idempotency
export async function addJob<T = any>(
  queueName: QueueName,
  data: T,
  options?: {
    delay?: number;
    priority?: number;
    jobId?: string;
    idempotencyKey?: string;
    attempts?: number;
    backoff?: {
      type: 'fixed' | 'exponential';
      delay: number;
    };
  }
): Promise<Job<T>> {
  const queue = getQueue(queueName);
  
  // Generate idempotency key if not provided
  const idempotencyKey = options?.idempotencyKey || `job-${queueName}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  
  const jobData = {
    ...data,
    idempotencyKey,
    timestamp: new Date().toISOString(),
  };
  
  const jobOptions = {
    ...options,
    jobId: options?.jobId || `job-${queueName}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    attempts: options?.attempts || queueConfigs[queueName]?.defaultJobOptions?.attempts || 3,
    backoff: options?.backoff || queueConfigs[queueName]?.defaultJobOptions?.backoff || {
      type: 'exponential' as const,
      delay: 1000,
    },
  };
  
  // Remove idempotencyKey from options since it's not a valid BullMQ option
  delete (jobOptions as any).idempotencyKey;
  
  return queue.add(queueName, jobData, jobOptions);
}

// Get queue metrics
export async function getQueueMetrics(queueName: QueueName): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getQueue(queueName);
  
  const [
    waiting,
    active,
    completed,
    failed,
    delayed,
  ] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
  };
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
async function moveToDLQ(job: Job, queueName: QueueName, error: any): Promise<void> {
  try {
    const dlq = getDLQueue(queueName);

    await dlq.add(`${queueName}:failed`, {
      originalJobId: job.id,
      originalData: job.data,
      failedAt: new Date().toISOString(),
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
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
      error: error.message,
    }, 'Job moved to DLQ');
  } catch (dlqError: any) {
    reportError('Failed to move job to DLQ', {
      jobId: job.id,
      queueName,
      error: dlqError.message,
    });
  }
}
