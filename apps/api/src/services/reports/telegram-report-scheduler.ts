import { type DbClient } from '@dashboarduz/db';
import { TASHKENT_TIMEZONE_LABEL } from '@dashboarduz/shared';

import { createIntervalJob } from '../../lib/interval-job';
import { logger } from '../../lib/logger';
import { listTelegramRecipients } from '../integrations/telegram-recipient-store';
import { reportError } from '../observability';
import { getRedisClient } from '../queue/redis-client';

import { dispatchWindow, sendWindowToIntegration } from './telegram-report/dispatch';
import type { ManualReportKind, TelegramIntegrationWithTenant } from './telegram-report/types';
import { buildCurrentMonthWindow, buildCurrentWeekWindow, buildTodayWindow, resolveReportWindows } from './telegram-report/windows';

const POLL_INTERVAL_MS = 30_000;

const schedulerJob = createIntervalJob({
  intervalMs: POLL_INTERVAL_MS,
  skipWhileRunning: true,
  run: async () => {
    const nowUtc = new Date();
    const dueWindows = resolveReportWindows(nowUtc);

    for (const window of dueWindows) {
      await dispatchWindow(window, nowUtc);
    }
  },
  onError: (error) => {
    reportError('Telegram report scheduler tick failed', {
      error: (error as Error | undefined)?.message || 'Unknown error',
    });
  },
  onStart: () => {
    logger.info({
      timezone: TASHKENT_TIMEZONE_LABEL,
      intervalMs: POLL_INTERVAL_MS,
    }, 'Telegram report scheduler started');
  },
});

export function startTelegramReportScheduler(): void {
  schedulerJob.start();
}

export function stopTelegramReportScheduler(): void {
  schedulerJob.stop();
}

export async function sendImmediateTodayReportForTenant(tenantId: string, db: DbClient): Promise<{
  sent: boolean;
  recipientCount: number;
  periodStart: string;
  periodEnd: string;
  schedule: 'manual_today';
}> {
  const result = await sendManualTelegramReportForTenant(tenantId, 'today', db);

  return {
    ...result,
    schedule: 'manual_today',
  };
}

export async function sendManualTelegramReportForTenant(
  tenantId: string,
  kind: ManualReportKind,
  /** The caller's tenant-scoped ctx.db (manual sends come from an admin request). */
  db: DbClient,
): Promise<{
  sent: boolean;
  recipientCount: number;
  periodStart: string;
  periodEnd: string;
  schedule: 'manual_today' | 'manual_weekly' | 'manual_monthly';
}> {
  const integration = await db.integration.findFirst({
    where: {
      tenantId,
      type: 'telegram',
      status: 'active',
      tokensEncrypted: { not: null },
    },
    select: {
      id: true,
      tenantId: true,
      tokensEncrypted: true,
      config: true,
      tenant: {
        select: {
          name: true,
          settings: true,
        },
      },
    },
  });

  if (!integration) {
    throw new Error('Telegram integration is not connected');
  }

  const recipients = (await listTelegramRecipients({
    db,
    tenantId: integration.tenantId,
    integrationId: integration.id,
    startedOnly: true,
  })).filter((recipient) => recipient.selectedForReports);

  if (recipients.length === 0) {
    throw new Error('No Telegram recipients selected for scheduled reports');
  }

  const nowUtc = new Date();
  const window = kind === 'weekly'
    ? buildCurrentWeekWindow(nowUtc)
    : kind === 'monthly'
      ? buildCurrentMonthWindow(nowUtc)
      : buildTodayWindow(nowUtc);
  const redis = getRedisClient();
  const minuteKey = Math.floor(nowUtc.getTime() / 60_000);
  const schedule = kind === 'weekly'
    ? 'manual_weekly'
    : kind === 'monthly'
      ? 'manual_monthly'
      : 'manual_today';
  const lockKey = `telegram-report:${schedule}:${tenantId}:${window.periodKey}:${minuteKey}`;
  const lockResult = await redis.set(lockKey, nowUtc.toISOString(), 'EX', 120, 'NX');

  if (lockResult !== 'OK') {
    throw new Error('A report was already sent in the last minute. Please wait and try again.');
  }

  try {
    const sent = await sendWindowToIntegration(integration as TelegramIntegrationWithTenant, window, nowUtc, db);

    await db.auditLog.create({
      data: {
        tenantId: integration.tenantId,
        action: 'telegram_report_sent',
        resource: 'integration',
        resourceId: integration.id,
        metadata: {
          schedule,
          periodStart: window.periodStart.toISOString(),
          periodEnd: window.periodEnd.toISOString(),
          recipientCount: sent.recipientCount,
          fileName: sent.fileName,
        },
      },
    });

    return {
      sent: true,
      recipientCount: sent.recipientCount,
      periodStart: window.periodStart.toISOString(),
      periodEnd: window.periodEnd.toISOString(),
      schedule,
    };
  } catch (error) {
    await redis.del(lockKey);
    throw error;
  }
}
