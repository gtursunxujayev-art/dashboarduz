import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { decryptIntegrationTokens } from '../../services/security/encryption';
import { telegramService } from '../../services/integrations/telegram';
import { protectedProcedure, router } from '../trpc';
import {
  formatDurationToHms,
  formatReportDate,
  isTodayOrYesterdayInReportTz,
  parseDurationToSeconds,
  parseReportDateInput,
} from '../../services/corporate-call-durations';

const MANAGER_LIKE_ROLES = ['Agent', 'Manager', 'TeamLeader'] as const;
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
    || roles.includes('Agent');
}

function parseTelegramGroupIds(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  const stripWrappingQuotes = (value: string): string => value.replace(/^['"`]+|['"`]+$/g, '').trim();

  return Array.from(
    new Set(
      rawValue
        .split(/[,\n;]+/g)
        .map((value) => stripWrappingQuotes(value))
        .map((value) => value.replace(/\s+/g, ''))
        .filter(Boolean),
    ),
  );
}

function parseTelegramGroupIdsFromEnvKeys(keys: readonly string[]): string[] {
  return Array.from(
    new Set(keys.flatMap((key) => parseTelegramGroupIds(process.env[key]))),
  );
}

function normalizeTelegramSecret(rawValue: string | undefined): string | null {
  if (!rawValue) {
    return null;
  }
  const normalized = rawValue.replace(/^['"`]+|['"`]+$/g, '').trim();
  return normalized || null;
}

function buildTelegramChatIdCandidates(groupId: string): string[] {
  const normalized = String(groupId || '').trim();
  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>([normalized]);
  if (/^-100\d+$/.test(normalized)) {
    candidates.add(`-${normalized.slice(4)}`);
  } else if (/^-\d+$/.test(normalized) && !normalized.startsWith('-100')) {
    candidates.add(`-100${normalized.slice(1)}`);
  }
  return Array.from(candidates);
}

function toHashtag(value: string | null | undefined): string {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/['`]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');

  return normalized ? `#${normalized}` : '#manager';
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
      console.warn('[CorporateCalls][Telegram] Failed to decrypt integration token, using TELEGRAM_BOT_TOKEN fallback.', {
        tenantId,
        error: String((error as any)?.message || error),
      });
    }
  }

  return botToken;
}

async function sendCorporateCallAddedTelegram(params: {
  tenantId: string;
  date: string;
  managerName: string;
  duration: string;
}) {
  const groupIds = parseTelegramGroupIdsFromEnvKeys(CORPORATE_GROUP_ENV_KEYS);
  if (!groupIds.length) {
    return { sent: false, reason: 'group_missing' as const };
  }

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId);
  if (!botToken) {
    return { sent: false, reason: 'token_missing' as const };
  }

  const message = [
    params.date,
    '#korporativ',
    toHashtag(params.managerName),
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
      ? await prisma.user.findMany({
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
      : await prisma.user.findMany({
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

      const manager = await prisma.user.findFirst({
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
      const entry = await prisma.corporateCallDuration.upsert({
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
      const date = formatReportDate(entry.callDate);
      const telegram = await sendCorporateCallAddedTelegram({
        tenantId: ctx.tenantId,
        date,
        managerName,
        duration: formatDurationToHms(entry.durationSeconds),
      });

      if (!telegram.sent) {
        console.warn('[CorporateCalls][Telegram] Failed to send corporate call notification.', {
          tenantId: ctx.tenantId,
          managerUserId: entry.managerUserId,
          date,
          reason: telegram.reason,
          errors: (telegram as any).errors || [],
        });
      }

      return {
        id: entry.id,
        managerUserId: entry.managerUserId,
        managerName,
        date,
        durationSeconds: entry.durationSeconds,
        duration: formatDurationToHms(entry.durationSeconds),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        telegram,
      };
    }),

  list: protectedProcedure
    .input(z.object({
      managerUserId: z.string().uuid().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      limit: z.number().int().positive().max(200).default(60),
    }).optional())
    .query(async ({ ctx, input }) => {
      if (!canUseCorporateCalls(ctx.user.roles || [])) {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Sizda bu bo'lim uchun ruxsat yo'q." });
      }

      const admin = isAdmin(ctx.user.roles || []);
      const now = new Date();
      const defaultDateTo = formatReportDate(now);
      const defaultDateFrom = formatReportDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));

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

      const rows = await prisma.corporateCallDuration.findMany({
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
          date: formatReportDate(row.callDate),
          durationSeconds: row.durationSeconds,
          duration: formatDurationToHms(row.durationSeconds),
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

      const existing = await prisma.corporateCallDuration.findFirst({
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

      await prisma.corporateCallDuration.delete({
        where: { id: existing.id },
      });

      return { success: true, id: existing.id };
    }),
});
