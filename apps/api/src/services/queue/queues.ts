// BullMQ queue definitions. The workers that consume these queues live in workers/bullmq-workers.ts, so this
// module (imported by request code that enqueues jobs) does not depend on the job processors.

import { Queue, type Job, type JobsOptions } from 'bullmq';

import { logger } from '../../lib/logger';

import { getRedisClient } from './redis-client';

// Queue names
export enum QueueName {
  WEBHOOK_PROCESSING = 'webhook-processing',
  NOTIFICATIONS = 'notifications',
}

type BackoffOptions = { type: 'fixed' | 'exponential'; delay: number; jitter?: number };

interface QueueConfig {
  defaultJobOptions: JobsOptions & { attempts: number; backoff: BackoffOptions };
  streams?: { events: { maxLen: number } };
}

// Queue configurations with DLQ support
const queueConfigs: Record<QueueName, QueueConfig> = {
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

export function getDLQName(name: QueueName): string {
  return `${name}-dlq`;
}

// Queue instances cache
const queues: Map<QueueName, Queue> = new Map();
const dlqQueues: Map<QueueName, Queue> = new Map();

// Get or create queue instance
export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);

  if (existing) return existing;

  const mainQueue = new Queue(name, {
    connection: getRedisClient(),
    ...queueConfigs[name],
  });

  // Create corresponding DLQ
  const dlqName = getDLQName(name);
  const dlqQueue = new Queue(dlqName, {
    connection: getRedisClient(),
    ...dlqConfig,
  });

  queues.set(name, mainQueue);
  dlqQueues.set(name, dlqQueue);

  logger.info(`Created queue: ${name}`);

  logger.info(`Created DLQ: ${dlqName}`);

  return mainQueue;
}

// Get DLQ for a queue
export function getDLQueue(name: QueueName): Queue {
  const existing = dlqQueues.get(name);

  if (existing) return existing;
  // Creating the main queue creates its DLQ too.
  getQueue(name);

  return dlqQueues.get(name) as Queue;
}

export interface AddJobOptions {
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

function randomJobSuffix(queueName: QueueName): string {
  return `job-${queueName}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Add job to queue with proper typing and idempotency
export async function addJob<T extends object>(
  queueName: QueueName,
  data: T,
  options?: AddJobOptions,
): Promise<Job<T & { idempotencyKey: string; timestamp: string }>> {
  const queue = getQueue(queueName);

  // Generate idempotency key if not provided
  const idempotencyKey = options?.idempotencyKey || randomJobSuffix(queueName);

  const jobData = {
    ...data,
    idempotencyKey,
    timestamp: new Date().toISOString(),
  };

  // idempotencyKey is not a BullMQ option; it travels in the job data.
  const { idempotencyKey: _idempotencyKey, ...bullOptions } = options ?? {};
  const defaults = queueConfigs[queueName].defaultJobOptions;
  const jobOptions: JobsOptions = {
    ...bullOptions,
    jobId: options?.jobId || randomJobSuffix(queueName),
    attempts: options?.attempts || defaults.attempts || 3,
    backoff: options?.backoff || defaults.backoff,
  };

  return queue.add(queueName, jobData, jobOptions) as Promise<Job<T & { idempotencyKey: string; timestamp: string }>>;
}

export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

// Get queue metrics
export async function getQueueMetrics(queueName: QueueName): Promise<QueueMetrics> {
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
