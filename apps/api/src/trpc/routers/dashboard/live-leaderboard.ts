import {
  classifyCourseCategoryFromField,
  createZeroBreakdown,
  extractSalarySettings,
  getBonusAmount,
  getRangeStart,
  INCOME_LIFECYCLE_ACTIVE,
  prisma,
  protectedProcedure,
  resolveBonusPercent,
  TRPCError,
  type SalaryBreakdown,
  type SalaryCategory,
} from './helpers';
import { buildTechnicalSaleIdSet, isRowLinkedToTechnicalSale } from '../../../services/technical-income';

const LIVE_LEADERBOARD_ROLES = new Set(['Admin', 'Manager', 'Dashboard']);

type AgentGroup = 'online' | 'offline';

type LeaderboardAgent = {
  id: string;
  name: string | null;
  username: string | null;
  roles: string[];
};

function parseTelegramDailyReportCourseIds(config: unknown): string[] {
  const raw = config && typeof config === 'object' && !Array.isArray(config)
    ? (config as Record<string, unknown>).telegramDailyReportCourseIds
    : null;
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(new Set(
    raw
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )).slice(0, 3);
}

function canReadLiveLeaderboard(roles: readonly string[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.some((role) => LIVE_LEADERBOARD_ROLES.has(role));
}

function resolveAgentGroup(roles: readonly string[]): AgentGroup | null {
  if (roles.includes('OnlineAgent')) return 'online';
  if (roles.includes('OfflineAgent') || roles.includes('TeamLeader')) return 'offline';
  return null;
}

function getAgentLabel(agent: LeaderboardAgent): string {
  return agent.name?.trim() || agent.username?.trim() || 'Agent';
}

function sumPaymentAmount(rows: Array<{ paymentAmount: number }>): number {
  return rows.reduce((total, row) => total + (row.paymentAmount || 0), 0);
}

function resolveCoursePanelGroup(category: string | null | undefined): AgentGroup {
  return String(category || '').trim().toLowerCase() === 'online' ? 'online' : 'offline';
}

function resolveSalePanelGroup(category: string | null | undefined, name: string | null | undefined): AgentGroup {
  const classified = classifyCourseCategoryFromField(category || name);
  return classified === 'online' ? 'online' : 'offline';
}

function incrementBreakdown(map: Map<string, SalaryBreakdown>, agentId: string, category: SalaryCategory) {
  const existing = map.get(agentId) ?? createZeroBreakdown();
  existing[category] += 1;
  map.set(agentId, existing);
}

async function calculateMonthlyBonusByAgent(params: {
  tenantId: string;
  agentIds: string[];
  monthStart: Date;
  monthEnd: Date;
  technicalSaleIds: Set<string>;
}): Promise<Map<string, number>> {
  const { tenantId, agentIds, monthStart, monthEnd, technicalSaleIds } = params;
  const result = new Map<string, number>(agentIds.map((agentId) => [agentId, 0]));
  if (!agentIds.length) return result;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) return result;

  const salarySettings = extractSalarySettings(tenant.settings);
  const [closedSalesRaw, closingRepayments] = await Promise.all([
    prisma.income.findMany({
      where: {
        tenantId,
        type: 'new_sale',
        managerUserId: { in: agentIds },
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        remainingDebtAmount: 0,
        entryDate: { lte: monthEnd },
      },
      select: {
        id: true,
        managerUserId: true,
        entryDate: true,
        coursePriceAmount: true,
        debtAmount: true,
        paymentAmount: true,
        course: { select: { name: true, category: true } },
      },
    }),
    prisma.income.findMany({
      where: {
        tenantId,
        type: 'repayment',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        remainingDebtAmount: 0,
        relatedDebtIncomeId: { not: null },
        relatedDebtIncome: {
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          managerUserId: { in: agentIds },
        },
        entryDate: { lte: monthEnd },
      },
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        entryDate: true,
        relatedDebtIncomeId: true,
      },
    }),
  ]);

  const closedSales = closedSalesRaw.filter((sale) => !technicalSaleIds.has(sale.id));
  const closeDateBySaleId = new Map<string, Date>();
  for (const repayment of closingRepayments) {
    if (!repayment.relatedDebtIncomeId || technicalSaleIds.has(repayment.relatedDebtIncomeId)) {
      continue;
    }
    if (!closeDateBySaleId.has(repayment.relatedDebtIncomeId)) {
      closeDateBySaleId.set(repayment.relatedDebtIncomeId, repayment.entryDate);
    }
  }

  const closedCountsByAgent = new Map<string, SalaryBreakdown>();
  for (const sale of closedSales) {
    const closeDate = closeDateBySaleId.get(sale.id) ?? sale.entryDate;
    if (closeDate < monthStart || closeDate > monthEnd) {
      continue;
    }
    const category = sale.course?.category
      ? classifyCourseCategoryFromField(sale.course.category)
      : classifyCourseCategoryFromField(sale.course?.name);
    if (category === 'other') {
      continue;
    }
    incrementBreakdown(closedCountsByAgent, sale.managerUserId, category);
  }

  const getClosedCount = (agentId: string, category: SalaryCategory) => (
    closedCountsByAgent.get(agentId)?.[category] ?? 0
  );

  if (salarySettings.bonusMode === 'on_income') {
    const incomes = await prisma.income.findMany({
      where: {
        tenantId,
        managerUserId: { in: agentIds },
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        entryDate: { gte: monthStart, lte: monthEnd },
      },
      select: {
        id: true,
        type: true,
        relatedDebtIncomeId: true,
        managerUserId: true,
        paymentAmount: true,
        course: { select: { name: true, category: true } },
        relatedDebtIncome: {
          select: {
            course: { select: { name: true, category: true } },
          },
        },
      },
    });

    for (const income of incomes) {
      if (isRowLinkedToTechnicalSale({
        rowType: income.type,
        rowId: income.id,
        relatedDebtIncomeId: income.relatedDebtIncomeId,
        technicalSaleIds,
      })) {
        continue;
      }
      const category = classifyCourseCategoryFromField(
        income.course?.category
          || income.relatedDebtIncome?.course?.category
          || income.course?.name
          || income.relatedDebtIncome?.course?.name,
      );
      if (category === 'other') continue;
      const percentage = resolveBonusPercent(salarySettings.bonusRules[category], getClosedCount(income.managerUserId, category));
      result.set(income.managerUserId, (result.get(income.managerUserId) || 0) + getBonusAmount(income.paymentAmount || 0, percentage));
    }
    return result;
  }

  const processedSaleIds = new Set<string>();
  for (const sale of closedSales) {
    if (processedSaleIds.has(sale.id)) continue;
    processedSaleIds.add(sale.id);

    const closeDate = closeDateBySaleId.get(sale.id) ?? sale.entryDate;
    if (closeDate < monthStart || closeDate > monthEnd) {
      continue;
    }
    const category = sale.course?.category
      ? classifyCourseCategoryFromField(sale.course.category)
      : classifyCourseCategoryFromField(sale.course?.name);
    if (category === 'other') {
      continue;
    }
    const percentage = resolveBonusPercent(salarySettings.bonusRules[category], getClosedCount(sale.managerUserId, category));
    const agreementAmount = sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
    result.set(sale.managerUserId, (result.get(sale.managerUserId) || 0) + getBonusAmount(agreementAmount, percentage));
  }

  return result;
}

