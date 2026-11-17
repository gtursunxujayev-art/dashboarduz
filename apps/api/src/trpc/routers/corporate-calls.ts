import type { DbClient } from '@dashboarduz/db';
import { AGENT_ROLES, dateRangeInput, hasAgentRole, toTashkentDateKey } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { formatDuration } from '../../lib/duration';
import { logger } from '../../lib/logger';
import { buildTelegramChatIdCandidates, resolveTelegramBotTokenForTenant, toHashtag } from '../../lib/telegram';
import {
  isTodayOrYesterdayInReportTz,
  parseDurationToSeconds,
  parseReportDateInput,
} from '../../services/corporate-call-durations';
import { telegramService } from '../../services/integrations/telegram';
import { parseTelegramGroupIdsFromEnvKeys } from '../../services/integrations/telegram-groups';
import { protectedProcedure, router } from '../trpc';

const MANAGER_LIKE_ROLES = [...AGENT_ROLES, 'Manager', 'TeamLeader'] as const;
const CORPORATE_GROUP_ENV_KEYS = [
  'KORPORATIV_GROUP_ID',
  'KORPORATIV_GROUP_IDS',
  'CORPORATE_GROUP_ID',
  'CORPORATE_GROUP_IDS',
  'CORPORATE_CALL_GROUP_ID',
  'CORPORATE_CALL_GROUP_IDS',
] as const;

function isAdmin(roles: string[]): boolean {
  return roles.includes('Admin');
}

function canUseCorporateCalls(roles: string[]): boolean {
  return isAdmin(roles)
    || roles.includes('Manager')
    || roles.includes('TeamLeader')
    || hasAgentRole(roles);
}

async function sendCorporateCallAddedTelegram(params: {
  tenantId: string;
  date: string;
  managerName: string;
  duration: string;
  db: DbClient;
}) {
  const { db } = params;

  const groupIds = parseTelegramGroupIdsFromEnvKeys(CORPORATE_GROUP_ENV_KEYS);

  if (!groupIds.length) {
    return { sent: false, reason: 'group_missing' as const };
  }

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId, db);

  if (!botToken) {
    return { sent: false, reason: 'token_missing' as const };
  }

  const message = [
    params.date,
    '#korporativ',
    toHashtag(params.managerName) ?? '#manager',
    "✅ Qo'shildi",
    '',
    `"${params.duration}"`,
  ].join('\n');

  const errors: string[] = [];
  let sentCount = 0;

  for (const groupId of groupIds) {
    const candidates = buildTelegramChatIdCandidates(groupId);
    let delivered = false;
    let lastError = '';

    for (const candidate of candidates) {
      try {
        await telegramService.sendMessage(botToken, candidate, message, {
          disable_web_page_preview: true,
        });
        delivered = true;
        break;
      } catch (error: any) {
        lastError = String(error?.message || error);
      }
    }

    if (delivered) {
      sentCount += 1;
    } else {
      errors.push(`${groupId}: ${lastError || 'Unknown error'}`);
    }
  }

  if (sentCount === 0) {
    return { sent: false, reason: 'send_failed' as const, errors };
  }

  return {
    sent: true,
    sentCount,
    failedCount: groupIds.length - sentCount,
    errors,
  };
}

