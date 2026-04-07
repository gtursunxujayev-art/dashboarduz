import { router, protectedProcedure } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';

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
type CallsRange = z.infer<typeof callsRangeSchema>;

const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);
const UTEL_MIN_EXTENSION = 100;
const UTEL_MAX_EXTENSION = 150;
const REPORT_TZ_OFFSET_MINUTES = 5 * 60; // GMT+5
const AGENT_MOTIVATION_ABOVE = "Bugungi harakatlaringizga baraka bersin, ko'proq suhbat ko'proq savdo degani";
const AGENT_MOTIVATION_BELOW = "Bugun qolganlardan ortda qolyapsiz, qo'ng'iroqlarni ko'paytiring, ko'proq bonus ko'proq harakat qilganlarga nasib qiladi ";

function normalizeDigits(value: unknown): string {
  return String(value || '').replace(/[^\d]/g, '');
}

function isAllowedUtelManagerExtension(value: unknown): boolean {
  const digits = normalizeDigits(value);
  if (!digits) {
    return false;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed >= UTEL_MIN_EXTENSION && parsed <= UTEL_MAX_EXTENSION;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function textFromUnknown(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function getCaseInsensitiveValue(source: Record<string, unknown>, key: string): unknown {
  if (key in source) {
    return source[key];
  }

  const normalizedKey = key.toLowerCase();
  for (const [entryKey, entryValue] of Object.entries(source)) {
    if (entryKey.toLowerCase() === normalizedKey) {
      return entryValue;
    }
  }

  return undefined;
}

function parseDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isNaN(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return null;
}

function resolveCallDuration(duration: number | null, metadata: unknown): number {
  if (duration !== null && duration !== undefined) {
    return Math.max(0, duration);
  }

  const metadataObject = asObject(metadata);
  if (!metadataObject) {
    return 0;
  }

  const candidates: Record<string, unknown>[] = [metadataObject];
  const rawHistory = asObject(metadataObject.raw_call_history);
  if (rawHistory) {
    candidates.push(rawHistory);
  }

  const keys = ['normalized_duration', 'duration', 'billsec', 'conversation', 'talk_duration'];
  for (const candidate of candidates) {
    for (const key of keys) {
      const parsed = parseDuration(getCaseInsensitiveValue(candidate, key));
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return 0;
}

type AnalyticsAccumulator = {
  totalCalls: number;
  incomingCalls: number;
  outgoingCalls: number;
  callsToday: number;
  totalDurationSeconds: number;
  activeDayKeys: Set<string>;
};

function resolveCallExtension(call: {
  from: string;
  to: string;
  direction: string;
  metadata: unknown;
}): string | null {
  const metadata = asObject(call.metadata);
  const metadataExtension = normalizeDigits(
    metadata?.normalized_extension
    || metadata?.extension
    || metadata?.ext
    || metadata?.internal
    || metadata?.line,
  );
  if (isAllowedUtelManagerExtension(metadataExtension)) {
    return metadataExtension;
  }

  const fromDigits = normalizeDigits(call.from);
  const toDigits = normalizeDigits(call.to);
  const direction = String(call.direction || '').toLowerCase();

  if (direction === 'outbound') {
    if (isAllowedUtelManagerExtension(fromDigits)) return fromDigits;
    if (isAllowedUtelManagerExtension(toDigits)) return toDigits;
  }

  if (direction === 'inbound') {
    if (isAllowedUtelManagerExtension(toDigits)) return toDigits;
    if (isAllowedUtelManagerExtension(fromDigits)) return fromDigits;
  }

  if (isAllowedUtelManagerExtension(fromDigits)) return fromDigits;
  if (isAllowedUtelManagerExtension(toDigits)) return toDigits;
  return null;
}

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

function getRangeStart(range: CallsRange, now: Date): Date {
  const offsetMs = REPORT_TZ_OFFSET_MINUTES * 60 * 1000;
  const shiftedNow = new Date(now.getTime() + offsetMs);

  const year = shiftedNow.getUTCFullYear();
  const month = shiftedNow.getUTCMonth();
  const date = shiftedNow.getUTCDate();

  if (range === 'today') {
    return new Date(Date.UTC(year, month, date) - offsetMs);
  }

  if (range === 'week') {
    const day = shiftedNow.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    return new Date(Date.UTC(year, month, date - daysSinceMonday) - offsetMs);
  }

  return new Date(Date.UTC(year, month, 1) - offsetMs);
}

function parseCustomDate(input: string, endOfDay: boolean): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Custom date must be in YYYY-MM-DD format.' });
  }

  const timestamp = `${input}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}+05:00`;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid custom date: ${input}` });
  }

  return parsed;
}

function resolveDateRange(range: CallsRange, now: Date, dateFrom?: string, dateTo?: string) {
  if (range !== 'custom') {
    return {
      rangeStart: getRangeStart(range, now),
      rangeEnd: now,
    };
  }

  if (!dateFrom || !dateTo) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Both dateFrom and dateTo are required when range is custom.',
    });
  }

  const rangeStart = parseCustomDate(dateFrom, false);
  const rangeEnd = parseCustomDate(dateTo, true);
  if (rangeEnd < rangeStart) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'dateTo must be greater than or equal to dateFrom.' });
  }

  return { rangeStart, rangeEnd };
}

async function getAgentResponsibleScope(tenantId: string, userId: string, roles: string[]) {
  const isAgentOnly = roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));
  if (!isAgentOnly) {
    return { isScoped: false, responsibleUserId: null as string | null };
  }

  let currentUser: { amocrmResponsibleUserId: string | null } | null = null;
  try {
    currentUser = await prisma.user.findFirst({
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
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
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
        prisma.call.findMany({
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
        prisma.call.count({ where }),
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
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
      const call = await prisma.call.findFirst({
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
    const isAgentOnly = roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));

    const [agentUsers, currentUser] = await Promise.all([
      prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          roles: { has: 'Agent' },
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
        ? prisma.user.findFirst({
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
          name: textFromUnknown(user.name) || textFromUnknown(user.username) || extension || 'Agent',
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
      ? await prisma.call.findMany({
          where: {
            tenantId: ctx.tenantId,
            provider: 'utel',
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

    const rows = mappedAgents
      .map((agent) => {
        const stat = byAgent.get(agent.id);
        const totalCalls = stat?.totalCalls || 0;
        const activeDays = stat?.activeDayKeys.size || 0;
        const averageDailyCalls = activeDays > 0
          ? Number((totalCalls / activeDays).toFixed(1))
          : 0;

        return {
          userId: agent.id,
          extension: agent.extension,
          agentName: agent.name,
          totalCalls,
          averageDailyCalls,
          callsToday: stat?.callsToday || 0,
          incomingCalls: stat?.incomingCalls || 0,
          outgoingCalls: stat?.outgoingCalls || 0,
          totalDurationSeconds: stat?.totalDurationSeconds || 0,
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
