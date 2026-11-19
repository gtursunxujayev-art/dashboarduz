import { AGENT_ROLES, TEAM_LEADER_ROLES, dateRangeInput, reportRangeSchema } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveCallerDataScope } from '../../lib/access';
import { echoReportRange, resolveDateRange } from '../../lib/dates';
import { textFromScalar } from '../../lib/object';
import { AMOCRM_CALL_PROVIDER, countedCallsWhere } from '../../services/calls-source';
import { getCorporateCallDurationByManager } from '../../services/corporate-call-durations';
import { router, protectedProcedure } from '../trpc';

const callsListSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
});

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

/**
 * `where` part limiting calls to the caller's scope. A call belongs to its manager (`managerUserId`, set by the
 * amoCRM call import), not to the lead's owner; `null` user ids mean no filter.
 */
export function callScopeWhere(userIds: readonly string[] | null): Prisma.CallWhereInput {
  return userIds === null ? {} : { managerUserId: { in: [...userIds] } };
}

/** Team totals of the rows a report returns. */
export function summarizeCallRows(rows: ReadonlyArray<{ totalCalls: number; totalDurationSeconds: number }>) {
  return {
    totalAgents: rows.length,
    totalCalls: rows.reduce((sum, row) => sum + row.totalCalls, 0),
    totalDurationSeconds: rows.reduce((sum, row) => sum + row.totalDurationSeconds, 0),
  };
}

export const callsRouter = router({
  list: protectedProcedure
    .input(callsListSchema)
    .query(async ({ input, ctx }) => {
      const scope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
      const { page, limit, search, status } = input;
      const skip = (page - 1) * limit;

      const where: Prisma.CallWhereInput = {
        tenantId: ctx.tenantId,
        provider: AMOCRM_CALL_PROVIDER,
        ...callScopeWhere(scope.userIds),
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
      const scope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
      const call = await ctx.db.call.findFirst({
        where: {
          id: input.id,
          tenantId: ctx.tenantId,
          ...callScopeWhere(scope.userIds),
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

  analytics: protectedProcedure
    .input(
      z.object({
        range: reportRangeSchema.default('today'),
        ...dateRangeInput.shape,
      }),
    )
    .query(async ({ input, ctx }) => {
    const now = new Date();
    const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);

    const scope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles || [], ctx.db);
    const isAgentOnly = scope.scope.kind === 'self';

    // An agent's own row is compared with the average of every agent; for that the whole team is read, but
    // only the agent's row and totals are returned. Group and company scopes only ever read their own agents.
    const agentUsers = await ctx.db.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
        roles: { hasSome: [...AGENT_ROLES, ...TEAM_LEADER_ROLES] },
        ...(scope.userIds && !isAgentOnly ? { id: { in: scope.userIds } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        username: true,
      },
    });

    const mappedAgents = agentUsers.map((user) => ({
      id: user.id,
      name: textFromScalar(user.name) || textFromScalar(user.username) || 'Agent',
    }));
    const agentIds = mappedAgents.map((agent) => agent.id);
    const calls = agentIds.length > 0
      ? await ctx.db.call.findMany({
          where: {
            ...countedCallsWhere(ctx.tenantId, agentIds),
            startedAt: {
              gte: rangeStart,
              lte: rangeEnd,
            },
          },
          select: {
            managerUserId: true,
            direction: true,
            startedAt: true,
            duration: true,
          },
        })
      : [];

    const todayKey = getTashkentDayKey(new Date());
    const byAgent = new Map<string, AnalyticsAccumulator>();

    for (const agentId of agentIds) {
      byAgent.set(agentId, {
        totalCalls: 0,
        incomingCalls: 0,
        outgoingCalls: 0,
        callsToday: 0,
        totalDurationSeconds: 0,
        activeDayKeys: new Set<string>(),
      });
    }

    for (const call of calls) {
      const stat = call.managerUserId ? byAgent.get(call.managerUserId) : undefined;

      if (!stat) {
        continue;
      }

      stat.totalCalls += 1;
      if (String(call.direction || '').toLowerCase() === 'outbound') {
        stat.outgoingCalls += 1;
      } else {
        stat.incomingCalls += 1;
      }
      stat.totalDurationSeconds += Math.max(0, call.duration ?? 0);

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

    const totals = summarizeCallRows(rows);

    if (isAgentOnly) {
      const ownRow = rows.find((row) => row.userId === ctx.user.userId);
      const aboveAverage = ownRow ? ownRow.callsToday >= teamAverageTodayCalls : false;

      return {
        rows: ownRow ? [ownRow] : [],
        teamAverageTodayCalls,
        totals: summarizeCallRows(ownRow ? [ownRow] : []),
        ...echoReportRange(input),
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
      totals,
      ...echoReportRange(input),
      rangeStart,
      rangeEnd,
      agentInsight: null,
    };
  }),
});
