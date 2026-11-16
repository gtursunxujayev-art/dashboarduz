import type { DbClient } from '@dashboarduz/db';
import { AGENT_ROLES, hasAgentRole, normalizeDigits } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveDateRange } from '../../lib/dates';
import { textFromScalar } from '../../lib/object';
import { isAllowedUtelManagerExtension, resolveCallDuration, resolveCallExtension } from '../../lib/utel';
import { getCallsProvider, getCallsProviderFilter } from '../../services/calls-source';
import { getCorporateCallDurationByManager } from '../../services/corporate-call-durations';
import { router, protectedProcedure } from '../trpc';

const callsListSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
});

const clickToCallSchema = z.object({
  from: z.string().min(3),
  to: z.string().min(3),
  callerId: z.string().optional(),
  recording: z.boolean().optional().default(true),
});
const callsRangeSchema = z.enum(['today', 'week', 'month', 'custom']);

const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);
const AGENT_MOTIVATION_ABOVE = "Bugungi harakatlaringizga baraka bersin, ko'proq suhbat ko'proq savdo degani";
const AGENT_MOTIVATION_BELOW = "Bugun qolganlardan ortda qolyapsiz, qo'ng'iroqlarni ko'paytiring, ko'proq bonus ko'proq harakat qilganlarga nasib qiladi ";

type AnalyticsAccumulator = {
  totalCalls: number;
  incomingCalls: number;
  outgoingCalls: number;
  callsToday: number;
  totalDurationSeconds: number;
  activeDayKeys: Set<string>;
};

function getTashkentDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';

  return `${year}-${month}-${day}`;
}

async function getAgentResponsibleScope(tenantId: string, userId: string, roles: string[], db: DbClient) {
  const isAgentOnly = hasAgentRole(roles) && !roles.some((role) => PRIVILEGED_ROLES.has(role));

  if (!isAgentOnly) {
    return { isScoped: false, responsibleUserId: null as string | null };
  }

  let currentUser: { amocrmResponsibleUserId: string | null } | null = null;

  try {
    currentUser = await db.user.findFirst({
      where: {
        id: userId,
        tenantId,
        isActive: true,
      },
      select: {
        amocrmResponsibleUserId: true,
      },
    });
  } catch (error: any) {
    if (!String(error?.message || '').includes('amocrmResponsibleUserId')) {
      throw error;
    }
  }

  return {
    isScoped: true,
    responsibleUserId: currentUser?.amocrmResponsibleUserId || null,
  };
}

