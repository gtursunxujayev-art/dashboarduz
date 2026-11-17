import type { DbClient } from '@dashboarduz/db';
import { toTashkentDateKey } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { recomputeAttendanceDaySummary, recomputeAttendanceSummariesForRange } from '../../../services/attendance/faceid';
import { parseDateKey, parseDateTime, toLocalTimeValue } from '../../../services/attendance/router-helpers';
import { adminProcedure } from '../../trpc';

type CorrectionContext = { db: DbClient; tenantId: string; user: { userId: string } };

/** Records a manual attendance correction and its audit row. */
async function recordAttendanceAdjustment(ctx: CorrectionContext, params: {
  userId: string | null;
  eventId?: string;
  summaryDate: string;
  action: string;
  reason: string;
  beforeData: Prisma.InputJsonValue | undefined;
  afterData: Prisma.InputJsonValue;
}) {
  const adjustment = await ctx.db.attendanceAdjustment.create({
    data: {
      tenantId: ctx.tenantId,
      userId: params.userId,
      ...(params.eventId ? { eventId: params.eventId } : {}),
      summaryDate: params.summaryDate,
      action: params.action,
      reason: params.reason,
      beforeData: params.beforeData,
      afterData: params.afterData,
      createdByUserId: ctx.user.userId,
    },
    select: { id: true },
  });

  await ctx.db.attendanceAdjustmentAudit.create({
    data: {
      adjustmentId: adjustment.id,
      tenantId: ctx.tenantId,
      actorUserId: ctx.user.userId,
      action: 'created',
      metadata: {
        correctionAction: params.action,
      },
    },
  });

  return {
    success: true,
    adjustmentId: adjustment.id,
  };
}

export const attendanceCorrectionProcedures = {
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
      if (input.action === 'add_missing_in' || input.action === 'add_missing_out') {
        const direction = input.action === 'add_missing_in' ? 'IN' : 'OUT';
        const eventAt = parseDateTime(input.timestamp, 'timestamp');
        const localDate = toTashkentDateKey(eventAt);
        const localTime = toLocalTimeValue(eventAt);

        const createdEvent = await ctx.db.attendanceEvent.create({
          data: {
            tenantId: ctx.tenantId,
            userId: input.userId,
            eventType: 'check_in_out',
            action: direction,
            eventAt,
            localDate,
            localTime,
            source: 'FACE_ID_MANUAL',
            lateMinutes: 0,
            idempotencyKey: `manual-${direction.toLowerCase()}:${ctx.tenantId}:${input.userId}:${eventAt.toISOString()}`,
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

        const result = await recordAttendanceAdjustment(ctx, {
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
        });

        await recomputeAttendanceDaySummary({
          tenantId: ctx.tenantId,
          db: ctx.db,
          userId: input.userId,
          localDate,
        });

        return result;
      }

      if (input.action === 'edit_event_time') {
        const targetEvent = await ctx.db.attendanceEvent.findFirst({
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
        const newLocalDate = toTashkentDateKey(newEventAt);
        const newLocalTime = toLocalTimeValue(newEventAt);

        const updated = await ctx.db.attendanceEvent.update({
          where: { id: targetEvent.id },
          data: {
            eventAt: newEventAt,
            localDate: newLocalDate,
            localTime: newLocalTime,
            source: targetEvent.action === 'IN' || targetEvent.action === 'OUT' ? 'FACE_ID_MANUAL' : undefined,
          },
          select: { id: true, userId: true },
        });

        const result = await recordAttendanceAdjustment(ctx, {
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
        });

        if (updated.userId) {
          await recomputeAttendanceDaySummary({
            tenantId: ctx.tenantId,
            db: ctx.db,
            userId: updated.userId,
            localDate: targetEvent.localDate,
          });
          if (newLocalDate !== targetEvent.localDate) {
            await recomputeAttendanceDaySummary({
              tenantId: ctx.tenantId,
              db: ctx.db,
              userId: updated.userId,
              localDate: newLocalDate,
            });
          }
        }

        return result;
      }

      const summaryDate = parseDateKey(input.summaryDate, 'summaryDate');
      const existingSummary = await ctx.db.attendanceDaySummary.findUnique({
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

      const updatedSummary = await ctx.db.attendanceDaySummary.upsert({
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

      return recordAttendanceAdjustment(ctx, {
        userId: input.userId,
        summaryDate,
        action: input.action,
        reason: input.reason,
        beforeData: existingSummary ?? undefined,
        afterData: updatedSummary,
      });
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
        db: ctx.db,
        dateFrom,
        dateTo,
        userId: input.userId,
      });

      return {
        success: true,
        ...result,
      };
    }),
};
