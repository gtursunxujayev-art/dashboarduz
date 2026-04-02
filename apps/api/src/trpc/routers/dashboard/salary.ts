import {
  prisma,
  TRPCError,
  protectedProcedure,
  INCOME_LIFECYCLE_ACTIVE,
  isAgentOnly,
  getCurrentMonthRange,
  classifyCourseCategoryFromField,
  extractSalarySettings,
  createZeroBreakdown,
  resolveBonusPercent,
  getBonusAmount,
  normalizeSubTariffName,
  type SalaryBreakdown,
  type SalaryCategory,
  type PlanBonusPeriodMode,
} from './helpers';

export const salaryProcedures = {
  salarySummary: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const { monthStart, monthEnd } = getCurrentMonthRange(now);
    const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;

    const [tenant, allAgents] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      }),
      prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          isActive: true,
          roles: {
            has: 'Agent',
          },
        },
        orderBy: [{ name: 'asc' }, { username: 'asc' }],
        select: {
          id: true,
          name: true,
          username: true,
        },
      }),
    ]);

    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const salarySettings = extractSalarySettings(tenant.settings);
    const agents = scopedManagerUserId
      ? allAgents.filter((agent) => agent.id === scopedManagerUserId)
      : allAgents;
    const agentIds = agents.map((agent) => agent.id);

    if (!agentIds.length) {
      return {
        monthStart: monthStart.toISOString(),
        monthEnd: monthEnd.toISOString(),
        scopedToCurrentAgent: Boolean(scopedManagerUserId),
        bonusMode: salarySettings.bonusMode,
        bonusPercentages: salarySettings.bonusPercentages,
        totals: {
          fixedSalary: 0,
          bonus: 0,
          planBonus: 0,
          kpi: 0,
          salary: 0,
        },
        byAgent: [] as Array<{
          userId: string;
          name: string;
          fixedSalary: number;
          kpiAmount: number;
          bonusAmount: number;
          planBonusAmount: number;
          totalSalary: number;
          bonusBreakdown: SalaryBreakdown;
          planProgress: Array<{
            planId: string;
            name: string;
            periodMode: PlanBonusPeriodMode;
            target: number;
            fact: number;
            completionPercent: number;
            completedUnits: number;
            earnedAmount: number;
          }>;
        }>,
        currentUser: null,
      };
    }

    const salaryByAgent = new Map<
      string,
      {
        userId: string;
        name: string;
        fixedSalary: number;
        kpiAmount: number;
        bonusAmount: number;
        planBonusAmount: number;
        bonusBreakdown: SalaryBreakdown;
        planProgress: Array<{
          planId: string;
          name: string;
          periodMode: PlanBonusPeriodMode;
          target: number;
          fact: number;
          completionPercent: number;
          completedUnits: number;
          earnedAmount: number;
        }>;
      }
    >();

    for (const agent of agents) {
      salaryByAgent.set(agent.id, {
        userId: agent.id,
        name: agent.name || agent.username || agent.id,
        fixedSalary: salarySettings.fixedSalaries.get(agent.id) ?? 0,
        kpiAmount: 0,
        bonusAmount: 0,
        planBonusAmount: 0,
        bonusBreakdown: createZeroBreakdown(),
        planProgress: [],
      });
    }

    const [fullyPaidNewSalesForBonus, closingRepaymentsForBonus] = await Promise.all([
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          remainingDebtAmount: 0,
          entryDate: {
            lte: monthEnd,
          },
        },
        select: {
          id: true,
          managerUserId: true,
          coursePriceAmount: true,
          paymentAmount: true,
          entryDate: true,
          course: {
            select: {
              name: true,
              category: true,
            },
          },
        },
      }),
      prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'repayment',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          remainingDebtAmount: 0,
          relatedDebtIncomeId: { not: null },
          relatedDebtIncome: {
            managerUserId: { in: agentIds },
            type: 'new_sale',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          },
          entryDate: {
            lte: monthEnd,
          },
        },
        orderBy: {
          entryDate: 'asc',
        },
        select: {
          entryDate: true,
          relatedDebtIncomeId: true,
          relatedDebtIncome: {
            select: {
              id: true,
              managerUserId: true,
            },
          },
        },
      }),
    ]);

    const closeDateBySaleIdForBonus = new Map<string, Date>();
    for (const repayment of closingRepaymentsForBonus) {
      if (!repayment.relatedDebtIncomeId) {
        continue;
      }
      if (!closeDateBySaleIdForBonus.has(repayment.relatedDebtIncomeId)) {
        closeDateBySaleIdForBonus.set(repayment.relatedDebtIncomeId, repayment.entryDate);
      }
    }

    const monthlyClosedCountsByAgent = new Map<string, SalaryBreakdown>();
    const getMonthlyClosedCount = (agentId: string, category: SalaryCategory): number => {
      const byAgent = monthlyClosedCountsByAgent.get(agentId);
      return byAgent?.[category] ?? 0;
    };

    for (const sale of fullyPaidNewSalesForBonus) {
      const closeDate = closeDateBySaleIdForBonus.get(sale.id) ?? sale.entryDate;
      if (closeDate < monthStart || closeDate > monthEnd) {
        continue;
      }
      const category = sale.course?.category
        ? classifyCourseCategoryFromField(sale.course.category)
        : classifyCourseCategoryFromField(sale.course?.name);
      if (category === 'other') {
        continue;
      }
      const existing = monthlyClosedCountsByAgent.get(sale.managerUserId) ?? createZeroBreakdown();
      existing[category] += 1;
      monthlyClosedCountsByAgent.set(sale.managerUserId, existing);
    }

    if (salarySettings.bonusMode === 'on_income') {
      const incomes = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          managerUserId: { in: agentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          entryDate: {
            gte: monthStart,
            lte: monthEnd,
          },
        },
        select: {
          managerUserId: true,
          paymentAmount: true,
          course: {
            select: {
              name: true,
              category: true,
            },
          },
          relatedDebtIncome: {
            select: {
              course: {
                select: {
                  name: true,
                  category: true,
                },
              },
            },
          },
        },
      });

      for (const income of incomes) {
        const courseCategory = income.course?.category ?? income.relatedDebtIncome?.course?.category;
        const courseName = income.course?.name ?? income.relatedDebtIncome?.course?.name;
        const category = classifyCourseCategoryFromField(courseCategory || courseName);
        if (category === 'other') {
          continue;
        }
        const salaryRow = salaryByAgent.get(income.managerUserId);
        if (!salaryRow) {
          continue;
        }
        const closedCount = getMonthlyClosedCount(income.managerUserId, category);
        const percentage = resolveBonusPercent(salarySettings.bonusRules[category], closedCount);
        const bonusAmount = getBonusAmount(income.paymentAmount ?? 0, percentage);
        salaryRow.bonusAmount += bonusAmount;
        salaryRow.bonusBreakdown[category] += bonusAmount;
      }
    } else {
      const processedSaleIds = new Set<string>();
      const applyClosedSaleBonus = (sale: {
        id: string;
        managerUserId: string;
        coursePriceAmount: number | null;
        paymentAmount: number;
        course: { name: string; category: string } | null;
        entryDate: Date;
      }) => {
        if (processedSaleIds.has(sale.id)) {
          return;
        }
        processedSaleIds.add(sale.id);
        const closeDate = closeDateBySaleIdForBonus.get(sale.id) ?? sale.entryDate;
        if (closeDate < monthStart || closeDate > monthEnd) {
          return;
        }

        const category = sale.course?.category
          ? classifyCourseCategoryFromField(sale.course.category)
          : classifyCourseCategoryFromField(sale.course?.name);
        if (category === 'other') {
          return;
        }

        const salaryRow = salaryByAgent.get(sale.managerUserId);
        if (!salaryRow) {
          return;
        }

        const closedCount = getMonthlyClosedCount(sale.managerUserId, category);
        const percentage = resolveBonusPercent(salarySettings.bonusRules[category], closedCount);
        const agreementAmount = sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
        const bonusAmount = getBonusAmount(agreementAmount, percentage);
        salaryRow.bonusAmount += bonusAmount;
        salaryRow.bonusBreakdown[category] += bonusAmount;
      };

      for (const sale of fullyPaidNewSalesForBonus) {
        applyClosedSaleBonus(sale);
      }
    }

    const activePlanBonuses = salarySettings.planBonuses.filter((plan) => plan.isActive);
    if (activePlanBonuses.length > 0) {
      const [closedSales, closingRepayments] = await Promise.all([
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'new_sale',
            managerUserId: { in: agentIds },
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            remainingDebtAmount: 0,
          },
          select: {
            id: true,
            managerUserId: true,
            entryDate: true,
            courseId: true,
            tariffId: true,
            customer: {
              select: {
                profileSubTariffId: true,
              },
            },
            course: {
              select: {
                category: true,
              },
            },
          },
        }),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'repayment',
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            remainingDebtAmount: 0,
            relatedDebtIncomeId: { not: null },
            relatedDebtIncome: {
              managerUserId: { in: agentIds },
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            },
          },
          orderBy: {
            entryDate: 'asc',
          },
          select: {
            entryDate: true,
            relatedDebtIncomeId: true,
          },
        }),
      ]);

      const profileSubTariffIds = Array.from(
        new Set(
          closedSales
            .map((sale) => sale.customer?.profileSubTariffId)
            .filter((value): value is string => Boolean(value)),
        ),
      );
      const subTariffNameById = new Map<string, string>();
      if (profileSubTariffIds.length > 0) {
        const subTariffs = await prisma.subTariff.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: profileSubTariffIds },
          },
          select: {
            id: true,
            name: true,
          },
        });
        for (const subTariff of subTariffs) {
          subTariffNameById.set(subTariff.id, normalizeSubTariffName(subTariff.name));
        }
      }

      const closeDateBySaleId = new Map<string, Date>();
      for (const repayment of closingRepayments) {
        if (!repayment.relatedDebtIncomeId) {
          continue;
        }
        if (!closeDateBySaleId.has(repayment.relatedDebtIncomeId)) {
          closeDateBySaleId.set(repayment.relatedDebtIncomeId, repayment.entryDate);
        }
      }

      const monthStartMs = monthStart.getTime();
      const monthEndMs = monthEnd.getTime();
      const closedSalesFactsByAgentAndPlan = new Map<string, number>();

      const incrementPlanFact = (agentId: string, planId: string) => {
        const key = `${agentId}:${planId}`;
        closedSalesFactsByAgentAndPlan.set(key, (closedSalesFactsByAgentAndPlan.get(key) ?? 0) + 1);
      };

      for (const sale of closedSales) {
        const closeDate = closeDateBySaleId.get(sale.id) ?? sale.entryDate;
        const closeTimestamp = closeDate.getTime();
        const saleCourseCategory = String(sale.course?.category || '').trim().toLowerCase();

        for (const plan of activePlanBonuses) {
          if (plan.courseCategory !== saleCourseCategory) {
            continue;
          }
          if (plan.courseId && plan.courseId !== sale.courseId) {
            continue;
          }
          if (plan.tariffId && plan.tariffId !== sale.tariffId) {
            continue;
          }
          if (plan.subTariffId && plan.subTariffId !== sale.customer?.profileSubTariffId) {
            continue;
          }
          if (!plan.tariffId && plan.subTariffName) {
            const saleSubTariffName = sale.customer?.profileSubTariffId
              ? subTariffNameById.get(sale.customer.profileSubTariffId) || ''
              : '';
            if (!saleSubTariffName || saleSubTariffName !== normalizeSubTariffName(plan.subTariffName)) {
              continue;
            }
          }
          if (plan.periodMode === 'monthly' && (closeTimestamp < monthStartMs || closeTimestamp > monthEndMs)) {
            continue;
          }

          incrementPlanFact(sale.managerUserId, plan.id);
        }
      }

      for (const salaryRow of salaryByAgent.values()) {
        const planProgress = activePlanBonuses.map((plan) => {
          const fact = closedSalesFactsByAgentAndPlan.get(`${salaryRow.userId}:${plan.id}`) ?? 0;
          const completionPercent = plan.targetClosedSales > 0
            ? Number(((fact / plan.targetClosedSales) * 100).toFixed(1))
            : 0;
          const completedUnits = Math.floor(fact / plan.targetClosedSales);
          const earnedAmount = completedUnits * plan.bonusAmount;

          return {
            planId: plan.id,
            name: plan.name,
            periodMode: plan.periodMode,
            target: plan.targetClosedSales,
            fact,
            completionPercent,
            completedUnits,
            earnedAmount,
          };
        });

        salaryRow.planProgress = planProgress;
        salaryRow.planBonusAmount = planProgress.reduce((sum, item) => sum + item.earnedAmount, 0);
      }
    }

    const byAgent = Array.from(salaryByAgent.values())
      .map((row) => ({
        ...row,
        totalSalary: row.fixedSalary + row.kpiAmount + row.bonusAmount + row.planBonusAmount,
      }))
      .sort((a, b) => b.totalSalary - a.totalSalary);

    const totals = byAgent.reduce(
      (acc, row) => ({
        fixedSalary: acc.fixedSalary + row.fixedSalary,
        bonus: acc.bonus + row.bonusAmount,
        planBonus: acc.planBonus + row.planBonusAmount,
        kpi: acc.kpi + row.kpiAmount,
        salary: acc.salary + row.totalSalary,
      }),
      {
        fixedSalary: 0,
        bonus: 0,
        planBonus: 0,
        kpi: 0,
        salary: 0,
      },
    );

    return {
      monthStart: monthStart.toISOString(),
      monthEnd: monthEnd.toISOString(),
      scopedToCurrentAgent: Boolean(scopedManagerUserId),
      bonusMode: salarySettings.bonusMode,
      bonusPercentages: salarySettings.bonusPercentages,
      totals,
      byAgent,
      currentUser: byAgent.find((row) => row.userId === ctx.user.userId) || null,
    };
  }),
};
