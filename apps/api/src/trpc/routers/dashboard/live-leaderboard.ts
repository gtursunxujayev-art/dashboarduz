import { managerGroupSchema, normalizeDigits } from '@dashboarduz/shared';

import { getRangeStart } from '../../../lib/dates';
import { isAllowedUtelManagerExtension, resolveCallDuration, resolveCallExtension } from '../../../lib/utel';
import { calculateBonusRange } from '../../../services/bonus-engine';
import { getCallsProvider } from '../../../services/calls-source';
import { getCorporateCallDurationByManager } from '../../../services/corporate-call-durations';
import { type AgentGroup, canReadLiveLeaderboard, courseScopedIncomeWhere, getAgentLabel, groupAgentRoles, incomeRowSelect, type LeaderboardAgent, loadAgreementBonusAndDebt, loadPreviousOnlineCourses, pickLeaderboardWinner, projectMonthlyKutilma, resolveAgentGroup, sumCourseBonusByAgent, summarizeLeaderboardAgents } from '../../../services/dashboard/live-leaderboard';
import { INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { excludeTechnicalRows, loadTechnicalSaleIdsForRows } from '../../../services/income-facts';

import { protectedProcedure, TRPCError, z } from './helpers';
import { loadSelectedReportCourses } from './selected-report-courses';

export { resolveAgentGroup, sumBonusByAgent, sumCourseBonusByAgent, courseScopedIncomeWhere, summarizeLeaderboardAgents, compareLeaderboardAgents, pickLeaderboardWinner, type AgreementSale, summarizeAgreementBonusAndDebt, type OpenSale, projectMonthlyKutilma, pickPreviousCourseIds } from '../../../services/dashboard/live-leaderboard';

export const liveLeaderboardProcedures = {
  liveLeaderboardPreviousMonthWinner: protectedProcedure
    .input(z.object({ group: managerGroupSchema.default('online') }).optional())
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
      const agents = await ctx.db.user.findMany({
        where: { tenantId: ctx.tenantId, roles: { hasSome: groupAgentRoles(requestedGroup) } },
        select: { id: true, name: true, username: true, roles: true },
      });
      const groupedAgents = agents.filter((agent) => resolveAgentGroup(agent.roles) === requestedGroup);
      const agentIds = groupedAgents.map((agent) => agent.id);
      const period = { start: previousMonthStart.toISOString(), end: previousMonthEnd.toISOString() };

      if (!agentIds.length) {
        return { generatedAt: now.toISOString(), period, winner: null };
      }

      const rowsRaw = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: { gte: previousMonthStart, lte: previousMonthEnd },
        },
        select: incomeRowSelect,
      });
      const rows = excludeTechnicalRows(rowsRaw, await loadTechnicalSaleIdsForRows(ctx.tenantId, rowsRaw, ctx.db));
      const stats = summarizeLeaderboardAgents({ agentIds, rows, todayStart: previousMonthEnd });
      // Leaderboard bonus: percent of the whole agreement of last month's sales.
      const bonusByAgent = (await loadAgreementBonusAndDebt({
        tenantId: ctx.tenantId,
        agentIds,
        saleWhere: { entryDate: { gte: previousMonthStart, lte: previousMonthEnd } },
        now,
        db: ctx.db,
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
    const courseIds = (await loadSelectedReportCourses(ctx.tenantId, ctx.db))
      .filter((course) => course.group === 'online')
      .map((course) => course.courseId);
    // Include deactivated agents: they still count for a course they sold.
    const agents = await ctx.db.user.findMany({
      where: { tenantId: ctx.tenantId, roles: { hasSome: groupAgentRoles('online') } },
      select: { id: true, name: true, username: true, roles: true },
    });
    const groupedAgents = agents.filter((agent) => resolveAgentGroup(agent.roles) === 'online');
    const agentIds = groupedAgents.map((agent) => agent.id);

    const [current, previousCourses] = await Promise.all([
      courseIds.length
        ? loadAgreementBonusAndDebt({ tenantId: ctx.tenantId, agentIds, saleWhere: { courseId: { in: courseIds } }, now, db: ctx.db })
        : null,
      loadPreviousOnlineCourses(ctx.tenantId, courseIds, ctx.db),
    ]);
    const previousCourseIds = previousCourses.map((course) => course.id);

    let winner: ReturnType<typeof pickLeaderboardWinner> = null;

    if (previousCourseIds.length && agentIds.length) {
      const [rowsRaw, previous] = await Promise.all([
        ctx.db.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            managerUserId: { in: agentIds },
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: { lte: now },
            ...courseScopedIncomeWhere(previousCourseIds),
          },
          select: incomeRowSelect,
        }),
        loadAgreementBonusAndDebt({ tenantId: ctx.tenantId, agentIds, saleWhere: { courseId: { in: previousCourseIds } }, now, db: ctx.db }),
      ]);
      const rows = excludeTechnicalRows(rowsRaw, await loadTechnicalSaleIdsForRows(ctx.tenantId, rowsRaw, ctx.db));
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
    .input(z.object({ group: managerGroupSchema.default('online') }).optional())
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
      const agents = await ctx.db.user.findMany({
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
          ? ctx.db.call.findMany({
              where: {
                tenantId: ctx.tenantId,
                provider: await getCallsProvider(ctx.tenantId, ctx.db),
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
          db: ctx.db,
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
    .input(z.object({ group: managerGroupSchema.default('online') }).optional())
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

    const agents = await ctx.db.user.findMany({
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

    const selectedReportCourses = (await loadSelectedReportCourses(ctx.tenantId, ctx.db))
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
      ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: courseIds ? { lte: now } : { gte: loadStart, lte: now },
          ...courseWhere,
        },
        select: incomeRowSelect,
      }),
      ctx.db.income.findMany({
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
      // off in earlier months were already paid out and are left out), Kutilma is this month's bonus if every
      // still-unpaid sale of the course were paid off this month (projectMonthlyKutilma).
      offlineCourseIds.length
        ? calculateBonusRange({ tenantId: ctx.tenantId, rangeStart: monthStart, rangeEnd: now, db: ctx.db })
        : null,
    ]);
    const offlineCourseStats = offlineCourseIds.length
      ? await loadAgreementBonusAndDebt({ tenantId: ctx.tenantId, agentIds, saleWhere: { courseId: { in: offlineCourseIds } }, now, db: ctx.db })
      : null;

    // Technical sales (agreement == 1) and their repayments are not real income; only look up the sales we loaded.
    const technicalSaleIds = await loadTechnicalSaleIdsForRows(ctx.tenantId, [...rowsRaw, ...latestRowsRaw], ctx.db);
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
    const currentMonthPolicy = offlineMonthBonus?.months[offlineMonthBonus.months.length - 1]?.policy;
    const bonusByAgent = offlineMonthBonus && currentMonthPolicy
      ? projectMonthlyKutilma({
          agentIds,
          policy: currentMonthPolicy,
          monthItems: offlineMonthBonus.items,
          courseIds: offlineCourseIds,
          openSales: offlineCourseStats?.openSales || [],
        })
      : new Map<string, number>();
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
