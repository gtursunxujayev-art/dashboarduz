// Queue service abstraction for BullMQ / Redis

import { QueueName, addJob, getQueueMetrics } from './queue/queues';

export interface QueueJob<T = any> {
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

  // Add export job
  async addExportJob(exportType: 'pdf' | 'xlsx', params: any) {
    return addJob(QueueName.EXPORTS, {
      exportType,
      params,
      timestamp: new Date().toISOString(),
    }, {
      jobId: `export-${Date.now()}-${exportType}`,
      priority: 5, // Low priority for exports
    });
  }

  // Add sync job (for periodic synchronization)
  async addSyncJob(integrationType: string, tenantId: string) {
    return addJob(QueueName.SYNC, {
      integrationType,
      tenantId,
      timestamp: new Date().toISOString(),
    }, {
      jobId: `sync-${integrationType}-${tenantId}-${Date.now()}`,
      priority: 2, // Medium-high priority for sync
    });
  }

  // Get queue statistics
  async getQueueStats() {
    const [webhookStats, notificationStats, exportStats, syncStats] = await Promise.all([
      getQueueMetrics(QueueName.WEBHOOK_PROCESSING),
      getQueueMetrics(QueueName.NOTIFICATIONS),
      getQueueMetrics(QueueName.EXPORTS),
      getQueueMetrics(QueueName.SYNC),
    ]);

    return {
      webhooks: webhookStats,
      notifications: notificationStats,
      exports: exportStats,
      sync: syncStats,
      timestamp: new Date().toISOString(),
    };
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    queues: Record<string, any>;
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
