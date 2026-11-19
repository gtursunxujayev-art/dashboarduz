
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveCallerDataScope } from '../../lib/access';
import { thrownText } from '../../lib/errors';
import { resolveTelegramBotTokenForTenant } from '../../lib/telegram';
import { telegramService } from '../../services/integrations/telegram';
import { listTelegramRecipients } from '../../services/integrations/telegram-recipient-store';
import { protectedProcedure, router } from '../trpc';

/** Who may message users through the bot. Team leaders only read data, so they are not among them. */
export const TELEGRAM_BOT_SENDER_ROLES = ['Admin', 'Manager', 'OnlineAdmin'] as const;

export function canSendTelegramBotMessages(roles: readonly string[]): boolean {
  return roles.some((role) => (TELEGRAM_BOT_SENDER_ROLES as readonly string[]).includes(role));
}

/** The asked users an OnlineAdmin (scoped to the online group) may message; everyone for `null`. */
export function filterTelegramTargetsToScope(userIds: readonly string[], scopeUserIds: readonly string[] | null): string[] {
  if (scopeUserIds === null) return [...userIds];
  const allowed = new Set(scopeUserIds);

  return userIds.filter((id) => allowed.has(id));
}

const telegramSenderProcedure = protectedProcedure.use(async (opts) => {
  if (!canSendTelegramBotMessages(opts.ctx.user.roles || [])) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin, Manager or OnlineAdmin access required' });
  }

  return opts.next();
});

export const telegramBotRouter = router({
  recipients: telegramSenderProcedure.query(async ({ ctx }) => {
    const scope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles || [], ctx.db);
    const [integration, users] = await Promise.all([
      ctx.db.integration.findUnique({
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
      ctx.db.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          ...(scope.userIds ? { id: { in: scope.userIds } } : {}),
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
      ? await listTelegramRecipients({
          tenantId: ctx.tenantId,
          integrationId: integration.id,
          startedOnly: true,
          db: ctx.db,
        })
      : [];
    const recipientsByChatId = new Map(recipients.map((recipient) => [recipient.chatId, recipient]));
    // A scoped sender (OnlineAdmin) only sees the bot chats of their own users.
    const scopedChatIds = scope.userIds
      ? new Set(users.map((user) => String(user.telegramId || '').trim()).filter(Boolean))
      : null;
    const visibleRecipients = scopedChatIds
      ? recipients.filter((recipient) => scopedChatIds.has(recipient.chatId))
      : recipients;

    return {
      connected: Boolean(integration && integration.status === 'active'),
      availableRecipients: visibleRecipients.map((recipient) => ({
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

  sendMessage: telegramSenderProcedure
    .input(
      z.object({
        userIds: z.array(z.string().uuid()).min(1).max(200),
        text: z.string().min(1).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const botToken = await resolveTelegramBotTokenForTenant(ctx.tenantId, ctx.db);

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

      const scope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles || [], ctx.db);
      const users = await ctx.db.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          id: {
            in: filterTelegramTargetsToScope(input.userIds, scope.userIds),
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
            error: thrownText(error),
          });
        }
      }

      await ctx.db.auditLog.create({
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