export const liveLeaderboardProcedures = {
  liveLeaderboard: protectedProcedure.query(async ({ ctx }) => {
    if (!canReadLiveLeaderboard(ctx.user.roles)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Live leaderboard is available only for Admin, Manager and Dashboard users.',
      });
    }

    const now = new Date();
    const todayStart = getRangeStart('today', now);
    const weekStart = getRangeStart('week', now);
    const monthStart = getRangeStart('month', now);

    const agents = await prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
        roles: { hasSome: ['OnlineAgent', 'OfflineAgent', 'TeamLeader'] },
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
      .filter((agent): agent is LeaderboardAgent & { group: AgentGroup } => Boolean(agent.group));
    const agentIds = groupedAgents.map((agent) => agent.id);

    const technicalSales = await prisma.income.findMany({
      where: {
        tenantId: ctx.tenantId,
        type: 'new_sale',
        lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
      },
      select: {
        id: true,
        type: true,
        coursePriceAmount: true,
        debtAmount: true,
        paymentAmount: true,
      },
    });
    const technicalSaleIds = buildTechnicalSaleIdSet(technicalSales);

    const telegramIntegration = await prisma.integration.findUnique({
      where: {
        tenantId_type: {
          tenantId: ctx.tenantId,
          type: 'telegram',
        },
      },
      select: {
        status: true,
        config: true,
      },
    });
    const selectedCourseIds = telegramIntegration?.status === 'active'
      ? parseTelegramDailyReportCourseIds(telegramIntegration.config)
      : [];

    const [selectedCourses, selectedCourseSalesRaw] = selectedCourseIds.length > 0
      ? await Promise.all([
          prisma.course.findMany({
            where: {
              tenantId: ctx.tenantId,
              id: { in: selectedCourseIds },
            },
            select: {
              id: true,
              name: true,
              category: true,
            },
          }),
          prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              courseId: { in: selectedCourseIds },
            },
            select: {
              id: true,
              type: true,
              relatedDebtIncomeId: true,
              courseId: true,
            },
          }),
        ])
      : [[], []] as const;

    const selectedCourseSales = selectedCourseSalesRaw.filter((row) => !isRowLinkedToTechnicalSale({
      rowType: row.type,
      rowId: row.id,
      relatedDebtIncomeId: row.relatedDebtIncomeId,
      technicalSaleIds,
    }));
    const selectedCourseSalesCountById = new Map<string, number>();
    for (const sale of selectedCourseSales) {
      if (!sale.courseId) continue;
      selectedCourseSalesCountById.set(sale.courseId, (selectedCourseSalesCountById.get(sale.courseId) || 0) + 1);
    }
    const selectedCoursesById = new Map(selectedCourses.map((course) => [course.id, course]));
    const selectedReportCourses = selectedCourseIds
      .map((courseId) => {
        const course = selectedCoursesById.get(courseId);
        if (!course) return null;
        const category = String(course.category || '').trim();
        return {
          courseId: course.id,
          name: course.name,
          category,
          group: resolveCoursePanelGroup(category),
          salesCount: selectedCourseSalesCountById.get(course.id) || 0,
        };
      })
      .filter((course): course is NonNullable<typeof course> => Boolean(course));

    if (!agentIds.length) {
      return {
        generatedAt: now.toISOString(),
        kpis: { todayIncome: 0, weekIncome: 0, monthIncome: 0 },
        agents: [],
        groupStats: {
          online: { todaySalesCount: 0 },
          offline: { todaySalesCount: 0 },
        },
        selectedReportCourses,
        latestIncomeEvent: null,
      };
    }

    const [monthRowsRaw, weekRowsRaw, monthlySalesRaw, todaySalesRaw, latestRowsRaw] = await Promise.all([
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: { gte: monthStart, lte: now },
        },
        select: {
          id: true,
          type: true,
          relatedDebtIncomeId: true,
          managerUserId: true,
          paymentAmount: true,
          entryDate: true,
        },
      }),
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: { gte: weekStart, lte: now },
        },
        select: {
          id: true,
          type: true,
          relatedDebtIncomeId: true,
          managerUserId: true,
          paymentAmount: true,
          entryDate: true,
        },
      }),
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: { gte: monthStart, lte: now },
        },
        select: {
          id: true,
          type: true,
          relatedDebtIncomeId: true,
          managerUserId: true,
          course: {
            select: {
              category: true,
              name: true,
            },
          },
        },
      }),
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: { gte: todayStart, lte: now },
        },
        select: {
          id: true,
          type: true,
          relatedDebtIncomeId: true,
          course: {
            select: {
              category: true,
              name: true,
            },
          },
        },
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
          id: true,
          type: true,
          relatedDebtIncomeId: true,
          managerUserId: true,
          paymentAmount: true,
          entryDate: true,
          createdAt: true,
          manager: { select: { name: true, username: true } },
        },
      }),
    ]);

    const isNonTechnicalRow = (row: { id: string; type: string; relatedDebtIncomeId: string | null }) => !isRowLinkedToTechnicalSale({
      rowType: row.type,
      rowId: row.id,
      relatedDebtIncomeId: row.relatedDebtIncomeId,
      technicalSaleIds,
    });

    const monthRows = monthRowsRaw.filter(isNonTechnicalRow);
    const weekRows = weekRowsRaw.filter(isNonTechnicalRow);
    const monthlySales = monthlySalesRaw.filter(isNonTechnicalRow);
    const todaySales = todaySalesRaw.filter(isNonTechnicalRow);
    const todayRows = monthRows.filter((row) => row.entryDate >= todayStart);
    const monthlyBonusByAgent = await calculateMonthlyBonusByAgent({
      tenantId: ctx.tenantId,
      agentIds,
      monthStart,
      monthEnd: now,
      technicalSaleIds,
    });

    const monthIncomeByAgent = new Map<string, number>();
    const todayIncomeByAgent = new Map<string, number>();
    const monthlySalesByAgent = new Map<string, number>();
    const agentGroupById = new Map(groupedAgents.map((agent) => [agent.id, agent.group]));
    const groupTodaySalesCount = {
      online: 0,
      offline: 0,
    };

    for (const row of monthRows) {
      monthIncomeByAgent.set(row.managerUserId, (monthIncomeByAgent.get(row.managerUserId) || 0) + row.paymentAmount);
      if (row.entryDate >= todayStart) {
        todayIncomeByAgent.set(row.managerUserId, (todayIncomeByAgent.get(row.managerUserId) || 0) + row.paymentAmount);
      }
    }
    for (const sale of monthlySales) {
      const agentGroup = agentGroupById.get(sale.managerUserId);
      if (!agentGroup) {
        continue;
      }
      const saleGroup = resolveSalePanelGroup(sale.course?.category, sale.course?.name);
      if (saleGroup !== agentGroup) {
        continue;
      }
      monthlySalesByAgent.set(sale.managerUserId, (monthlySalesByAgent.get(sale.managerUserId) || 0) + 1);
    }
    for (const sale of todaySales) {
      const saleGroup = resolveSalePanelGroup(sale.course?.category, sale.course?.name);
      groupTodaySalesCount[saleGroup] += 1;
    }

    const latestIncome = latestRowsRaw.find(isNonTechnicalRow) || null;

    return {
      generatedAt: now.toISOString(),
      kpis: {
        todayIncome: sumPaymentAmount(todayRows),
        weekIncome: sumPaymentAmount(weekRows),
        monthIncome: sumPaymentAmount(monthRows),
      },
      groupStats: {
        online: { todaySalesCount: groupTodaySalesCount.online },
        offline: { todaySalesCount: groupTodaySalesCount.offline },
      },
      agents: groupedAgents.map((agent) => ({
        userId: agent.id,
        name: getAgentLabel(agent),
        group: agent.group,
        monthlySalesCount: monthlySalesByAgent.get(agent.id) || 0,
        monthlyIncome: monthIncomeByAgent.get(agent.id) || 0,
        todayIncome: todayIncomeByAgent.get(agent.id) || 0,
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
