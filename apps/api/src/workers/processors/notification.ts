import { systemPrisma } from '@dashboarduz/db';

import { telegramService } from '../../services/integrations/telegram';
import { queueService } from '../../services/queue';
import { decryptIntegrationTokens } from '../../services/security/encryption';
import { rateLimiter } from '../../services/security/rate-limiter';

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
      const integration = await systemPrisma.integration.findFirst({
        where: {
          tenantId: notification.tenantId,
          type: 'telegram',
          status: 'active',
        },
      });

      if (!integration?.tokensEncrypted) {
        throw new Error('No active Telegram integration found');
      }

      const tokens = decryptIntegrationTokens<{ botToken?: string }>(integration.tokensEncrypted);

      if (!tokens.botToken) {
        throw new Error('Telegram bot token is missing');
      }

      await sendTelegramNotification(notification.payload as any, tokens.botToken);
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
  } catch (error: any) {
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
        errorMessage: error.message,
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

async function sendTelegramNotification(payload: any, botToken: string) {
  if (!payload?.chatId || !payload?.text) {
    throw new Error('Telegram payload must include chatId and text');
  }

  await telegramService.sendMessage(
    botToken,
    String(payload.chatId),
    String(payload.text),
    payload.options,
  );
}
