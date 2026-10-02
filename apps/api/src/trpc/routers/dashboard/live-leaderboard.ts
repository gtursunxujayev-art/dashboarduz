import {
  getRangeStart,
  INCOME_LIFECYCLE_ACTIVE,
  isAllowedUtelManagerExtension,
  normalizeDigits,
  prisma,
  protectedProcedure,
  resolveCallDuration,
  resolveCallExtension,
  TRPCError,
  z,
} from './helpers';
import { getCorporateCallDurationByManager } from '../../../services/corporate-call-durations';
import { calculateBonusRange, getBonusMonth, type BonusCalculationItem } from '../../../services/bonus-engine';
import { excludeTechnicalRows, loadTechnicalSaleIdsForRows } from '../../../services/income-facts';
import { loadSelectedReportCourses } from './selected-report-courses';

const LIVE_LEADERBOARD_MANAGER_ROLES = new Set(['Admin', 'Manager']);

type AgentGroup = 'online' | 'offline';

type LeaderboardAgent = {
  id: string;
  name: string | null;
  username: string | null;
  roles: string[];
};

function canReadLiveLeaderboard(
  roles: readonly string[] | null | undefined,
  group: AgentGroup,
): boolean {
  if (!Array.isArray(roles)) return false;
  if (roles.some((role) => LIVE_LEADERBOARD_MANAGER_ROLES.has(role))) return true;
  return group === 'online'
    ? roles.length === 1 && roles[0] === 'Dashboard'
    : roles.length === 1 && roles[0] === 'OfflineDashboard';
}

function resolveAgentGroup(roles: readonly string[]): AgentGroup | null {
  if (roles.includes('OnlineAgent')) return 'online';
  if (roles.includes('OfflineAgent') || roles.includes('TeamLeader')) return 'offline';
  return null;
}

function getAgentLabel(agent: LeaderboardAgent): string {
  return agent.name?.trim() || agent.username?.trim() || 'Agent';
}

function groupAgentRoles(group: AgentGroup): string[] {
  return group === 'online' ? ['OnlineAgent'] : ['OfflineAgent', 'TeamLeader'];
}

/** Bonus per agent from the central bonus engine, the same numbers the salary page shows. */
export function sumBonusByAgent(items: BonusCalculationItem[], agentIds: string[]): Map<string, number> {
  const wanted = new Set(agentIds);
  const totals = new Map<string, number>();
  for (const item of items) {
    if (!wanted.has(item.agentUserId)) continue;
    totals.set(item.agentUserId, (totals.get(item.agentUserId) || 0) + item.bonusAmount);
  }
  return totals;
}

type LeaderboardIncomeRow = { managerUserId: string; paymentAmount: number; entryDate: Date; type: string };

/**
 * Per-agent numbers for a board. A board belongs to a group of agents (by role); everything those agents record
 * counts, whatever the course category, so no sale can fall off both boards.
 */
export function summarizeLeaderboardAgents(params: {
  agentIds: string[];
  monthRows: LeaderboardIncomeRow[];
  todayStart: Date;
}) {
  const wanted = new Set(params.agentIds);
  const monthIncome = new Map<string, number>();
  const todayIncome = new Map<string, number>();
  const monthlySales = new Map<string, number>();
  for (const row of params.monthRows) {
    if (!wanted.has(row.managerUserId)) continue;
    monthIncome.set(row.managerUserId, (monthIncome.get(row.managerUserId) || 0) + (row.paymentAmount || 0));
    if (row.entryDate >= params.todayStart) {
      todayIncome.set(row.managerUserId, (todayIncome.get(row.managerUserId) || 0) + (row.paymentAmount || 0));
    }
    if (row.type === 'new_sale') {
      monthlySales.set(row.managerUserId, (monthlySales.get(row.managerUserId) || 0) + 1);
    }
  }
  return { monthIncome, todayIncome, monthlySales };
}

export function compareLeaderboardAgents(
  left: { income: number; salesCount: number; name: string; userId: string },
  right: { income: number; salesCount: number; name: string; userId: string },
): number {
  return right.income - left.income
    || right.salesCount - left.salesCount
    || left.name.localeCompare(right.name)
    || left.userId.localeCompare(right.userId);
}

const incomeRowSelect = {
  id: true,
  type: true,
  relatedDebtIncomeId: true,
  managerUserId: true,
  paymentAmount: true,
  entryDate: true,
} as const;

