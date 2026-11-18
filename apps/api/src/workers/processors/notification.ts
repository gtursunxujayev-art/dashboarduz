import { systemPrisma } from '@dashboarduz/db';

import { errorMessage } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { asObject } from '../../lib/object';
import { resolveTenantNotificationBotToken } from '../../lib/telegram';
import { telegramService } from '../../services/integrations/telegram';
import { queueService } from '../../services/queue';
import { rateLimiter } from '../../services/security/rate-limiter';

/** Stored on a telegram notification that was not sent because its tenant has no active Telegram integration. */
export const NO_ACTIVE_TELEGRAM_INTEGRATION = 'No active Telegram integration; not sent';

export async function processNotification(notificationId: string) {
  try {
    const notification = await systemPrisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new Error(`Notification ${notificationId} not found`);
    }
    if (notification.status === 'sent') {
      return;
    }

    const rateLimit = await rateLimiter.isAllowed(notification.tenantId, 'notifications:fanout', {
      maxRequests: 120,
      windowMs: 60 * 1000,
      keyPrefix: 'notifications',
    });

    if (!rateLimit.allowed) {
      throw new Error('Per-tenant notification rate limit exceeded');
    }

    if (notification.type === 'telegram') {
      // Tenant notifications go out only through the tenant's own active Telegram integration (never the
      // platform bot). Without one the notification is closed without a send, a retry or an error.
      const botToken = await resolveTenantNotificationBotToken(notification.tenantId, systemPrisma);

      if (!botToken) {
        logger.info(
          { notificationId, tenantId: notification.tenantId },
          '[Notification] No active Telegram integration for tenant; not sent',
        );
        await systemPrisma.notification.update({
          where: { id: notificationId },
          data: {
            status: 'failed',
            attempts: { increment: 1 },
            errorMessage: NO_ACTIVE_TELEGRAM_INTEGRATION,
            nextRetryAt: null,
          },
        });

        return;
      }

      await sendTelegramNotification(notification.payload, botToken);
    } else if (notification.type === 'email') {
      throw new Error('Email notification not implemented');
    } else if (notification.type === 'sms') {
      throw new Error('SMS notification not implemented');
    } else {
      throw new Error(`Unsupported notification type: ${notification.type}`);
    }

    await systemPrisma.notification.update({
      where: { id: notificationId },
      data: {
        status: 'sent',
        sentAt: new Date(),
        attempts: { increment: 1 },
        errorMessage: null,
      },
    });
  } catch (error: unknown) {
    const notification = await systemPrisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw error;
    }

    const nextAttempts = notification.attempts + 1;
    const shouldRetry = nextAttempts < notification.maxAttempts;
    const nextRetryAt = shouldRetry
      ? new Date(Date.now() + Math.pow(2, Math.max(0, notification.attempts)) * 1000)
      : null;

    await systemPrisma.notification.update({
      where: { id: notificationId },
      data: {
        attempts: { increment: 1 },
        errorMessage: errorMessage(error),
        status: shouldRetry ? 'retrying' : 'failed',
        nextRetryAt,
      },
    });

    if (shouldRetry && nextRetryAt) {
      await queueService.addNotificationJob(notificationId, {
        delay: nextRetryAt.getTime() - Date.now(),
      });
    }

    throw error;
  }
}

/** A stored telegram notification payload: `{ chatId, text, options? }` (options go to sendMessage as they are). */
async function sendTelegramNotification(payload: unknown, botToken: string) {
  const message = asObject(payload);

  if (!message?.chatId || !message.text) {
    throw new Error('Telegram payload must include chatId and text');
  }

  await telegramService.sendMessage(
    botToken,
    String(message.chatId),
    String(message.text),
    message.options,
  );
}
