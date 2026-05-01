import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { adminProcedure, managerProcedure, protectedProcedure, router } from '../trpc';
import { recomputeAttendanceDaySummary, recomputeAttendanceSummariesForRange } from '../../services/attendance/faceid';

const privilegedReadRoles = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);

function canReadAllUsers(roles: string[]): boolean {
  return roles.some((role) => privilegedReadRoles.has(role));
}

function parseDateKey(value: string, fieldName: string): string {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${fieldName} YYYY-MM-DD formatda bo'lishi kerak.`,
    });
  }
  return normalized;
}

function parseDateTime(value: string, fieldName: string): Date {
  const parsed = new Date(String(value || '').trim());
  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${fieldName} noto'g'ri formatda.`,
    });
  }
  return parsed;
}

function toLocalDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalTimeValue(date: Date): string {
  const shifted = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  const ss = String(shifted.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function readFaceMatchMeta(rawPayload: unknown): {
  matchReason: string | null;
  matchStepTried: string | null;
  rawUser: { id: string | null; firstName: string | null; lastName: string | null; phone: string | null } | null;
} {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return { matchReason: null, matchStepTried: null, rawUser: null };
  }

  const meta = (rawPayload as Record<string, unknown>).__matchMeta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { matchReason: null, matchStepTried: null, rawUser: null };
  }

  const matchReason = String((meta as Record<string, unknown>).matchReason || '').trim() || null;
  const matchStepTried = String((meta as Record<string, unknown>).matchStepTried || '').trim() || null;
  const rawUserValue = (meta as Record<string, unknown>).rawUser;
  const rawUser =
    rawUserValue && typeof rawUserValue === 'object' && !Array.isArray(rawUserValue)
      ? {
          id: String((rawUserValue as Record<string, unknown>).id || '').trim() || null,
          firstName: String((rawUserValue as Record<string, unknown>).firstName || '').trim() || null,
          lastName: String((rawUserValue as Record<string, unknown>).lastName || '').trim() || null,
          phone: String((rawUserValue as Record<string, unknown>).phone || '').trim() || null,
        }
      : null;

  return { matchReason, matchStepTried, rawUser };
}

export const attendanceRouter = router({
  listEvents: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1).optional(),
        limit: z.number().int().min(1).max(200).default(50).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        userId: z.string().uuid().optional(),
        action: z.enum(['IN', 'OUT']).optional(),
        query: z.string().trim().optional(),
        unmatchedOnly: z.boolean().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const page = input?.page || 1;
      const limit = input?.limit || 50;
      const skip = (page - 1) * limit;
      const canReadAll = canReadAllUsers(ctx.user.roles);
      const scopedUserId = canReadAll ? (input?.userId || undefined) : ctx.user.userId;

      const dateFilter =
        input?.dateFrom || input?.dateTo
          ? {
              gte: input?.dateFrom ? parseDateKey(input.dateFrom, 'dateFrom') : undefined,
              lte: input?.dateTo ? parseDateKey(input.dateTo, 'dateTo') : undefined,
            }
          : undefined;

      const query = String(input?.query || '').trim();
      const where = {
        tenantId: ctx.tenantId,
        ...(scopedUserId ? { userId: scopedUserId } : {}),
        ...(input?.action ? { action: input.action } : {}),
        ...(dateFilter ? { localDate: dateFilter } : {}),
        ...(input?.unmatchedOnly ? { userId: null as string | null } : {}),
        ...(query
          ? {
              OR: [
                { externalPhone: { contains: query, mode: 'insensitive' as const } },
                { firstName: { contains: query, mode: 'insensitive' as const } },
                { lastName: { contains: query, mode: 'insensitive' as const } },
                { user: { name: { contains: query, mode: 'insensitive' as const } } },
                { user: { username: { contains: query, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.attendanceEvent.findMany({
          where,
          orderBy: [{ eventAt: 'desc' }, { createdAt: 'desc' }],
          skip,
          take: limit,
          select: {
            id: true,
            userId: true,
            externalUserId: true,
            externalPhone: true,
            firstName: true,
            lastName: true,
            externalRole: true,
            eventType: true,
            action: true,
            eventAt: true,
            localDate: true,
            localTime: true,
            source: true,
            branchName: true,
            latitude: true,
            longitude: true,
            lateMinutes: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                username: true,
                roles: true,
              },
            },
          },
        }),
        prisma.attendanceEvent.count({ where }),
      ]);

      return {
        page,
        limit,
        total,
        hasMore: skip + rows.length < total,
        rows,
      };
    }),

  listDailySummaries: protectedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1).optional(),
        limit: z.number().int().min(1).max(200).default(50).optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        userId: z.string().uuid().optional(),
        query: z.string().trim().optional(),
        anomaliesOnly: z.boolean().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const page = input?.page || 1;
      const limit = input?.limit || 50;
      const skip = (page - 1) * limit;
      const canReadAll = canReadAllUsers(ctx.user.roles);
      const scopedUserId = canReadAll ? (input?.userId || undefined) : ctx.user.userId;

      const dateFilter =
        input?.dateFrom || input?.dateTo
          ? {
              gte: input?.dateFrom ? parseDateKey(input.dateFrom, 'dateFrom') : undefined,
              lte: input?.dateTo ? parseDateKey(input.dateTo, 'dateTo') : undefined,
            }
          : undefined;

      const query = String(input?.query || '').trim();
      const where = {
        tenantId: ctx.tenantId,
        ...(scopedUserId ? { userId: scopedUserId } : {}),
        ...(dateFilter ? { summaryDate: dateFilter } : {}),
        ...(input?.anomaliesOnly ? { OR: [{ anomalyCount: { gt: 0 } }, { absence: true }] } : {}),
        ...(query
          ? {
              OR: [
                { user: { name: { contains: query, mode: 'insensitive' as const } } },
                { user: { username: { contains: query, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      };

      const [rows, total] = await Promise.all([
        prisma.attendanceDaySummary.findMany({
          where,
          orderBy: [{ summaryDate: 'desc' }, { updatedAt: 'desc' }],
          skip,
          take: limit,
          select: {
            id: true,
            userId: true,
            summaryDate: true,
            workedSeconds: true,
            requiredSeconds: true,
            missingSeconds: true,
            lateMinutes: true,
            lateCount: true,
            absence: true,
            unmatchedInCount: true,
            unmatchedOutCount: true,
            anomalyCount: true,
            firstInAt: true,
            lastOutAt: true,
            sourceUpdatedAt: true,
            updatedAt: true,
            user: {
              select: {
                id: true,
                name: true,
                username: true,
                roles: true,
              },
            },
          },
        }),
        prisma.attendanceDaySummary.count({ where }),
      ]);

      return {
        page,
        limit,
        total,
        hasMore: skip + rows.length < total,
        rows,
      };
    }),

  listAnomalies: managerProcedure
    .input(
      z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(100).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit || 100;
      const dateFilter =
        input?.dateFrom || input?.dateTo
          ? {
              gte: input?.dateFrom ? parseDateKey(input.dateFrom, 'dateFrom') : undefined,
              lte: input?.dateTo ? parseDateKey(input.dateTo, 'dateTo') : undefined,
            }
          : undefined;

      const [summaryAnomalies, unmatchedEvents] = await Promise.all([
        prisma.attendanceDaySummary.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(dateFilter ? { summaryDate: dateFilter } : {}),
            OR: [{ anomalyCount: { gt: 0 } }, { absence: true }],
          },
          orderBy: [{ summaryDate: 'desc' }, { anomalyCount: 'desc' }],
          take: limit,
          select: {
            id: true,
            userId: true,
            summaryDate: true,
            anomalyCount: true,
            absence: true,
            unmatchedInCount: true,
            unmatchedOutCount: true,
            missingSeconds: true,
            lateMinutes: true,
            user: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
          },
        }),
        prisma.attendanceEvent.findMany({
          where: {
            tenantId: ctx.tenantId,
            userId: null,
            ...(dateFilter ? { localDate: dateFilter } : {}),
          },
          orderBy: [{ eventAt: 'desc' }],
          take: limit,
          select: {
            id: true,
            localDate: true,
            action: true,
            eventAt: true,
            externalUserId: true,
            externalPhone: true,
            firstName: true,
            lastName: true,
            branchName: true,
            lateMinutes: true,
            rawPayload: true,
          },
        }),
      ]);

      return {
        summaryAnomalies,
        unmatchedEvents: unmatchedEvents.map((row) => {
          const matchMeta = readFaceMatchMeta(row.rawPayload);
          return {
            id: row.id,
            localDate: row.localDate,
            action: row.action,
            eventAt: row.eventAt,
            externalUserId: row.externalUserId,
            externalPhone: row.externalPhone,
            firstName: row.firstName,
            lastName: row.lastName,
            branchName: row.branchName,
            lateMinutes: row.lateMinutes,
            matchReason: matchMeta.matchReason,
            matchStepTried: matchMeta.matchStepTried,
            rawUser: matchMeta.rawUser,
          };
        }),
      };
    }),

  applyCorrection: adminProcedure
    .input(
      z.discriminatedUnion('action', [
        z.object({
          action: z.literal('add_missing_in'),
          userId: z.string().uuid(),
          timestamp: z.string().min(1),
          reason: z.string().min(1).max(500),
        }),
        z.object({
          action: z.literal('add_missing_out'),
          userId: z.string().uuid(),
          timestamp: z.string().min(1),
          reason: z.string().min(1).max(500),
        }),
        z.object({
          action: z.literal('edit_event_time'),
          eventId: z.string().uuid(),
          timestamp: z.string().min(1),
          reason: z.string().min(1).max(500),
        }),
        z.object({
          action: z.literal('mark_justified_absence'),
          userId: z.string().uuid(),
          summaryDate: z.string().min(1),
          reason: z.string().min(1).max(500),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.action === 'add_missing_in') {
        const eventAt = parseDateTime(input.timestamp, 'timestamp');
        const localDate = toLocalDateKey(eventAt);
        const localTime = toLocalTimeValue(eventAt);

        const createdEvent = await prisma.attendanceEvent.create({
          data: {
            tenantId: ctx.tenantId,
            userId: input.userId,
            eventType: 'check_in_out',
            action: 'IN',
            eventAt,
            localDate,
            localTime,
            source: 'FACE_ID_MANUAL',
            lateMinutes: 0,
            idempotencyKey: `manual-in:${ctx.tenantId}:${input.userId}:${eventAt.toISOString()}`,
            rawPayload: {
              manual: true,
              correctionReason: input.reason,
              actorUserId: ctx.user.userId,
            },
          },
          select: {
            id: true,
          },
        });

        const adjustment = await prisma.attendanceAdjustment.create({
          data: {
            tenantId: ctx.tenantId,
            userId: input.userId,
            eventId: createdEvent.id,
            summaryDate: localDate,
            action: input.action,
            reason: input.reason,
            beforeData: undefined,
            afterData: {
              createdEventId: createdEvent.id,
              eventAt: eventAt.toISOString(),
              localDate,
            },
            createdByUserId: ctx.user.userId,
          },
          select: { id: true },
        });

        await prisma.attendanceAdjustmentAudit.create({
          data: {
            adjustmentId: adjustment.id,
            tenantId: ctx.tenantId,
            actorUserId: ctx.user.userId,
            action: 'created',
            metadata: {
              correctionAction: input.action,
            },
          },
        });

        await recomputeAttendanceDaySummary({
          tenantId: ctx.tenantId,
          userId: input.userId,
          localDate,
        });

        return {
          success: true,
          adjustmentId: adjustment.id,
        };
      }

      if (input.action === 'add_missing_out') {
        const eventAt = parseDateTime(input.timestamp, 'timestamp');
        const localDate = toLocalDateKey(eventAt);
        const localTime = toLocalTimeValue(eventAt);

        const createdEvent = await prisma.attendanceEvent.create({
          data: {
            tenantId: ctx.tenantId,
            userId: input.userId,
            eventType: 'check_in_out',
            action: 'OUT',
            eventAt,
            localDate,
            localTime,
            source: 'FACE_ID_MANUAL',
            lateMinutes: 0,
            idempotencyKey: `manual-out:${ctx.tenantId}:${input.userId}:${eventAt.toISOString()}`,
            rawPayload: {
              manual: true,
              correctionReason: input.reason,
              actorUserId: ctx.user.userId,
            },
          },
          select: {
            id: true,
          },
        });

        const adjustment = await prisma.attendanceAdjustment.create({
          data: {
            tenantId: ctx.tenantId,
            userId: input.userId,
            eventId: createdEvent.id,
            summaryDate: localDate,
            action: input.action,
            reason: input.reason,
            beforeData: undefined,
            afterData: {
              createdEventId: createdEvent.id,
              eventAt: eventAt.toISOString(),
              localDate,
            },
            createdByUserId: ctx.user.userId,
          },
          select: { id: true },
        });

        await prisma.attendanceAdjustmentAudit.create({
          data: {
            adjustmentId: adjustment.id,
            tenantId: ctx.tenantId,
            actorUserId: ctx.user.userId,
            action: 'created',
            metadata: {
              correctionAction: input.action,
            },
          },
        });

        await recomputeAttendanceDaySummary({
          tenantId: ctx.tenantId,
          userId: input.userId,
          localDate,
        });

        return {
          success: true,
          adjustmentId: adjustment.id,
        };
      }

      if (input.action === 'edit_event_time') {
        const targetEvent = await prisma.attendanceEvent.findFirst({
          where: {
            id: input.eventId,
            tenantId: ctx.tenantId,
          },
          select: {
            id: true,
            userId: true,
            eventAt: true,
            localDate: true,
            localTime: true,
            action: true,
          },
        });
        if (!targetEvent) {
          throw new TRPCError({ code: 'NOT_FOUND', message: "Attendance event topilmadi." });
        }

        const newEventAt = parseDateTime(input.timestamp, 'timestamp');
        const newLocalDate = toLocalDateKey(newEventAt);
        const newLocalTime = toLocalTimeValue(newEventAt);

        const updated = await prisma.attendanceEvent.update({
          where: { id: targetEvent.id },
          data: {
            eventAt: newEventAt,
            localDate: newLocalDate,
            localTime: newLocalTime,
            source: targetEvent.action === 'IN' || targetEvent.action === 'OUT' ? 'FACE_ID_MANUAL' : undefined,
          },
          select: { id: true, userId: true },
        });

        const adjustment = await prisma.attendanceAdjustment.create({
          data: {
            tenantId: ctx.tenantId,
            userId: updated.userId,
            eventId: updated.id,
            summaryDate: newLocalDate,
            action: input.action,
            reason: input.reason,
            beforeData: {
              eventAt: targetEvent.eventAt.toISOString(),
              localDate: targetEvent.localDate,
              localTime: targetEvent.localTime,
            },
            afterData: {
              eventAt: newEventAt.toISOString(),
              localDate: newLocalDate,
              localTime: newLocalTime,
            },
            createdByUserId: ctx.user.userId,
          },
          select: { id: true },
        });

        await prisma.attendanceAdjustmentAudit.create({
          data: {
            adjustmentId: adjustment.id,
            tenantId: ctx.tenantId,
            actorUserId: ctx.user.userId,
            action: 'created',
            metadata: {
              correctionAction: input.action,
            },
          },
        });

        if (updated.userId) {
          await recomputeAttendanceDaySummary({
            tenantId: ctx.tenantId,
            userId: updated.userId,
            localDate: targetEvent.localDate,
          });
          if (newLocalDate !== targetEvent.localDate) {
            await recomputeAttendanceDaySummary({
              tenantId: ctx.tenantId,
              userId: updated.userId,
              localDate: newLocalDate,
            });
          }
        }

        return {
          success: true,
          adjustmentId: adjustment.id,
        };
      }

      const summaryDate = parseDateKey(input.summaryDate, 'summaryDate');
      const existingSummary = await prisma.attendanceDaySummary.findUnique({
        where: {
          tenantId_userId_summaryDate: {
            tenantId: ctx.tenantId,
            userId: input.userId,
            summaryDate,
          },
        },
        select: {
          id: true,
          workedSeconds: true,
          requiredSeconds: true,
          missingSeconds: true,
          absence: true,
          lateMinutes: true,
          lateCount: true,
          anomalyCount: true,
          unmatchedInCount: true,
          unmatchedOutCount: true,
        },
      });

      const updatedSummary = await prisma.attendanceDaySummary.upsert({
        where: {
          tenantId_userId_summaryDate: {
            tenantId: ctx.tenantId,
            userId: input.userId,
            summaryDate,
          },
        },
        create: {
          tenantId: ctx.tenantId,
          userId: input.userId,
          summaryDate,
          requiredSeconds: 0,
          workedSeconds: 0,
          missingSeconds: 0,
          absence: false,
          lateMinutes: 0,
          lateCount: 0,
          anomalyCount: 0,
          unmatchedInCount: 0,
          unmatchedOutCount: 0,
          sourceUpdatedAt: new Date(),
        },
        update: {
          requiredSeconds: 0,
          missingSeconds: 0,
          absence: false,
          sourceUpdatedAt: new Date(),
        },
        select: {
          id: true,
          summaryDate: true,
          userId: true,
          requiredSeconds: true,
          missingSeconds: true,
          absence: true,
        },
      });

      const adjustment = await prisma.attendanceAdjustment.create({
        data: {
          tenantId: ctx.tenantId,
          userId: input.userId,
          summaryDate,
          action: input.action,
          reason: input.reason,
          beforeData: existingSummary ?? undefined,
          afterData: updatedSummary,
          createdByUserId: ctx.user.userId,
        },
        select: { id: true },
      });

      await prisma.attendanceAdjustmentAudit.create({
        data: {
          adjustmentId: adjustment.id,
          tenantId: ctx.tenantId,
          actorUserId: ctx.user.userId,
          action: 'created',
          metadata: {
            correctionAction: input.action,
          },
        },
      });

      return {
        success: true,
        adjustmentId: adjustment.id,
      };
    }),

  recomputeRange: adminProcedure
    .input(
      z.object({
        dateFrom: z.string(),
        dateTo: z.string(),
        userId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const dateFrom = parseDateKey(input.dateFrom, 'dateFrom');
      const dateTo = parseDateKey(input.dateTo, 'dateTo');
      if (dateFrom > dateTo) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "dateFrom dateTo dan katta bo'lishi mumkin emas.",
        });
      }

      const result = await recomputeAttendanceSummariesForRange({
        tenantId: ctx.tenantId,
        dateFrom,
        dateTo,
        userId: input.userId,
      });

      return {
        success: true,
        ...result,
      };
    }),
});
