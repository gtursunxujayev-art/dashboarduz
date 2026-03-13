// BullMQ queue definitions

import { Queue, Worker, Job } from 'bullmq';
import { getRedisClient } from './redis-client';
import { processWebhookEvent, processNotification, processExport, processIntegrationSync } from '../../workers/index';
import { log, LogLevel } from '../observability';

// Queue names
export enum QueueName {
  WEBHOOK_PROCESSING = 'webhook-processing',
  NOTIFICATIONS = 'notifications',
  EXPORTS = 'exports',
  SYNC = 'sync',
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
  [QueueName.EXPORTS]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'fixed',
        delay: 10000, // 10 seconds for exports
      },
      removeOnComplete: 50,
      removeOnFail: false, // Don't remove failed jobs - they go to DLQ
    },
  },
  [QueueName.SYNC]: {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 60000, // 60 seconds for sync operations
        jitter: 0.2,
      },
      removeOnComplete: 20,
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

// Queue instances cache
const queues: Map<QueueName, Queue> = new Map();
const dlqQueues: Map<QueueName, Queue> = new Map();

// Get or create queue instance
export function getQueue(name: QueueName): Queue {
  if (!queues.has(name)) {
    const config = queueConfigs[name] || {};
    const queue = new Queue(name, {
      connection: getRedisClient() as any,
      ...config,
    });

    queues.set(name, queue);
    log(LogLevel.INFO, `Created queue: ${name}`);
    
    // Create corresponding DLQ
    const dlqName = `${name}:dlq` as QueueName;
    const dlqQueue = new Queue(dlqName, {
      connection: getRedisClient() as any,
      ...dlqConfig,
    });
    
    dlqQueues.set(name, dlqQueue);
    log(LogLevel.INFO, `Created DLQ: ${dlqName}`);
  }

  return queues.get(name)!;
}

