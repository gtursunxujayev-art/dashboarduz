import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { parseTelegramRecipients } from '../../services/integrations/telegram-recipients';
import { telegramService } from '../../services/integrations/telegram';
import { decryptIntegrationTokens } from '../../services/security/encryption';
import { managerProcedure, router } from '../trpc';

function normalizeTelegramSecret(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }
  return normalized.replace(/\r?\n/g, '').trim();
}

async function resolveTelegramBotTokenForTenant(tenantId: string): Promise<string | null> {
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'telegram',
      },
    },
    select: {
      status: true,
      tokensEncrypted: true,
    },
  });

  let botToken = normalizeTelegramSecret(process.env.TELEGRAM_BOT_TOKEN || undefined);
  if (integration?.status === 'active' && integration.tokensEncrypted) {
    try {
      const tokens = decryptIntegrationTokens<{ botToken?: string; token?: string }>(integration.tokensEncrypted);
      const integrationBotToken = normalizeTelegramSecret(tokens.botToken || tokens.token);
      botToken = integrationBotToken || botToken;
    } catch (error) {
      console.warn('[TelegramBot] Failed to decrypt integration bot token, fallback to TELEGRAM_BOT_TOKEN', {
        tenantId,
        error: String((error as any)?.message || error),
      });
    }
  }

  return botToken;
}

export const telegramBotRouter = router({
  recipients: managerProcedure.query(async ({ ctx }) => {
    const [integration, users] = await Promise.all([
      prisma.integration.findUnique({
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
        },
      }),
      prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
        },
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          phone: true,
          roles: true,
          isActive: true,
          telegramId: true,
        },
      }),
    ]);

    const recipients = integration?.status === 'active'
      ? parseTelegramRecipients(integration.config).filter((recipient) => recipient.started)
      : [];
    const recipientsByChatId = new Map(recipients.map((recipient) => [recipient.chatId, recipient]));

    return {
      connected: Boolean(integration && integration.status === 'active'),
      availableRecipients: recipients.map((recipient) => ({
        chatId: recipient.chatId,
        displayName: recipient.displayName,
        username: recipient.username,
        startedAt: recipient.startedAt,
        lastSeenAt: recipient.lastSeenAt,
      })),
      users: users.map((user) => {
        const telegramChatId = String(user.telegramId || '').trim() || null;
        const recipient = telegramChatId ? recipientsByChatId.get(telegramChatId) || null : null;
        return {
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          phone: user.phone,
          roles: user.roles,
          isActive: user.isActive,
          telegramChatId,
          telegramDisplayName: recipient?.displayName || null,
          telegramUsername: recipient?.username || null,
          telegramLastSeenAt: recipient?.lastSeenAt || null,
          canSend: Boolean(telegramChatId),
        };
      }),
    };
  }),

  sendMessage: managerProcedure
    .input(
      z.object({
        userIds: z.array(z.string().uuid()).min(1).max(200),
        text: z.string().min(1).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const botToken = await resolveTelegramBotTokenForTenant(ctx.tenantId);
      if (!botToken) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Telegram bot token topilmadi. Avval Integratsiyalar bo'limida Telegram botni ulang.",
        });
      }

      const text = input.text.trim();
      if (!text) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Xabar matni bo‘sh bo‘lishi mumkin emas.',
        });
      }

      const users = await prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          id: {
            in: input.userIds,
          },
        },
        select: {
          id: true,
          name: true,
          username: true,
          telegramId: true,
        },
      });

      const targets = users
        .map((user) => ({
          userId: user.id,
          label: user.name || user.username || user.id,
          chatId: String(user.telegramId || '').trim(),
        }))
        .filter((row) => row.chatId.length > 0);

      if (targets.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Tanlangan foydalanuvchilarda Telegram bog'lanishi yo'q.",
        });
      }

      const failed: Array<{ userId: string; chatId: string; error: string }> = [];
      let delivered = 0;
      for (const target of targets) {
        try {
          await telegramService.sendMessage(botToken, target.chatId, text, {
            disable_web_page_preview: true,
          });
          delivered += 1;
        } catch (error) {
          failed.push({
            userId: target.userId,
            chatId: target.chatId,
            error: String((error as any)?.message || error),
          });
        }
      }

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'telegram_bot_send',
          resource: 'notification',
          metadata: {
            requestedUsers: input.userIds.length,
            targetUsers: targets.length,
            delivered,
            failed: failed.length,
          },
        },
      });

      return {
        requestedUsers: input.userIds.length,
        targetUsers: targets.length,
        delivered,
        failed,
      };
    }),
});