export const corporateCallsRouter = router({
  getFormOptions: protectedProcedure.query(async ({ ctx }) => {
    if (!canUseCorporateCalls(ctx.user.roles || [])) {
      throw new TRPCError({ code: 'FORBIDDEN', message: "Sizda bu bo'lim uchun ruxsat yo'q." });
    }

    const admin = isAdmin(ctx.user.roles || []);

    const users = admin
      ? await ctx.db.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            roles: { hasSome: [...MANAGER_LIKE_ROLES] },
          },
          orderBy: [{ name: 'asc' }, { username: 'asc' }],
          select: {
            id: true,
            name: true,
            username: true,
          },
        })
      : await ctx.db.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            id: ctx.user.userId,
          },
          select: {
            id: true,
            name: true,
            username: true,
          },
        });

    return {
      canChooseCustomDate: admin,
      managers: users.map((user) => ({
        id: user.id,
        name: String(user.name || user.username || user.id),
      })),
    };
  }),

  upsert: protectedProcedure
    .input(z.object({
      managerUserId: z.string().uuid().optional(),
      date: z.string().min(1),
      duration: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!canUseCorporateCalls(ctx.user.roles || [])) {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Sizda bu bo'lim uchun ruxsat yo'q." });
      }

      const admin = isAdmin(ctx.user.roles || []);
      const callDate = parseReportDateInput(input.date);

      if (!admin && !isTodayOrYesterdayInReportTz(callDate)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "Faqat bugun yoki kecha uchun qo'ng'iroq davomiyligini kiritish mumkin.",
        });
      }

      const targetManagerUserId = admin
        ? (input.managerUserId || ctx.user.userId)
        : ctx.user.userId;

      const manager = await ctx.db.user.findFirst({
        where: {
          id: targetManagerUserId,
          tenantId: ctx.tenantId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          username: true,
        },
      });

      if (!manager) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Menejer topilmadi.' });
      }

      const durationSeconds = parseDurationToSeconds(input.duration);
      const entry = await ctx.db.corporateCallDuration.upsert({
        where: {
          tenantId_managerUserId_callDate: {
            tenantId: ctx.tenantId,
            managerUserId: targetManagerUserId,
            callDate,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          managerUserId: targetManagerUserId,
          callDate,
          durationSeconds,
        },
        update: {
          durationSeconds: {
            increment: durationSeconds,
          },
        },
        select: {
          id: true,
          managerUserId: true,
          callDate: true,
          durationSeconds: true,
          createdAt: true,
          updatedAt: true,
          manager: {
            select: {
              name: true,
              username: true,
            },
          },
        },
      });

      const managerName = String(entry.manager.name || entry.manager.username || entry.managerUserId);
      const date = toTashkentDateKey(entry.callDate);
      const telegram = await sendCorporateCallAddedTelegram({
        tenantId: ctx.tenantId,
        date,
        managerName,
        duration: formatDuration(entry.durationSeconds),
        db: ctx.db,
      });

      if (!telegram.sent) {
        logger.warn({
          tenantId: ctx.tenantId,
          managerUserId: entry.managerUserId,
          date,
          reason: telegram.reason,
          errors: (telegram as any).errors || [],
        }, '[CorporateCalls][Telegram] Failed to send corporate call notification.');
      }

      return {
        id: entry.id,
        managerUserId: entry.managerUserId,
        managerName,
        date,
        durationSeconds: entry.durationSeconds,
        duration: formatDuration(entry.durationSeconds),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        telegram,
      };
    }),

  list: protectedProcedure
    .input(z.object({
      managerUserId: z.string().uuid().optional(),
      ...dateRangeInput.shape,
      limit: z.number().int().positive().max(200).default(60),
    }).optional())
    .query(async ({ ctx, input }) => {
      if (!canUseCorporateCalls(ctx.user.roles || [])) {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Sizda bu bo'lim uchun ruxsat yo'q." });
      }

      const admin = isAdmin(ctx.user.roles || []);
      const now = new Date();
      const defaultDateTo = toTashkentDateKey(now);
      const defaultDateFrom = toTashkentDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

      const dateFrom = parseReportDateInput(input?.dateFrom || defaultDateFrom);
      const dateTo = parseReportDateInput(input?.dateTo || defaultDateTo);

      if (dateTo < dateFrom) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "Sana oralig'i noto'g'ri." });
      }

      const where = {
        tenantId: ctx.tenantId,
        managerUserId: admin ? (input?.managerUserId || undefined) : ctx.user.userId,
        callDate: {
          gte: dateFrom,
          lte: dateTo,
        },
      };

      const rows = await ctx.db.corporateCallDuration.findMany({
        where,
        orderBy: [{ callDate: 'desc' }, { createdAt: 'desc' }],
        take: input?.limit || 60,
        select: {
          id: true,
          managerUserId: true,
          callDate: true,
          durationSeconds: true,
          createdAt: true,
          updatedAt: true,
          manager: {
            select: {
              name: true,
              username: true,
            },
          },
        },
      });

      return {
        rows: rows.map((row) => ({
          id: row.id,
          managerUserId: row.managerUserId,
          managerName: String(row.manager.name || row.manager.username || row.managerUserId),
          date: toTashkentDateKey(row.callDate),
          durationSeconds: row.durationSeconds,
          duration: formatDuration(row.durationSeconds),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      };
    }),

  delete: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!isAdmin(ctx.user.roles || [])) {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Faqat admin o'chira oladi." });
      }

      const existing = await ctx.db.corporateCallDuration.findFirst({
        where: {
          id: input.id,
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
        },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: "Yozuv topilmadi." });
      }

      await ctx.db.corporateCallDuration.delete({
        where: { id: existing.id },
      });

      return { success: true, id: existing.id };
    }),
});