export const callsRouter = router({
  list: protectedProcedure
    .input(callsListSchema)
    .query(async ({ input, ctx }) => {
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);

      if (scope.isScoped && !scope.responsibleUserId) {
        return {
          data: [],
          pagination: {
            page: input.page,
            limit: input.limit,
            total: 0,
            hasMore: false,
          },
        };
      }

      const { page, limit, search, status } = input;
      const skip = (page - 1) * limit;

      const where: any = {
        tenantId: ctx.tenantId,
        provider: await getCallsProviderFilter(ctx.tenantId, ctx.db),
        ...(scope.isScoped
          ? {
              lead: {
                responsibleUserId: scope.responsibleUserId,
              },
            }
          : {}),
      };

      if (status) {
        where.status = status;
      }
      if (search) {
        where.OR = [
          { from: { contains: search, mode: 'insensitive' } },
          { to: { contains: search, mode: 'insensitive' } },
          { callIdExternal: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        ctx.db.call.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          skip,
          take: limit,
          include: {
            lead: {
              select: { id: true, title: true, status: true },
            },
          },
        }),
        ctx.db.call.count({ where }),
      ]);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          hasMore: skip + data.length < total,
        },
      };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
      const call = await ctx.db.call.findFirst({
        where: {
          id: input.id,
          tenantId: ctx.tenantId,
          ...(scope.isScoped
            ? {
                lead: {
                  responsibleUserId: scope.responsibleUserId || '__unmapped__',
                },
              }
            : {}),
        },
        include: {
          lead: true,
        },
      });

      if (!call) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Call not found' });
      }

      return call;
    }),

  clickToCall: protectedProcedure
    .input(clickToCallSchema)
    .mutation(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Click-to-call is disabled in webhook-only VoIP mode.',
      });
    }),

  analytics: protectedProcedure
    .input(
      z.object({
        range: callsRangeSchema.default('today'),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
    const now = new Date();
    const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);

    const roles = ctx.user.roles || [];
    const isAgentOnly = hasAgentRole(roles) && !roles.some((role) => PRIVILEGED_ROLES.has(role));

    const [agentUsers, currentUser] = await Promise.all([
      ctx.db.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          roles: { hasSome: [...AGENT_ROLES, 'TeamLeader'] },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          name: true,
          username: true,
          utelManagerExternalId: true,
        },
      }),
      isAgentOnly
        ? ctx.db.user.findFirst({
            where: {
              id: ctx.user.userId,
              tenantId: ctx.tenantId,
            },
            select: {
              id: true,
              utelManagerExternalId: true,
            },
          })
        : Promise.resolve(null),
    ]);

    const mappedAgents = agentUsers
      .map((user) => {
        const extension = normalizeDigits(user.utelManagerExternalId || '');

        return {
          id: user.id,
          name: textFromScalar(user.name) || textFromScalar(user.username) || extension || 'Agent',
          extension,
        };
      })
      .filter((user) => isAllowedUtelManagerExtension(user.extension));

    const extensionToAgent = new Map<string, { id: string; name: string; extension: string }>();

    for (const agent of mappedAgents) {
      if (!extensionToAgent.has(agent.extension)) {
        extensionToAgent.set(agent.extension, agent);
      }
    }

    const extensionValues = Array.from(extensionToAgent.keys());
    const calls = extensionValues.length > 0
      ? await ctx.db.call.findMany({
          where: {
            tenantId: ctx.tenantId,
            provider: await getCallsProvider(ctx.tenantId, ctx.db),
            startedAt: {
              gte: rangeStart,
              lte: rangeEnd,
            },
            OR: [
              { from: { in: extensionValues } },
              { to: { in: extensionValues } },
            ],
          },
          select: {
            from: true,
            to: true,
            direction: true,
            startedAt: true,
            duration: true,
            metadata: true,
          },
        })
      : [];

    const todayKey = getTashkentDayKey(new Date());
    const byAgent = new Map<string, AnalyticsAccumulator>();

    for (const agent of extensionToAgent.values()) {
      byAgent.set(agent.id, {
        totalCalls: 0,
        incomingCalls: 0,
        outgoingCalls: 0,
        callsToday: 0,
        totalDurationSeconds: 0,
        activeDayKeys: new Set<string>(),
      });
    }

    for (const call of calls) {
      const extension = resolveCallExtension({
        from: call.from,
        to: call.to,
        direction: call.direction,
        metadata: call.metadata,
      });

      if (!extension) {
        continue;
      }

      const mappedAgent = extensionToAgent.get(extension);

      if (!mappedAgent) {
        continue;
      }

      const stat = byAgent.get(mappedAgent.id);

      if (!stat) {
        continue;
      }

      stat.totalCalls += 1;
      if (String(call.direction || '').toLowerCase() === 'outbound') {
        stat.outgoingCalls += 1;
      } else {
        stat.incomingCalls += 1;
      }
      stat.totalDurationSeconds += resolveCallDuration(call.duration, call.metadata);

      const dayKey = getTashkentDayKey(call.startedAt);

      stat.activeDayKeys.add(dayKey);
      if (dayKey === todayKey) {
        stat.callsToday += 1;
      }
    }

    const corporateDurationByManager = await getCorporateCallDurationByManager({
      tenantId: ctx.tenantId,
      managerUserIds: mappedAgents.map((agent) => agent.id),
      rangeStart,
      rangeEnd,
      db: ctx.db,
    });

    const rows = mappedAgents
      .map((agent) => {
        const stat = byAgent.get(agent.id);
        const totalCalls = stat?.totalCalls || 0;
        const activeDays = stat?.activeDayKeys.size || 0;
        const averageDailyCalls = activeDays > 0
          ? Number((totalCalls / activeDays).toFixed(1))
          : 0;
        const corporateDurationSeconds = corporateDurationByManager.get(agent.id) || 0;

        return {
          userId: agent.id,
          extension: agent.extension,
          agentName: agent.name,
          totalCalls,
          averageDailyCalls,
          callsToday: stat?.callsToday || 0,
          incomingCalls: stat?.incomingCalls || 0,
          outgoingCalls: stat?.outgoingCalls || 0,
          totalDurationSeconds: (stat?.totalDurationSeconds || 0) + corporateDurationSeconds,
        };
      })
      .sort((a, b) => (
        b.totalDurationSeconds - a.totalDurationSeconds
        || b.totalCalls - a.totalCalls
        || a.agentName.localeCompare(b.agentName)
      ))
      .map((row, index) => ({
        ...row,
        rank: index + 1,
      }));

    const teamAverageTodayCalls = rows.length > 0
      ? Number((rows.reduce((sum, row) => sum + row.callsToday, 0) / rows.length).toFixed(1))
      : 0;

    if (isAgentOnly) {
      const scopedExtension = normalizeDigits(currentUser?.utelManagerExternalId || '');
      const ownRow = rows.find((row) => row.userId === currentUser?.id)
        || rows.find((row) => row.extension === scopedExtension);
      const aboveAverage = ownRow ? ownRow.callsToday >= teamAverageTodayCalls : false;

      return {
        rows: ownRow ? [ownRow] : [],
        teamAverageTodayCalls,
        totals: {
          totalAgents: rows.length,
          totalCalls: rows.reduce((sum, row) => sum + row.totalCalls, 0),
          totalDurationSeconds: rows.reduce((sum, row) => sum + row.totalDurationSeconds, 0),
        },
        range: input.range,
        dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
        dateTo: input.range === 'custom' ? input.dateTo || null : null,
        rangeStart,
        rangeEnd,
        agentInsight: {
          isAgentOnly: true,
          aboveAverage: ownRow ? aboveAverage : null,
          callsToday: ownRow?.callsToday ?? 0,
          teamAverageTodayCalls,
          message: ownRow
            ? (aboveAverage ? AGENT_MOTIVATION_ABOVE : AGENT_MOTIVATION_BELOW)
            : null,
        },
      };
    }

    return {
      rows,
      teamAverageTodayCalls,
      totals: {
        totalAgents: rows.length,
        totalCalls: rows.reduce((sum, row) => sum + row.totalCalls, 0),
        totalDurationSeconds: rows.reduce((sum, row) => sum + row.totalDurationSeconds, 0),
      },
      range: input.range,
      dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
      dateTo: input.range === 'custom' ? input.dateTo || null : null,
      rangeStart,
      rangeEnd,
      agentInsight: null,
    };
  }),
});
