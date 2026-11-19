import type { DbClient } from '@dashboarduz/db';
import { AGENT_ROLES, TEAM_LEADER_ROLES, dateKeyRangeInput, dateRangeInput } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveCallerDataScope } from '../../../lib/access';
import { ATTENDANCE_REPORT_MAX_CALENDAR_DAYS, buildAttendancePeriodReport, countAttendanceReportCalendarDays, enumerateAttendanceReportWorkdays, isAttendanceReportCalendarRangeOverLimit, isAttendanceReportDetailRowLimitExceeded, parseAttendanceReportDateKey } from '../../../services/attendance/report';
import { attendanceUserFilter, parseDateKeyFilter, readFaceMatchMeta, resolveAttendanceListScope, resolveAttendanceUserIds } from '../../../services/attendance/router-helpers';
import { protectedProcedure, staffReadProcedure } from '../../trpc';

/** Paging, date range and user filter shared by the attendance event and summary lists. */
const attendanceListInputShape = {
  page: z.number().int().min(1).default(1).optional(),
  limit: z.number().int().min(1).max(200).default(50).optional(),
  ...dateRangeInput.shape,
  userId: z.string().uuid().optional(),
};

/** The users whose attendance the caller may read (`null` = everyone). */
async function loadAttendanceUserIds(ctx: { db: DbClient; tenantId: string; user: { userId: string; roles: string[] } }) {
  const scope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);

  return resolveAttendanceUserIds(ctx.user, scope.userIds);
}

export const attendanceRecordProcedures = {
  listEvents: protectedProcedure
    .input(
      z.object({
        ...attendanceListInputShape,
        action: z.enum(['IN', 'OUT']).optional(),
        query: z.string().trim().optional(),
        unmatchedOnly: z.boolean().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const { page, limit, skip, scopedUserId, canSeeUnmatched } = resolveAttendanceListScope(ctx.user, input, await loadAttendanceUserIds(ctx));

      const dateFilter = parseDateKeyFilter(input);

      const query = String(input?.query || '').trim();
      const where = {
        tenantId: ctx.tenantId,
        ...(scopedUserId ? { userId: scopedUserId } : {}),
        ...(input?.action ? { action: input.action } : {}),
        ...(dateFilter ? { localDate: dateFilter } : {}),
        ...(input?.unmatchedOnly && canSeeUnmatched ? { userId: null as string | null } : {}),
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
        ctx.db.attendanceEvent.findMany({
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
        ctx.db.attendanceEvent.count({ where }),
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
        ...attendanceListInputShape,
        query: z.string().trim().optional(),
        anomaliesOnly: z.boolean().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const { page, limit, skip, scopedUserId } = resolveAttendanceListScope(ctx.user, input, await loadAttendanceUserIds(ctx));

      const dateFilter = parseDateKeyFilter(input);

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
        ctx.db.attendanceDaySummary.findMany({
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
        ctx.db.attendanceDaySummary.count({ where }),
      ]);

      return {
        page,
        limit,
        total,
        hasMore: skip + rows.length < total,
        rows,
      };
    }),
  exportReport: protectedProcedure
    .input(
      z.object({
        ...dateKeyRangeInput.shape,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const dateFrom = parseAttendanceReportDateKey(input.dateFrom);
      const dateTo = parseAttendanceReportDateKey(input.dateTo);

      if (!dateFrom || !dateTo) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Davr sanalari YYYY-MM-DD formatda haqiqiy sana bo'lishi kerak.",
        });
      }
      if (dateFrom > dateTo) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Boshlanish sanasi tugash sanasidan keyin bo'lishi mumkin emas.",
        });
      }

      const calendarDayCount = countAttendanceReportCalendarDays(dateFrom, dateTo);

      if (isAttendanceReportCalendarRangeOverLimit(calendarDayCount)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Davomat hisoboti ko'pi bilan ${ATTENDANCE_REPORT_MAX_CALENDAR_DAYS} kalendar kunini qamrab olishi mumkin.`,
        });
      }

      const workdayDateKeys = enumerateAttendanceReportWorkdays(dateFrom, dateTo);

      if (workdayDateKeys.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Tanlangan davrda dushanba-shanba ish kuni yo'q.",
        });
      }

      const scopedUserIds = await loadAttendanceUserIds(ctx);
      const users = await ctx.db.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          roles: { hasSome: [...AGENT_ROLES, ...TEAM_LEADER_ROLES] },
          ...(scopedUserIds ? { id: { in: scopedUserIds } } : {}),
        },
        orderBy: [{ name: 'asc' }, { username: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          username: true,
          roles: true,
        },
      });

      if (isAttendanceReportDetailRowLimitExceeded(users.length, workdayDateKeys.length)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Tanlangan davr uchun davomat qatorlari juda ko'p. Iltimos, qisqaroq davr tanlang.",
        });
      }

      const summaries = users.length > 0
        ? await ctx.db.attendanceDaySummary.findMany({
            where: {
              tenantId: ctx.tenantId,
              userId: { in: users.map((user) => user.id) },
              summaryDate: {
                gte: input.dateFrom,
                lte: input.dateTo,
              },
            },
            select: {
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
            },
          })
        : [];

      const report = buildAttendancePeriodReport({
        users,
        summaries,
        workdayDateKeys,
      });

      return {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        employeeCount: report.employeeSummaries.length,
        workdayCount: workdayDateKeys.length,
        dailyRowCount: report.dailyRows.length,
        employeeSummaries: report.employeeSummaries,
        dailyRows: report.dailyRows,
      };
    }),
  // Admin, OnlineAdmin, Manager and team leaders; a group reader sees only the group's anomalies.
  listAnomalies: staffReadProcedure
    .input(
      z.object({
        ...dateRangeInput.shape,
        limit: z.number().int().min(1).max(500).default(100).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit || 100;
      const dateFilter = parseDateKeyFilter(input);
      const allowedUserIds = await loadAttendanceUserIds(ctx);
      const userFilter = attendanceUserFilter(allowedUserIds, undefined);

      const [summaryAnomalies, unmatchedEvents] = await Promise.all([
        ctx.db.attendanceDaySummary.findMany({
          where: {
            tenantId: ctx.tenantId,
            ...(userFilter ? { userId: userFilter } : {}),
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
        // Unmatched events belong to no group, so only a company-wide reader gets them.
        allowedUserIds !== null ? Promise.resolve([]) : ctx.db.attendanceEvent.findMany({
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
};
