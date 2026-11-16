import crypto from 'crypto';

import { telegramBotConnectSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

import { asObjectOrEmpty } from '../../../lib/object';
import { parseTelegramDailyReportCourseIds } from '../../../lib/telegram';
import { getPublicApiBaseUrl, resolveTelegramBotToken, telegramRecipientStorageErrorMessage } from '../../../services/integration-settings/connection';
import { telegramService } from '../../../services/integrations/telegram';
import { getOfflineTelegramGroupIds, getOnlineTelegramGroupIds } from '../../../services/integrations/telegram-groups';
import { importLegacyTelegramRecipients, listTelegramRecipients } from '../../../services/integrations/telegram-recipient-store';
import { applyTelegramRecipientsToConfig, parseTelegramRecipients } from '../../../services/integrations/telegram-recipients';
import { encryptIntegrationTokens } from '../../../services/security/encryption';
import { adminProcedure } from '../../trpc';

export const telegramIntegrationProcedures = {
  connectTelegram: adminProcedure
    .input(telegramBotConnectSchema)
    .mutation(async ({ input, ctx }) => {
      const { telegramService } = await import('../../../services/integrations/telegram');
      const verification = await telegramService.verifyBotToken(input.botToken);

      if (!verification.isValid || !verification.bot) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Telegram bot token' });
      }

      const webhookSecret = crypto.randomBytes(24).toString('hex');
      const webhookUrl = `${getPublicApiBaseUrl()}/webhooks/telegram`;
      const webhookResult = await telegramService.setWebhook(input.botToken, webhookUrl, webhookSecret);

      if (!webhookResult?.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Failed to register Telegram webhook' });
      }

      const existing = await ctx.db.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'telegram',
          },
        },
        select: {
          config: true,
        },
      });
      const existingRecipients = parseTelegramRecipients(existing?.config);
      const existingDailyReportCourseIds = parseTelegramDailyReportCourseIds(existing?.config);

      const validatedAt = new Date();
      let integration = await ctx.db.integration.upsert({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'telegram',
          },
        },
        update: {
          status: 'active',
          tokensEncrypted: encryptIntegrationTokens({ botToken: input.botToken }),
          config: {
            botId: String(verification.bot.id),
            botUsername: verification.bot.username || null,
            botName: verification.bot.first_name || null,
            webhookUrl,
            webhookSecret,
            telegramReportRecipients: existingRecipients,
            reportRecipientChatIds: existingRecipients
              .filter((recipient) => recipient.started && recipient.selectedForReports)
              .map((recipient) => recipient.chatId),
            telegramDailyReportCourseIds: existingDailyReportCourseIds,
            lastValidatedAt: validatedAt.toISOString(),
          },
          lastSyncAt: validatedAt,
        },
        create: {
          tenantId: ctx.tenantId,
          type: 'telegram',
          status: 'active',
          tokensEncrypted: encryptIntegrationTokens({ botToken: input.botToken }),
          config: {
            botId: String(verification.bot.id),
            botUsername: verification.bot.username || null,
            botName: verification.bot.first_name || null,
            webhookUrl,
            webhookSecret,
            telegramReportRecipients: existingRecipients,
            reportRecipientChatIds: existingRecipients
              .filter((recipient) => recipient.started && recipient.selectedForReports)
              .map((recipient) => recipient.chatId),
            telegramDailyReportCourseIds: existingDailyReportCourseIds,
            lastValidatedAt: validatedAt.toISOString(),
          },
          lastSyncAt: validatedAt,
        },
      });

      await importLegacyTelegramRecipients({
        tenantId: ctx.tenantId,
        integrationId: integration.id,
        config: existing?.config,
        db: ctx.db,
      });
      const storedRecipients = await listTelegramRecipients({
        tenantId: ctx.tenantId,
        integrationId: integration.id,
        db: ctx.db,
      });

      integration = await ctx.db.integration.update({
        where: { id: integration.id },
        data: {
          config: {
            ...applyTelegramRecipientsToConfig(integration.config, storedRecipients),
            botId: String(verification.bot.id),
            botUsername: verification.bot.username || null,
            botName: verification.bot.first_name || null,
            webhookUrl,
            webhookSecret,
            telegramDailyReportCourseIds: existingDailyReportCourseIds,
            lastValidatedAt: validatedAt.toISOString(),
          },
        },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'integration_connect',
          resource: 'integration',
          resourceId: integration.id,
          metadata: { type: 'telegram' },
        },
      });

      return {
        integration,
        connection: {
          verified: true,
          validatedAt: validatedAt.toISOString(),
          bot: {
            id: verification.bot.id,
            username: verification.bot.username,
            name: verification.bot.first_name,
          },
          webhookUrl,
        },
      };
    }),
  getTelegramHealth: adminProcedure.query(async ({ ctx }) => {
    const integration = await ctx.db.integration.findUnique({
      where: {
        tenantId_type: {
          tenantId: ctx.tenantId,
          type: 'telegram',
        },
      },
      select: {
        id: true,
        status: true,
        config: true,
        tokensEncrypted: true,
      },
    });
    const expectedWebhookUrl = `${getPublicApiBaseUrl()}/webhooks/telegram`;
    const onlineGroupCount = getOnlineTelegramGroupIds().length;
    const offlineGroupCount = getOfflineTelegramGroupIds().length;

    if (!integration || integration.status !== 'active') {
      return {
        connected: false,
        healthy: false,
        expectedWebhookUrl,
        storedWebhookUrl: null,
        liveWebhookUrl: null,
        webhookMatches: false,
        pendingUpdateCount: 0,
        lastErrorAt: null,
        lastErrorMessage: null,
        lastInboundAt: null,
        lastInboundUpdateId: null,
        recipientCount: 0,
        recipientStorageReady: true,
        recipientError: null as string | null,
        onlineGroupCount,
        offlineGroupCount,
        schedulerReady: false,
        error: 'Telegram integration is not connected.',
      };
    }

    const config = asObjectOrEmpty(integration.config);
    let recipientCount = 0;
    let latestRecipient: { lastSeenAt: Date | null; lastUpdateId: string | null } | null = null;
    let recipientStorageReady = true;
    let recipientError: string | null = null;

    try {
      [recipientCount, latestRecipient] = await Promise.all([
        ctx.db.telegramRecipient.count({
          where: { tenantId: ctx.tenantId, integrationId: integration.id, started: true },
        }),
        ctx.db.telegramRecipient.findFirst({
          where: { tenantId: ctx.tenantId, integrationId: integration.id },
          orderBy: { lastSeenAt: 'desc' },
          select: { lastSeenAt: true, lastUpdateId: true },
        }),
      ]);
    } catch {
      recipientStorageReady = false;
      recipientError = telegramRecipientStorageErrorMessage();
    }
    const storedWebhookUrl = String(config.webhookUrl || '').trim() || null;

    try {
      const botToken = resolveTelegramBotToken(integration.tokensEncrypted);

      if (!botToken) throw new Error('Telegram bot token is missing.');
      const live = await telegramService.getWebhookInfo(botToken);
      const liveWebhookUrl = String(live.url || '').trim() || null;
      const webhookMatches = liveWebhookUrl === expectedWebhookUrl;
      const lastErrorAt = live.last_error_date
        ? new Date(live.last_error_date * 1000).toISOString()
        : null;

      return {
        connected: true,
        healthy: webhookMatches && !live.last_error_message && recipientStorageReady,
        expectedWebhookUrl,
        storedWebhookUrl,
        liveWebhookUrl,
        webhookMatches,
        pendingUpdateCount: Number(live.pending_update_count || 0),
        lastErrorAt,
        lastErrorMessage: live.last_error_message || null,
        lastInboundAt: latestRecipient?.lastSeenAt?.toISOString() || null,
        lastInboundUpdateId: latestRecipient?.lastUpdateId || null,
        recipientCount,
        recipientStorageReady,
        recipientError,
        onlineGroupCount,
        offlineGroupCount,
        schedulerReady: Boolean(botToken && onlineGroupCount > 0 && offlineGroupCount > 0),
        error: null,
      };
    } catch (error: any) {
      return {
        connected: true,
        healthy: false,
        expectedWebhookUrl,
        storedWebhookUrl,
        liveWebhookUrl: null,
        webhookMatches: false,
        pendingUpdateCount: 0,
        lastErrorAt: null,
        lastErrorMessage: null,
        lastInboundAt: latestRecipient?.lastSeenAt?.toISOString() || null,
        lastInboundUpdateId: latestRecipient?.lastUpdateId || null,
        recipientCount,
        recipientStorageReady,
        recipientError,
        onlineGroupCount,
        offlineGroupCount,
        schedulerReady: false,
        error: String(error?.message || error),
      };
    }
  }),
  repairTelegramWebhook: adminProcedure.mutation(async ({ ctx }) => {
    const integration = await ctx.db.integration.findUnique({
      where: { tenantId_type: { tenantId: ctx.tenantId, type: 'telegram' } },
      select: { id: true, status: true, config: true, tokensEncrypted: true },
    });

    if (!integration || integration.status !== 'active') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Telegram integration is not connected.' });
    }

    try {
      const botToken = resolveTelegramBotToken(integration.tokensEncrypted);

      if (!botToken) throw new Error('Telegram bot token is missing.');
      const config = asObjectOrEmpty(integration.config);
      const webhookSecret = String(config.webhookSecret || '').trim() || crypto.randomBytes(24).toString('hex');
      const webhookUrl = `${getPublicApiBaseUrl()}/webhooks/telegram`;
      const result = await telegramService.setWebhook(botToken, webhookUrl, webhookSecret);

      if (!result?.ok) {
        throw new Error(String(result?.description || 'Telegram webhook registration failed.'));
      }
      const repairedAt = new Date();

      await ctx.db.integration.update({
        where: { id: integration.id },
        data: {
          config: {
            ...config,
            webhookUrl,
            webhookSecret,
            lastValidatedAt: repairedAt.toISOString(),
          },
          lastSyncAt: repairedAt,
          errorMessage: null,
        },
      });
      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'telegram_webhook_repaired',
          resource: 'integration',
          resourceId: integration.id,
          metadata: { webhookUrl },
        },
      });

      return { success: true, webhookUrl, repairedAt: repairedAt.toISOString() };
    } catch (error: any) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error?.message || 'Telegram webhookni qayta ulashda xatolik',
      });
    }
  }),
};
