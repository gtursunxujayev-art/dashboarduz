import { systemPrisma } from '@dashboarduz/db';

import { createIntervalJob } from '../lib/interval-job';
import { logger } from '../lib/logger';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;
const DELETE_BATCH_SIZE = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Days to keep processed webhook events (WEBHOOK_EVENT_RETENTION_DAYS, default 90, minimum 1). */
export function getWebhookEventRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(String(env.WEBHOOK_EVENT_RETENTION_DAYS ?? ''), 10);

  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_RETENTION_DAYS;
}

/**
 * Deletes processed webhook events older than the retention window, in batches so no single statement
 * holds locks for long. Unprocessed events are kept regardless of age (they may still need a retry).
 * Runs across all tenants, so it uses the system client.
 */
export async function purgeProcessedWebhookEvents(
  now = new Date(),
  retentionDays = getWebhookEventRetentionDays(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  let deleted = 0;

  for (;;) {
    const batch = await systemPrisma.webhookEvent.findMany({
      where: { processed: true, createdAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: DELETE_BATCH_SIZE,
    });

    if (batch.length === 0) break;

    const result = await systemPrisma.webhookEvent.deleteMany({
      where: { id: { in: batch.map((row) => row.id) } },
    });

    deleted += result.count;
    if (batch.length < DELETE_BATCH_SIZE) break;
  }

  if (deleted > 0) {
    logger.info({ deleted, retentionDays, cutoff: cutoff.toISOString() }, 'Purged processed webhook events');
  }

  return deleted;
}

const job = createIntervalJob({
  intervalMs: CHECK_INTERVAL_MS,
  run: purgeProcessedWebhookEvents,
  onError: (error) => {
    logger.warn({
      error: error instanceof Error ? error.message : String(error),
    }, 'Webhook event retention run failed');
  },
});

export function startWebhookEventRetentionScheduler(): void {
  job.start();
}

export function stopWebhookEventRetentionScheduler(): void {
  job.stop();
}