export const liveLeaderboardProcedures = {
  liveLeaderboardPreviousMonthWinner: protectedProcedure
    .input(z.object({ group: z.enum(['online', 'offline']).default('online') }).optional())
    .query(async ({ ctx, input }) => {
      const requestedGroup: AgentGroup = input?.group || 'online';
      if (!canReadLiveLeaderboard(ctx.user.roles, requestedGroup)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This leaderboard is not available for the current user role.',
        });
      }

      const now = new Date();
      const currentMonthStart = getRangeStart('month', now);
      const previousMonthEnd = new Date(currentMonthStart.getTime() - 1);
      const previousMonthStart = getRangeStart('month', previousMonthEnd);
      // Include agents deactivated since then: they still earned last month. Roles are not stored per month,
      // so group membership uses the current role.
      const agents = await prisma.user.findMany({
        where: { tenantId: ctx.tenantId, roles: { hasSome: groupAgentRoles(requestedGroup) } },
        select: { id: true, name: true, username: true, roles: true },
      });
      const groupedAgents = agents.filter((agent) => resolveAgentGroup(agent.roles) === requestedGroup);
      const agentIds = groupedAgents.map((agent) => agent.id);
      const period = { start: previousMonthStart.toISOString(), end: previousMonthEnd.toISOString() };

      if (!agentIds.length) {
        return { generatedAt: now.toISOString(), period, winner: null };
      }

      const rowsRaw = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: { gte: previousMonthStart, lte: previousMonthEnd },
        },
        select: incomeRowSelect,
      });
      const rows = excludeTechnicalRows(rowsRaw, await loadTechnicalSaleIdsForRows(ctx.tenantId, rowsRaw));
      const stats = summarizeLeaderboardAgents({ agentIds, monthRows: rows, todayStart: previousMonthEnd });
      // Finalized months come from the frozen snapshot, exactly what was paid.
      const bonusByAgent = sumBonusByAgent((await getBonusMonth({ tenantId: ctx.tenantId, month: previousMonthStart })).items, agentIds);

      const rankedAgents = groupedAgents
        .map((agent) => ({
          userId: agent.id,
          name: getAgentLabel(agent),
          salesCount: stats.monthlySales.get(agent.id) || 0,
          income: stats.monthIncome.get(agent.id) || 0,
          bonus: bonusByAgent.get(agent.id) || 0,
        }))
        .filter((agent) => agent.income > 0 || agent.salesCount > 0)
        .sort(compareLeaderboardAgents);

      return { generatedAt: now.toISOString(), period, winner: rankedAgents[0] || null };
    }),

  liveLeaderboardCallStats: protectedProcedure
    .input(z.object({ group: z.enum(['online', 'offline']).default('online') }).optional())
    .query(async ({ ctx, input }) => {
      const requestedGroup: AgentGroup = input?.group || 'online';
      if (!canReadLiveLeaderboard(ctx.user.roles, requestedGroup)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This leaderboard is not available for the current user role.',
        });
      }

      const now = new Date();
      const todayStart = getRangeStart('today', now);
      const agents = await prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          roles: {
            hasSome: requestedGroup === 'online'
              ? ['OnlineAgent']
              : ['OfflineAgent', 'TeamLeader'],
          },
        },
        select: {
          id: true,
          roles: true,
          utelManagerExternalId: true,
        },
      });
      const groupedAgents = agents.filter((agent) => resolveAgentGroup(agent.roles) === requestedGroup);
      const agentIds = groupedAgents.map((agent) => agent.id);
      const extensionToAgentId = new Map<string, string>();
      for (const agent of groupedAgents) {
        const extension = normalizeDigits(agent.utelManagerExternalId);
        if (isAllowedUtelManagerExtension(extension) && !extensionToAgentId.has(extension)) {
          extensionToAgentId.set(extension, agent.id);
        }
      }
      const extensions = Array.from(extensionToAgentId.keys());

      const [calls, corporateDurationByAgentId] = await Promise.all([
        extensions.length > 0
          ? prisma.call.findMany({
              where: {
                tenantId: ctx.tenantId,
                provider: 'utel',
                startedAt: { gte: todayStart, lte: now },
                OR: [
                  { from: { in: extensions } },
                  { to: { in: extensions } },
                ],
              },
              select: {
                from: true,
                to: true,
                direction: true,
                duration: true,
                metadata: true,
              },
            })
          : Promise.resolve([]),
        getCorporateCallDurationByManager({
          tenantId: ctx.tenantId,
          managerUserIds: agentIds,
          rangeStart: todayStart,
          rangeEnd: now,
        }),
      ]);

      const callCountByAgentId = new Map<string, number>();
      const callDurationByAgentId = new Map<string, number>();
      for (const call of calls) {
        const extension = resolveCallExtension(call);
        const agentId = extension ? extensionToAgentId.get(extension) : null;
        if (!agentId) {
          continue;
        }
        callCountByAgentId.set(agentId, (callCountByAgentId.get(agentId) || 0) + 1);
        callDurationByAgentId.set(
          agentId,
          (callDurationByAgentId.get(agentId) || 0) + resolveCallDuration(call.duration, call.metadata),
        );
      }

      return {
        generatedAt: now.toISOString(),
        agents: groupedAgents.map((agent) => ({
          userId: agent.id,
          todayCallsCount: callCountByAgentId.get(agent.id) || 0,
          todayCallDurationSeconds: (callDurationByAgentId.get(agent.id) || 0)
            + (corporateDurationByAgentId.get(agent.id) || 0),
        })),
      };
    }),

  liveLeaderboard: protectedProcedure
    .input(z.object({ group: z.enum(['online', 'offline']).default('online') }).optional())
    .query(async ({ ctx, input }) => {
      const requestedGroup: AgentGroup = input?.group || 'online';
      if (!canReadLiveLeaderboard(ctx.user.roles, requestedGroup)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This leaderboard is not available for the current user role.',
        });
      }

    const now = new Date();
    const todayStart = getRangeStart('today', now);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const weekStart = getRangeStart('week', now);
    const monthStart = getRangeStart('month', now);
    // Earliest date any KPI needs (the week, or "yesterday", can start in the previous month).
    const loadStart = new Date(Math.min(monthStart.getTime(), weekStart.getTime(), yesterdayStart.getTime()));

    const agents = await prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
        roles: { hasSome: groupAgentRoles(requestedGroup) },
      },
      select: {
        id: true,
        name: true,
        username: true,
        roles: true,
      },
      orderBy: [{ name: 'asc' }, { username: 'asc' }],
    });

    const groupedAgents = agents
      .map((agent) => ({ ...agent, group: resolveAgentGroup(agent.roles) }))
      .filter((agent): agent is LeaderboardAgent & { group: AgentGroup } => agent.group === requestedGroup);
    const agentIds = groupedAgents.map((agent) => agent.id);

    const selectedReportCourses = (await loadSelectedReportCourses(ctx.tenantId))
      .filter((course) => course.group === requestedGroup)
      .map(({ dashboardCategory: _dashboardCategory, ...course }) => course);

    if (!agentIds.length) {
      return {
        generatedAt: now.toISOString(),
        kpis: { todayIncome: 0, weekIncome: 0, monthIncome: 0 },
        agents: [],
        groupStats: {
          online: { todaySalesCount: 0, yesterdaySalesCount: 0 },
          offline: { todaySalesCount: 0, yesterdaySalesCount: 0 },
        },
        selectedReportCourses,
        latestIncomeEvent: null,
      };
    }

    const [rowsRaw, latestRowsRaw, bonusRange] = await Promise.all([
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: { gte: loadStart, lte: now },
        },
        select: incomeRowSelect,
      }),
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        select: {
          ...incomeRowSelect,
          createdAt: true,
          manager: { select: { name: true, username: true } },
        },
      }),
      calculateBonusRange({ tenantId: ctx.tenantId, rangeStart: monthStart, rangeEnd: now }),
    ]);

    // Technical sales (agreement == 1) and their repayments are not real income; only look up the sales we loaded.
    const technicalSaleIds = await loadTechnicalSaleIdsForRows(ctx.tenantId, [...rowsRaw, ...latestRowsRaw]);
    const rows = excludeTechnicalRows(rowsRaw, technicalSaleIds);
    const monthRows = rows.filter((row) => row.entryDate >= monthStart);
    const weekRows = rows.filter((row) => row.entryDate >= weekStart);
    const todayRows = rows.filter((row) => row.entryDate >= todayStart);
    // Sales counts use the payment date (entryDate), like every other number, not when the row was typed in.
    const todaySalesCount = todayRows.filter((row) => row.type === 'new_sale').length;
    const yesterdaySalesCount = rows.filter((row) => (
      row.type === 'new_sale' && row.entryDate >= yesterdayStart && row.entryDate < todayStart
    )).length;

    const stats = summarizeLeaderboardAgents({ agentIds, monthRows, todayStart });
    const monthlyBonusByAgent = sumBonusByAgent(bonusRange.items, agentIds);
    const sumRows = (list: Array<{ paymentAmount: number }>) => list.reduce((total, row) => total + (row.paymentAmount || 0), 0);

    const latestIncome = excludeTechnicalRows(latestRowsRaw, technicalSaleIds)[0] || null;

    return {
      generatedAt: now.toISOString(),
      kpis: {
        todayIncome: sumRows(todayRows),
        weekIncome: sumRows(weekRows),
        monthIncome: sumRows(monthRows),
      },
      groupStats: {
        online: requestedGroup === 'online'
          ? { todaySalesCount, yesterdaySalesCount }
          : { todaySalesCount: 0, yesterdaySalesCount: 0 },
        offline: requestedGroup === 'offline'
          ? { todaySalesCount, yesterdaySalesCount }
          : { todaySalesCount: 0, yesterdaySalesCount: 0 },
      },
      agents: groupedAgents.map((agent) => ({
        userId: agent.id,
        name: getAgentLabel(agent),
        group: agent.group,
        monthlySalesCount: stats.monthlySales.get(agent.id) || 0,
        monthlyIncome: stats.monthIncome.get(agent.id) || 0,
        todayIncome: stats.todayIncome.get(agent.id) || 0,
        monthlyBonus: monthlyBonusByAgent.get(agent.id) || 0,
      })),
      selectedReportCourses,
      latestIncomeEvent: latestIncome
        ? {
            incomeId: latestIncome.id,
            createdAt: latestIncome.createdAt.toISOString(),
            entryDate: latestIncome.entryDate.toISOString(),
            managerUserId: latestIncome.managerUserId,
            managerName: latestIncome.manager?.name?.trim() || latestIncome.manager?.username?.trim() || 'Agent',
            amount: latestIncome.paymentAmount,
          }
        : null,
    };
  }),
};
