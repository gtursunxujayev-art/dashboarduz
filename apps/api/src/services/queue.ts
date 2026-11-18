// Queue service abstraction for BullMQ / Redis

import { QueueName, addJob, getQueueMetrics, type QueueMetrics } from './queue/queues';

export interface QueueStats {
  webhooks: QueueMetrics;
  notifications: QueueMetrics;
  timestamp: string;
}

export interface QueueJob<T = unknown> {
  id: string;
  data: T;
  attempts: number;
  timestamp: number;
}

export class QueueService {
  // Add webhook processing job
  async addWebhookJob(eventId: string, tenantId?: string) {
    return addJob(QueueName.WEBHOOK_PROCESSING, {
      eventId,
      tenantId,
      timestamp: new Date().toISOString(),
    }, {
      jobId: `webhook-${eventId}`,
      priority: 1, // High priority for webhooks
    });
  }

  // Add notification job
  async addNotificationJob(notificationId: string, options?: {
    delay?: number;
    priority?: number;
  }) {
    return addJob(QueueName.NOTIFICATIONS, {
      notificationId,
      timestamp: new Date().toISOString(),
    }, {
      jobId: `notification-${notificationId}`,
      priority: options?.priority || 3, // Default medium priority
      ...(options?.delay !== undefined ? { delay: options.delay } : {}),
    });
  }

  // Get queue statistics
  async getQueueStats(): Promise<QueueStats> {
    const [webhookStats, notificationStats] = await Promise.all([
      getQueueMetrics(QueueName.WEBHOOK_PROCESSING),
      getQueueMetrics(QueueName.NOTIFICATIONS),
    ]);

    return {
      webhooks: webhookStats,
      notifications: notificationStats,
      timestamp: new Date().toISOString(),
    };
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    queues: QueueStats;
    issues?: string[];
  }> {
    const stats = await this.getQueueStats();
    const issues: string[] = [];

    // Check for queue backlogs
    if (stats.webhooks.waiting > 100) {
      issues.push(`Webhook queue backlog: ${stats.webhooks.waiting} jobs waiting`);
    }

    if (stats.notifications.waiting > 500) {
      issues.push(`Notification queue backlog: ${stats.notifications.waiting} jobs waiting`);
    }

    if (stats.webhooks.failed > 50) {
      issues.push(`Webhook queue has ${stats.webhooks.failed} failed jobs`);
    }

    if (stats.notifications.failed > 100) {
      issues.push(`Notification queue has ${stats.notifications.failed} failed jobs`);
    }

    const status = issues.length > 0 ? 'degraded' : 'healthy';

    return {
      status,
      queues: stats,
      ...(issues.length > 0 ? { issues } : {}),
    };
  }
}

export const queueService = new QueueService();
