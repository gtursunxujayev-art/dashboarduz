import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';
import {
  formatDurationToHms,
  formatReportDate,
  isTodayOrYesterdayInReportTz,
  parseDurationToSeconds,
  parseReportDateInput,
} from '../../services/corporate-call-durations';

const MANAGER_LIKE_ROLES = ['Agent', 'Manager', 'TeamLeader'] as const;

function isAdmin(roles: string[]): boolean {
  return roles.includes('Admin');
}

function canUseCorporateCalls(roles: string[]): boolean {
  return isAdmin(roles)
    || roles.includes('Manager')
    || roles.includes('TeamLeader')
    || roles.includes('Agent');
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
          durationSeconds,
        },
        select: {
          id: true,
          managerUserId: true,
          callDate: true,
          durationSeconds: true,
          manager: {
            select: {
              name: true,
              username: true,
            },
          },
        },
      });

      return {
        id: entry.id,
        managerUserId: entry.managerUserId,
        managerName: String(entry.manager.name || entry.manager.username || entry.managerUserId),
        date: formatReportDate(entry.callDate),
        durationSeconds: entry.durationSeconds,
        duration: formatDurationToHms(entry.durationSeconds),
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
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sana oralig‘i noto‘g‘ri.' });
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
        })),
      };
    }),
});
