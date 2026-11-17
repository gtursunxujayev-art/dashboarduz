import { type DbClient, systemPrisma } from '@dashboarduz/db';
import { toTashkentDateKey } from '@dashboarduz/shared';

import { sleep } from '../../../lib/async';
import { logger } from '../../../lib/logger';
import { parseTelegramDailyReportCourseIds } from '../../../lib/telegram';
import { telegramService } from '../../integrations/telegram';
import { listTelegramRecipients } from '../../integrations/telegram-recipient-store';
import { reportError } from '../../observability';
import { getRedisClient } from '../../queue/redis-client';
import { decryptIntegrationTokens } from '../../security/encryption';

import { getReportTenantName } from './format';
import { collectMetrics, getSelectedPipelineIdsForTenant } from './metrics';
import { createStyledReportPdf } from './report-pdf';
import type { ReportWindow, TelegramIntegrationWithTenant } from './types';

const LOCK_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

/** After a failed send, the next attempt waits this long instead of the 30-second scheduler tick. */
export const RETRY_DELAY_SECONDS = 15 * 60;
/** Attempts per report window before giving up until the next window. */
export const MAX_SEND_ATTEMPTS = 5;
const MIN_DAILY_REPORT_PREP_MS = 10_000;

const MIN_WEEKLY_REPORT_PREP_MS = 20_000;

const MIN_MONTHLY_REPORT_PREP_MS = 30_000;

export async function sendWindowToIntegration(
  integration: TelegramIntegrationWithTenant,
  window: ReportWindow,
  nowUtc: Date,
  /** Request code passes ctx.db; the scheduler passes systemPrisma. */
  db: DbClient,
  delivery: {
    /** Chats that already received this report (a retry skips them). */
    alreadyDelivered?: ReadonlySet<string>;
    onDelivered?: (chatId: string) => Promise<void>;
  } = {},
): Promise<{ recipientCount: number; fileName: string }> {
  const reportStartedAt = Date.now();
  const recipients = (await listTelegramRecipients({
    db,
    tenantId: integration.tenantId,
    integrationId: integration.id,
    startedOnly: true,
  })).filter((recipient) => recipient.selectedForReports);

  if (recipients.length === 0) {
    throw new Error('No Telegram recipients selected for reports');
  }

  const selectedPipelineIds = await getSelectedPipelineIdsForTenant(integration.tenantId, db);
  const selectedReportCourseIds = window.kind === 'daily'
    ? parseTelegramDailyReportCourseIds(integration.config)
    : [];
  const metrics = await collectMetrics({
    tenantId: integration.tenantId,
    tenantSettings: integration.tenant.settings,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    selectedPipelineIds,
    selectedReportCourseIds,
    db,
  });
  const elapsed = Date.now() - reportStartedAt;
  const minWaitMs = window.kind === 'weekly'
    ? MIN_WEEKLY_REPORT_PREP_MS
    : window.kind === 'monthly'
      ? MIN_MONTHLY_REPORT_PREP_MS
      : MIN_DAILY_REPORT_PREP_MS;

  if (elapsed < minWaitMs) {
    await sleep(minWaitMs - elapsed);
  }

  const pdfBuffer = createStyledReportPdf({
    tenantName: getReportTenantName(integration.tenant.name || integration.tenantId),
    title: window.title,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    generatedAt: nowUtc,
    metrics,
  });
  const fileName = `dashboard-report-${window.kind}-${window.periodKey}.pdf`;
  const caption = `${window.title}\n${toTashkentDateKey(window.periodStart)} - ${toTashkentDateKey(window.periodEnd)}`;

  const tokens = decryptIntegrationTokens<{ botToken?: string }>(integration.tokensEncrypted || '');

  if (!tokens.botToken) {
    throw new Error('Telegram bot token is missing');
  }

  // One recipient failing (e.g. they blocked the bot) must not stop the others.
  const failures: string[] = [];
  let deliveredCount = 0;

  for (const recipient of recipients) {
    if (delivery.alreadyDelivered?.has(recipient.chatId)) {
      continue;
    }
    try {
      await telegramService.sendDocument(tokens.botToken, recipient.chatId, pdfBuffer, fileName, caption);
      deliveredCount += 1;
      await delivery.onDelivered?.(recipient.chatId);
    } catch (error) {
      failures.push(`${recipient.chatId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Report not delivered to ${failures.length} of ${recipients.length} recipients (${failures.join('; ')})`);
  }

  return {
    recipientCount: deliveredCount,
    fileName,
  };
}

export async function dispatchWindow(window: ReportWindow, nowUtc: Date): Promise<void> {
  const integrations = await systemPrisma.integration.findMany({
    where: {
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

  const redis = getRedisClient();

  for (const integration of integrations as TelegramIntegrationWithTenant[]) {
    const recipientsSelected = await systemPrisma.telegramRecipient.count({
      where: {
        tenantId: integration.tenantId,
        integrationId: integration.id,
        started: true,
        selectedForReports: true,
      },
    });

    if (!recipientsSelected) {
      continue;
    }

    const lockKey = `telegram-report:${window.kind}:${integration.tenantId}:${window.periodKey}`;
    const lockResult = await redis.set(lockKey, nowUtc.toISOString(), 'EX', LOCK_TTL_SECONDS, 'NX');

    if (lockResult !== 'OK') {
      continue;
    }

    const deliveredKey = `${lockKey}:delivered`;
    const attemptsKey = `${lockKey}:attempts`;

    try {
      const alreadyDelivered = new Set(await redis.smembers(deliveredKey));
      const sent = await sendWindowToIntegration(integration, window, nowUtc, systemPrisma, {
        alreadyDelivered,
        onDelivered: async (chatId) => {
          await redis.sadd(deliveredKey, chatId);
          await redis.expire(deliveredKey, LOCK_TTL_SECONDS);
        },
      });

      await systemPrisma.auditLog.create({
        data: {
          tenantId: integration.tenantId,
          action: 'telegram_report_sent',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            schedule: window.kind,
            periodStart: window.periodStart.toISOString(),
            periodEnd: window.periodEnd.toISOString(),
            recipientCount: sent.recipientCount,
            fileName: sent.fileName,
          },
        },
      });

      logger.info({
        tenantId: integration.tenantId,
        schedule: window.kind,
        recipients: sent.recipientCount,
      }, 'Scheduled Telegram report sent');
    } catch (error: any) {
      // Keep the lock but shorten it, so the next attempt comes after RETRY_DELAY_SECONDS rather than on the
      // next 30-second tick. After MAX_SEND_ATTEMPTS the full lock stays and this window is given up.
      const attempts = await redis.incr(attemptsKey);

      await redis.expire(attemptsKey, LOCK_TTL_SECONDS);
      if (attempts < MAX_SEND_ATTEMPTS) {
        await redis.expire(lockKey, RETRY_DELAY_SECONDS);
      }
      await systemPrisma.auditLog.create({
        data: {
          tenantId: integration.tenantId,
          action: 'telegram_report_failed',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            schedule: window.kind,
            periodStart: window.periodStart.toISOString(),
            periodEnd: window.periodEnd.toISOString(),
            error: error?.message || 'Unknown error',
            attempt: attempts,
            willRetry: attempts < MAX_SEND_ATTEMPTS,
          },
        },
      });

      reportError('Scheduled Telegram report failed', {
        tenantId: integration.tenantId,
        schedule: window.kind,
        attempt: attempts,
        error: error?.message || 'Unknown error',
      });
    }
  }
}