// Get DLQ for a queue
export function getDLQueue(name: QueueName): Queue {
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
          log(LogLevel.WARN, 'Skipping duplicate job due to idempotency key', { 
            jobId: job.id, 
            eventId, 
            idempotencyKey 
          });
          return;
        }
      }
      
      log(LogLevel.INFO, 'Processing webhook event', { 
        jobId: job.id, 
        eventId, 
        tenantId,
        attempt: job.attemptsMade + 1 
      });
      
      try {
        await processWebhookEvent(eventId);
        
        // Mark as processed for idempotency
        if (idempotencyKey) {
          await markIdempotent(idempotencyKey);
        }
        
        log(LogLevel.INFO, 'Webhook event processed successfully', { 
          jobId: job.id, 
          eventId,
          attempt: job.attemptsMade + 1 
        });
      } catch (error: any) {
        log(LogLevel.ERROR, 'Webhook processing failed', { 
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
          log(LogLevel.WARN, 'Skipping duplicate notification job', { 
            jobId: job.id, 
            notificationId, 
            idempotencyKey 
          });
          return;
        }
      }
      
      log(LogLevel.INFO, 'Processing notification', { 
        jobId: job.id, 
        notificationId,
        attempt: job.attemptsMade + 1 
      });
      
      try {
        await processNotification(notificationId);
        
        // Mark as processed for idempotency
        if (idempotencyKey) {
          await markIdempotent(idempotencyKey);
        }
        
        log(LogLevel.INFO, 'Notification processed successfully', { 
          jobId: job.id, 
          notificationId,
          attempt: job.attemptsMade + 1 
        });
      } catch (error: any) {
        log(LogLevel.ERROR, 'Notification processing failed', { 
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

  // Exports worker with DLQ
  new Worker(
    QueueName.EXPORTS,
    async (job: Job) => {
      const { exportType, idempotencyKey } = job.data;
      
      // Check idempotency
      if (idempotencyKey) {
        const processed = await checkIdempotency(idempotencyKey);
        if (processed) {
          log(LogLevel.WARN, 'Skipping duplicate export job', { 
            jobId: job.id, 
            exportType, 
            idempotencyKey 
          });
          return;
        }
      }
      
      log(LogLevel.INFO, 'Processing export', { 
        jobId: job.id, 
        exportType,
        attempt: job.attemptsMade + 1 
      });
      
      try {
        await processExport(`${job.id}-${exportType}`);
        
        // Mark as processed for idempotency
        if (idempotencyKey) {
          await markIdempotent(idempotencyKey);
        }
        
        log(LogLevel.INFO, 'Export processed successfully', { 
          jobId: job.id, 
          exportType,
          attempt: job.attemptsMade + 1 
        });
      } catch (error: any) {
        log(LogLevel.ERROR, 'Export processing failed', { 
          jobId: job.id, 
          exportType, 
          error: error.message,
          stack: error.stack,
          attempt: job.attemptsMade + 1
        });
        
        // Move to DLQ if max attempts reached
        if (job.attemptsMade >= (job.opts.attempts || 3) - 1) {
          await moveToDLQ(job, QueueName.EXPORTS, error);
        }
        
        throw error;
      }
    },
    {
      connection: getRedisClient() as any,
      concurrency: 2, // Only 2 concurrent exports to avoid resource exhaustion
    }
  );

  // Sync worker with DLQ
  new Worker(
    QueueName.SYNC,
    async (job: Job) => {
      const { integrationType, tenantId, idempotencyKey } = job.data;
      
      // Check idempotency
      if (idempotencyKey) {
        const processed = await checkIdempotency(idempotencyKey);
        if (processed) {
          log(LogLevel.WARN, 'Skipping duplicate sync job', { 
            jobId: job.id, 
            integrationType, 
            tenantId,
            idempotencyKey 
          });
          return;
        }
      }
      
      log(LogLevel.INFO, 'Processing sync', { 
        jobId: job.id, 
        integrationType,
        tenantId,
        attempt: job.attemptsMade + 1 
      });
      
      try {
        await processIntegrationSync(integrationType, tenantId);
        
        // Mark as processed for idempotency
        if (idempotencyKey) {
          await markIdempotent(idempotencyKey);
        }
        
        log(LogLevel.INFO, 'Sync processed successfully', { 
          jobId: job.id, 
          integrationType,
          tenantId,
          attempt: job.attemptsMade + 1 
        });
      } catch (error: any) {
        log(LogLevel.ERROR, 'Sync processing failed', { 
          jobId: job.id, 
          integrationType,
          tenantId,
          error: error.message,
          stack: error.stack,
          attempt: job.attemptsMade + 1
        });
        
        // Move to DLQ if max attempts reached
        if (job.attemptsMade >= (job.opts.attempts || 3) - 1) {
          await moveToDLQ(job, QueueName.SYNC, error);
        }
        
        throw error;
      }
    },
    {
      connection: getRedisClient() as any,
      concurrency: 1, // Only 1 concurrent sync to avoid rate limits
    }
  );

  log(LogLevel.INFO, 'All workers initialized');
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

// Clean old jobs
export async function cleanOldJobs(queueName: QueueName, maxAgeHours: number = 24): Promise<number> {
  const queue = getQueue(queueName);
  const maxAge = maxAgeHours * 60 * 60 * 1000; // Convert to milliseconds
  const cutoff = Date.now() - maxAge;

  // This is a simplified cleanup - in production, you might want more sophisticated cleanup
  const jobs = await queue.getJobs(['completed', 'failed']);
  const oldJobs = jobs.filter(job => job.timestamp < cutoff);
  
  for (const job of oldJobs) {
    await job.remove();
  }

  return oldJobs.length;
}

// Close all queues (for graceful shutdown)
export async function closeAllQueues(): Promise<void> {
  for (const [name, queue] of queues) {
    await queue.close();
    log(LogLevel.INFO, `Closed queue: ${name}`);
  }
  queues.clear();
}

// Retry failed jobs
export async function retryFailedJobs(queueName: QueueName, count: number = 100): Promise<number> {
  const queue = getQueue(queueName);
  const failedJobs = await queue.getFailed(0, count - 1);
  
  let retried = 0;
  for (const job of failedJobs) {
    await job.retry();
    retried++;
  }

  return retried;
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
    
    log(LogLevel.WARN, 'Job moved to DLQ', {
      jobId: job.id,
      queueName,
      dlqName: `${queueName}:dlq`,
      attempts: job.attemptsMade,
      error: error.message,
    });
  } catch (dlqError: any) {
    log(LogLevel.ERROR, 'Failed to move job to DLQ', {
      jobId: job.id,
      queueName,
      error: dlqError.message,
    });
  }
}

// Get DLQ metrics
export async function getDLQMetrics(queueName: QueueName): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const dlq = getDLQueue(queueName);
  
  const [
    waiting,
    active,
    completed,
    failed,
    delayed,
  ] = await Promise.all([
    dlq.getWaitingCount(),
    dlq.getActiveCount(),
    dlq.getCompletedCount(),
    dlq.getFailedCount(),
    dlq.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
  };
}

// Retry jobs from DLQ
export async function retryDLQJobs(queueName: QueueName, count: number = 100): Promise<number> {
  const dlq = getDLQueue(queueName);
  const failedJobs = await dlq.getFailed(0, count - 1);
  
  let retried = 0;
  for (const job of failedJobs) {
    const originalData = job.data.originalData;
    const mainQueue = getQueue(queueName);
    
    // Re-add to main queue with new idempotency key
    await mainQueue.add(queueName, {
      ...originalData,
      idempotencyKey: `retry-${job.id}-${Date.now()}`,
      retryFromDLQ: true,
      originalDLQJobId: job.id,
    }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 3000 },
    });
    
    // Remove from DLQ
    await job.remove();
    retried++;
  }

  return retried;
}
