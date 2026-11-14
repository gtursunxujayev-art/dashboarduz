import {
  classifyCourseCategoryFromField,
  getRangeStart,
  INCOME_LIFECYCLE_ACTIVE,
  isAllowedUtelManagerExtension,
  normalizeDigits,
  prisma,
  protectedProcedure,
  resolveBonusPercent,
  resolveCallDuration,
  resolveCallExtension,
  TRPCError,
  z,
} from './helpers';
import { getCorporateCallDurationByManager } from '../../../services/corporate-call-durations';
import {
  calculateBonusRange,
  resolveCourseIncomePercent,
  resolveEffectiveBonusPolicy,
  type BonusCalculationItem,
  type BonusPolicy,
} from '../../../services/bonus-engine';
import { excludeTechnicalRows, loadTechnicalSaleIdsForRows, resolveSaleAgreementAmount } from '../../../services/income-facts';
import { buildTechnicalSaleIdSet } from '../../../services/technical-income';
import { loadSelectedReportCourses, parseTelegramDailyReportCourseIds } from './selected-report-courses';
import { getCallsProvider } from '../../../services/calls-source';

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

export function resolveAgentGroup(roles: readonly string[]): AgentGroup | null {
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

/** Bonus per agent for the given courses only. Bonus items carry the course of the sale, so repayments count too. */
export function sumCourseBonusByAgent(
  items: BonusCalculationItem[],
  agentIds: string[],
  courseIds: string[],
): Map<string, number> {
  const courses = new Set(courseIds);
  return sumBonusByAgent(items.filter((item) => item.courseId !== null && courses.has(item.courseId)), agentIds);
}

/** Income of the given courses, all time: their sales plus every repayment of those sales. */
export function courseScopedIncomeWhere(courseIds: string[]) {
  return {
    OR: [
      { relatedDebtIncomeId: null, courseId: { in: courseIds } },
      { relatedDebtIncome: { courseId: { in: courseIds } } },
    ],
  };
}

type LeaderboardIncomeRow = { managerUserId: string; paymentAmount: number; entryDate: Date; type: string };

/**
 * Per-agent numbers for a board. A board belongs to a group of agents (by role), and `rows` is the board's period:
 * the selected courses on the online board, the current month on the offline board, where everything those agents
 * record counts, whatever the course category, so no sale can fall off both boards.
 */
export function summarizeLeaderboardAgents(params: {
  agentIds: string[];
  rows: LeaderboardIncomeRow[];
  todayStart: Date;
}) {
  const wanted = new Set(params.agentIds);
  const income = new Map<string, number>();
  const todayIncome = new Map<string, number>();
  const salesCount = new Map<string, number>();
  for (const row of params.rows) {
    if (!wanted.has(row.managerUserId)) continue;
    income.set(row.managerUserId, (income.get(row.managerUserId) || 0) + (row.paymentAmount || 0));
    if (row.entryDate >= params.todayStart) {
      todayIncome.set(row.managerUserId, (todayIncome.get(row.managerUserId) || 0) + (row.paymentAmount || 0));
    }
    if (row.type === 'new_sale') {
      salesCount.set(row.managerUserId, (salesCount.get(row.managerUserId) || 0) + 1);
    }
  }
  return { income, todayIncome, salesCount };
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

/** The board's best seller: same order as the board, and an agent with nothing in the period cannot win. */
export function pickLeaderboardWinner(
  agents: LeaderboardAgent[],
  stats: ReturnType<typeof summarizeLeaderboardAgents>,
  bonusByAgent: Map<string, number>,
) {
  return agents
    .map((agent) => ({
      userId: agent.id,
      name: getAgentLabel(agent),
      salesCount: stats.salesCount.get(agent.id) || 0,
      income: stats.income.get(agent.id) || 0,
      bonus: bonusByAgent.get(agent.id) || 0,
    }))
    .filter((agent) => agent.income > 0 || agent.salesCount > 0)
    .sort(compareLeaderboardAgents)[0] || null;
}

export type AgreementSale = {
  id: string;
  managerUserId: string;
  courseId: string | null;
  coursePriceAmount: number | null;
  debtAmount: number | null;
  paymentAmount: number;
  course: { name: string; category: string } | null;
};

/**
 * Leaderboard-only bonus and debt, credited to the seller. `bonus` (Kutilma) is the policy percent applied to the
 * whole agreement of every sale, as if it were already paid in full; `bonusFact` (Fakt) is the same, but only for
 * sales the customer has already paid in full, repayments included (the payroll bonus engine still pays on payments
 * and closures). Debt is what the customer still owes on the sale. `bonusPending` is the bonus the engine would
 * still pay once the debt is repaid: the whole agreement × percent when bonus is paid on closure (debt-closed mode
 * or a course override), the remaining debt × percent when it is paid on income.
 */
export function summarizeAgreementBonusAndDebt(params: {
  agentIds: string[];
  sales: AgreementSale[];
  paidBySaleId: Map<string, number>;
  policy: BonusPolicy;
  /**
   * Monthly boards: the percent payroll already applies to the agent in a course this month (`agent:course`), so
   * the bonus still to come uses the same rate as Fakt. Without it, a tiered rule is matched by the agent's number
   * of unpaid sales (as if they all closed), not by every sale since the course started.
   */
  appliedPercentByAgentCourse?: Map<string, number>;
}) {
  const wanted = new Set(params.agentIds);
  const sales = params.sales.filter((sale) => wanted.has(sale.managerUserId));
  const teamAgreementByCourse = new Map<string, number>();
  const salesCountByAgentCategory = new Map<string, number>();
  for (const sale of sales) {
    const agreement = resolveSaleAgreementAmount(sale);
    if (sale.courseId) {
      teamAgreementByCourse.set(sale.courseId, (teamAgreementByCourse.get(sale.courseId) || 0) + agreement);
    }
    const category = classifyCourseCategoryFromField(sale.course?.category || sale.course?.name);
    const unpaid = agreement - Math.min(agreement, params.paidBySaleId.get(sale.id) || 0) > 0;
    if (category !== 'other' && (!params.appliedPercentByAgentCourse || unpaid)) {
      const key = `${sale.managerUserId}:${category}`;
      salesCountByAgentCategory.set(key, (salesCountByAgentCategory.get(key) || 0) + 1);
    }
  }

  const bonus = new Map<string, number>();
  const bonusFact = new Map<string, number>();
  const bonusPending = new Map<string, number>();
  const debt = new Map<string, number>();
  for (const sale of sales) {
    const agreement = resolveSaleAgreementAmount(sale);
    const paid = Math.min(agreement, params.paidBySaleId.get(sale.id) || 0);
    const remaining = agreement - paid;
    debt.set(sale.managerUserId, (debt.get(sale.managerUserId) || 0) + remaining);

    const category = classifyCourseCategoryFromField(sale.course?.category || sale.course?.name);
    if (category === 'other') continue;
    const override = sale.courseId ? params.policy.courseOverrides[sale.courseId] : undefined;
    const appliedPercent = params.appliedPercentByAgentCourse?.get(`${sale.managerUserId}:${sale.courseId}`);
    const percent = appliedPercent !== undefined
      ? appliedPercent
      : override
      ? resolveCourseIncomePercent(override, teamAgreementByCourse.get(sale.courseId!) || 0).percent
      : resolveBonusPercent(
          params.policy.bonusRules[category],
          salesCountByAgentCategory.get(`${sale.managerUserId}:${category}`) || 0,
        );
    bonus.set(sale.managerUserId, (bonus.get(sale.managerUserId) || 0) + Math.round(agreement * percent / 100));
    if (remaining === 0) {
      bonusFact.set(sale.managerUserId, (bonusFact.get(sale.managerUserId) || 0) + Math.round(agreement * percent / 100));
    }
    if (remaining > 0) {
      const paidOnClosure = Boolean(override) || params.policy.bonusMode === 'on_debt_closed';
      const pending = Math.round((paidOnClosure ? agreement : remaining) * percent / 100);
      bonusPending.set(sale.managerUserId, (bonusPending.get(sale.managerUserId) || 0) + pending);
    }
  }
  return { bonus, bonusFact, bonusPending, debt };
}

/** Loads the agents' sales matching `saleWhere`, every payment on them, and summarizes bonus and debt. */
async function loadAgreementBonusAndDebt(params: {
  tenantId: string;
  agentIds: string[];
  saleWhere: Record<string, unknown>;
  now: Date;
  appliedPercentByAgentCourse?: Map<string, number>;
}) {
  if (!params.agentIds.length) {
    return {
      bonus: new Map<string, number>(),
      bonusFact: new Map<string, number>(),
      bonusPending: new Map<string, number>(),
      debt: new Map<string, number>(),
    };
  }
  const [salesRaw, { policy }] = await Promise.all([
    prisma.income.findMany({
      where: {
        tenantId: params.tenantId,
        type: 'new_sale',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        managerUserId: { in: params.agentIds },
        entryDate: { lte: params.now },
        ...params.saleWhere,
      },
      select: {
        id: true, type: true, managerUserId: true, courseId: true,
        coursePriceAmount: true, debtAmount: true, paymentAmount: true,
        course: { select: { name: true, category: true } },
      },
    }),
    resolveEffectiveBonusPolicy(params.tenantId, params.now),
  ]);
  const technicalSaleIds = buildTechnicalSaleIdSet(salesRaw);
  const sales = salesRaw.filter((sale) => !technicalSaleIds.has(sale.id));
  // Repayments count whoever recorded them: the debt belongs to the seller's customer.
  const repayments = sales.length
    ? await prisma.income.findMany({
        where: {
          tenantId: params.tenantId,
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          relatedDebtIncomeId: { in: sales.map((sale) => sale.id) },
          entryDate: { lte: params.now },
        },
        select: { relatedDebtIncomeId: true, paymentAmount: true },
      })
    : [];
  const paidBySaleId = new Map(sales.map((sale) => [sale.id, sale.paymentAmount || 0]));
  for (const row of repayments) {
    if (!row.relatedDebtIncomeId) continue;
    paidBySaleId.set(row.relatedDebtIncomeId, (paidBySaleId.get(row.relatedDebtIncomeId) || 0) + (row.paymentAmount || 0));
  }
  return summarizeAgreementBonusAndDebt({
    agentIds: params.agentIds,
    sales,
    paidBySaleId,
    policy,
    appliedPercentByAgentCourse: params.appliedPercentByAgentCourse,
  });
}

/**
 * The course(s) selected before the current ones: walks the selection history newest first and returns the
 * first entry's courses that are no longer selected.
 */
export function pickPreviousCourseIds(
  historyNewestFirst: string[][],
  currentCourseIds: string[],
  isEligible: (courseId: string) => boolean,
): string[] {
  const current = new Set(currentCourseIds);
  for (const selection of historyNewestFirst) {
    const previous = selection.filter((courseId) => !current.has(courseId) && isEligible(courseId));
    if (previous.length) return previous;
  }
  return [];
}

async function loadPreviousOnlineCourses(tenantId: string, currentCourseIds: string[]) {
  const logs = await prisma.auditLog.findMany({
    where: { tenantId, action: 'integration_update', resource: 'integration' },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { metadata: true },
  });
  const history = logs
    .filter((log) => (log.metadata as Record<string, unknown> | null)?.type === 'telegram'
      && Array.isArray((log.metadata as Record<string, unknown>).telegramDailyReportCourseIds))
    .map((log) => parseTelegramDailyReportCourseIds(log.metadata));
  const historyIds = Array.from(new Set(history.flat()));
  if (!historyIds.length) return [];
  const courses = await prisma.course.findMany({
    where: { tenantId, id: { in: historyIds } },
    select: { id: true, name: true, category: true },
  });
  const onlineById = new Map(courses
    .filter((course) => classifyCourseCategoryFromField(course.category || course.name) === 'online')
    .map((course) => [course.id, course]));
  return pickPreviousCourseIds(history, currentCourseIds, (courseId) => onlineById.has(courseId))
    .map((courseId) => onlineById.get(courseId)!);
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
      const stats = summarizeLeaderboardAgents({ agentIds, rows, todayStart: previousMonthEnd });
      // Leaderboard bonus: percent of the whole agreement of last month's sales.
      const bonusByAgent = (await loadAgreementBonusAndDebt({
        tenantId: ctx.tenantId,
        agentIds,
        saleWhere: { entryDate: { gte: previousMonthStart, lte: previousMonthEnd } },
        now,
      })).bonus;

      return { generatedAt: now.toISOString(), period, winner: pickLeaderboardWinner(groupedAgents, stats, bonusByAgent) };
    }),

  // Bonus and debt of the online board's current course(s), and the best seller of the previous course.
  // Polled slowly instead of on the board's 2-second refresh.
  liveLeaderboardCourseStats: protectedProcedure.query(async ({ ctx }) => {
    if (!canReadLiveLeaderboard(ctx.user.roles, 'online')) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This leaderboard is not available for the current user role.',
      });
    }

    const now = new Date();
    const courseIds = (await loadSelectedReportCourses(ctx.tenantId))
      .filter((course) => course.group === 'online')
      .map((course) => course.courseId);
    // Include deactivated agents: they still count for a course they sold.
    const agents = await prisma.user.findMany({
      where: { tenantId: ctx.tenantId, roles: { hasSome: groupAgentRoles('online') } },
      select: { id: true, name: true, username: true, roles: true },
    });
    const groupedAgents = agents.filter((agent) => resolveAgentGroup(agent.roles) === 'online');
    const agentIds = groupedAgents.map((agent) => agent.id);

    const [current, previousCourses] = await Promise.all([
      courseIds.length
        ? loadAgreementBonusAndDebt({ tenantId: ctx.tenantId, agentIds, saleWhere: { courseId: { in: courseIds } }, now })
        : null,
      loadPreviousOnlineCourses(ctx.tenantId, courseIds),
    ]);
    const previousCourseIds = previousCourses.map((course) => course.id);

    let winner: ReturnType<typeof pickLeaderboardWinner> = null;
    if (previousCourseIds.length && agentIds.length) {
      const [rowsRaw, previous] = await Promise.all([
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            managerUserId: { in: agentIds },
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: { lte: now },
            ...courseScopedIncomeWhere(previousCourseIds),
          },
          select: incomeRowSelect,
        }),
        loadAgreementBonusAndDebt({ tenantId: ctx.tenantId, agentIds, saleWhere: { courseId: { in: previousCourseIds } }, now }),
      ]);
      const rows = excludeTechnicalRows(rowsRaw, await loadTechnicalSaleIdsForRows(ctx.tenantId, rowsRaw));
      const stats = summarizeLeaderboardAgents({ agentIds, rows, todayStart: now });
      winner = pickLeaderboardWinner(groupedAgents, stats, previous.bonus);
    }

    return {
      generatedAt: now.toISOString(),
      agents: groupedAgents.map((agent) => ({
        userId: agent.id,
        bonus: current?.bonus.get(agent.id) || 0,
        bonusFact: current?.bonusFact.get(agent.id) || 0,
        debt: current?.debt.get(agent.id) || 0,
      })),
      previousCourseNames: previousCourses.map((course) => course.name),
      winner,
    };
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
                provider: await getCallsProvider(ctx.tenantId),
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
    // The online board shows the courses selected for the Telegram report instead of the month; all of them
    // together when several are selected, nothing when none is. The offline board stays monthly.
    const courseIds = requestedGroup === 'online' ? selectedReportCourses.map((course) => course.courseId) : null;
    const courseWhere = courseIds ? courseScopedIncomeWhere(courseIds) : {};

    if (!agentIds.length) {
      return {
        generatedAt: now.toISOString(),
        kpis: { todayIncome: 0, weekIncome: 0, totalIncome: 0 },
        agents: [],
        groupStats: {
          online: { todaySalesCount: 0, yesterdaySalesCount: 0 },
          offline: { todaySalesCount: 0, yesterdaySalesCount: 0 },
        },
        selectedReportCourses,
        latestIncomeEvent: null,
      };
    }

    const offlineCourseIds = courseIds ? [] : selectedReportCourses.map((course) => course.courseId);
    const [rowsRaw, latestRowsRaw, offlineMonthBonus] = await Promise.all([
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: courseIds ? { lte: now } : { gte: loadStart, lte: now },
          ...courseWhere,
        },
        select: incomeRowSelect,
      }),
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          ...courseWhere,
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        select: {
          ...incomeRowSelect,
          createdAt: true,
          manager: { select: { name: true, username: true } },
        },
      }),
      // The online board gets its bonus and debt from liveLeaderboardCourseStats. The offline bonus is paid monthly,
      // all over the selected offline course(s): Fakt is this month's real bonus from the bonus engine (sales paid
      // off in earlier months were already paid out and are left out), Kutilma adds what the course's still-unpaid
      // sales will earn once repaid.
      offlineCourseIds.length
        ? calculateBonusRange({ tenantId: ctx.tenantId, rangeStart: monthStart, rangeEnd: now })
        : null,
    ]);
    const appliedPercentByAgentCourse = new Map<string, number>();
    for (const item of offlineMonthBonus?.items || []) {
      if (item.courseId) appliedPercentByAgentCourse.set(`${item.agentUserId}:${item.courseId}`, item.appliedPercent);
    }
    const offlineCourseStats = offlineCourseIds.length
      ? await loadAgreementBonusAndDebt({
          tenantId: ctx.tenantId,
          agentIds,
          saleWhere: { courseId: { in: offlineCourseIds } },
          now,
          appliedPercentByAgentCourse,
        })
      : null;

    // Technical sales (agreement == 1) and their repayments are not real income; only look up the sales we loaded.
    const technicalSaleIds = await loadTechnicalSaleIdsForRows(ctx.tenantId, [...rowsRaw, ...latestRowsRaw]);
    const rows = excludeTechnicalRows(rowsRaw, technicalSaleIds);
    const periodRows = courseIds ? rows : rows.filter((row) => row.entryDate >= monthStart);
    const weekRows = rows.filter((row) => row.entryDate >= weekStart);
    const todayRows = rows.filter((row) => row.entryDate >= todayStart);
    // Sales counts use the payment date (entryDate), like every other number, not when the row was typed in.
    const todaySalesCount = todayRows.filter((row) => row.type === 'new_sale').length;
    const yesterdaySalesCount = rows.filter((row) => (
      row.type === 'new_sale' && row.entryDate >= yesterdayStart && row.entryDate < todayStart
    )).length;

    const stats = summarizeLeaderboardAgents({ agentIds, rows: periodRows, todayStart });
    const bonusFactByAgent = sumCourseBonusByAgent(offlineMonthBonus?.items || [], agentIds, offlineCourseIds);
    const pendingByAgent = offlineCourseStats?.bonusPending || new Map<string, number>();
    const bonusByAgent = new Map(agentIds.map((id) => [id, (bonusFactByAgent.get(id) || 0) + (pendingByAgent.get(id) || 0)]));
    const debtByAgent = offlineCourseStats?.debt || new Map<string, number>();
    const sumRows = (list: Array<{ paymentAmount: number }>) => list.reduce((total, row) => total + (row.paymentAmount || 0), 0);

    const latestIncome = excludeTechnicalRows(latestRowsRaw, technicalSaleIds)[0] || null;

    return {
      generatedAt: now.toISOString(),
      kpis: {
        todayIncome: sumRows(todayRows),
        weekIncome: sumRows(weekRows),
        totalIncome: sumRows(periodRows),
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
        salesCount: stats.salesCount.get(agent.id) || 0,
        income: stats.income.get(agent.id) || 0,
        todayIncome: stats.todayIncome.get(agent.id) || 0,
        bonus: bonusByAgent.get(agent.id) || 0,
        bonusFact: bonusFactByAgent.get(agent.id) || 0,
        debt: debtByAgent.get(agent.id) || 0,
      })),
      selectedReportCourses,
      latestIncomeEvent: latestIncome
        ? {
            incomeId: latestIncome.id,
            type: latestIncome.type,
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
