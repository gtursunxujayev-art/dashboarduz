import { z } from 'zod';
import {
  prisma,
  TRPCError,
  protectedProcedure,
  INCOME_LIFECYCLE_ACTIVE,
  isAgentOnly,
  isTashkiliyOnly,
  getCurrentMonthRange,
  dashboardRangeSchema,
  resolveDateRange,
  shiftToReportTimezone,
  getDaysInReportLocalMonth,
  classifyCourseCategoryFromField,
  extractSalarySettings,
  createZeroBreakdown,
  resolveBonusPercent,
  getBonusAmount,
  normalizeSubTariffName,
  type SalaryBreakdown,
  type SalaryCategory,
  type PlanBonusPeriodMode,
  type KpiThreshold,
  type KpiSettings,
  isMissingUserMappingColumnError,
} from './helpers';
import { amocrmService } from '../../../services/integrations/amocrm';
import { getTenantAmoCRMContext } from '../../../services/integrations/amocrm-live';
import { getAmoCRMActivityMetrics } from '../../../services/integrations/amocrm-activity';

function calculateProratedFixedSalary(
  monthlyFixedSalary: number,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  if (!monthlyFixedSalary || rangeEnd < rangeStart) {
    return 0;
  }

  const localStart = shiftToReportTimezone(rangeStart);
  const localEnd = shiftToReportTimezone(rangeEnd);

  let year = localStart.getUTCFullYear();
  let month = localStart.getUTCMonth();
  const endYear = localEnd.getUTCFullYear();
  const endMonth = localEnd.getUTCMonth();
  let total = 0;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const daysInMonth = getDaysInReportLocalMonth(year, month);
    const startDay = year === localStart.getUTCFullYear() && month === localStart.getUTCMonth()
      ? localStart.getUTCDate()
      : 1;
    const endDay = year === localEnd.getUTCFullYear() && month === localEnd.getUTCMonth()
      ? localEnd.getUTCDate()
      : daysInMonth;

    total += (monthlyFixedSalary * Math.max(0, endDay - startDay + 1)) / daysInMonth;

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return Math.round(total);
}

function scoreKpi(value: number, threshold: KpiThreshold, higherIsBetter: boolean): number {
  if (threshold.full <= 0 && threshold.half <= 0) return 0;
  if (higherIsBetter) {
    if (value >= threshold.full) return 1;
    if (value >= threshold.half) return 0.5;
    return 0;
  }
  // lower is better (not used currently, but safe)
  if (value <= threshold.full) return 1;
  if (value <= threshold.half) return 0.5;
  return 0;
}

function toLocalDateKey(date: Date): string {
  const shifted = shiftToReportTimezone(date);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const salaryProcedures = {
  salarySummary: protectedProcedure
    .input(
      z.object({
        range: dashboardRangeSchema.default('month').optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        managerUserId: z.string().uuid().optional(),
        prorateFixedSalary: z.boolean().optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
    const now = new Date();
    const hasExplicitRange = Boolean(input);
    const resolvedRange = hasExplicitRange
      ? resolveDateRange(input?.range || 'month', now, input?.dateFrom, input?.dateTo)
      : getCurrentMonthRange(now);
    const rangeStart = 'rangeStart' in resolvedRange ? resolvedRange.rangeStart : resolvedRange.monthStart;
    const rangeEnd = 'rangeEnd' in resolvedRange ? resolvedRange.rangeEnd : resolvedRange.monthEnd;
    const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
    const selectedManagerUserId = scopedManagerUserId || input?.managerUserId;

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
            hasSome: ['Agent', 'TeamLeader'],
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
    const agents = selectedManagerUserId
      ? allAgents.filter((agent) => agent.id === selectedManagerUserId)
      : allAgents;
    const agentIds = agents.map((agent) => agent.id);

    if (!agentIds.length) {
      return {
        monthStart: rangeStart.toISOString(),
        monthEnd: rangeEnd.toISOString(),
        scopedToCurrentAgent: Boolean(scopedManagerUserId),
        bonusMode: salarySettings.bonusMode,
        bonusPercentages: salarySettings.bonusPercentages,
        kpiSettings: salarySettings.kpiSettings.enabled ? {
          monthlyBudget: salarySettings.kpiSettings.monthlyBudget,
          thresholds: salarySettings.kpiSettings.thresholds,
        } : null,
        attendancePenaltySettings: salarySettings.attendancePenaltySettings,
        totals: {
          fixedSalary: 0,
          bonus: 0,
          planBonus: 0,
          kpi: 0,
          attendancePenaltyFixed: 0,
          attendancePenaltyKpi: 0,
          attendancePenalty: 0,
          salaryAfterAttendance: 0,
          salary: 0,
        },
        byAgent: [] as Array<{
          userId: string;
          name: string;
          fixedSalary: number;
          kpiAmount: number;
          bonusAmount: number;
          planBonusAmount: number;
          attendancePenaltyFixed: number;
          attendancePenaltyKpi: number;
          attendancePenaltyTotal: number;
          salaryAfterAttendance: number;
          totalSalary: number;
          bonusBreakdown: SalaryBreakdown;
          kpiBreakdown: {
            conversionRate: { value: number; score: number; amount: number };
            dailyTalkTime: { value: number; score: number; amount: number };
            debtCollectionRate: { value: number; score: number; amount: number };
            followUpCount: { value: number; score: number; amount: number };
          } | null;
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
        attendancePenaltyFixed: number;
        attendancePenaltyKpi: number;
        attendancePenaltyTotal: number;
        salaryAfterAttendance: number;
        bonusBreakdown: SalaryBreakdown;
        kpiBreakdown: {
          conversionRate: { value: number; score: number; amount: number };
          dailyTalkTime: { value: number; score: number; amount: number };
          debtCollectionRate: { value: number; score: number; amount: number };
          followUpCount: { value: number; score: number; amount: number };
        } | null;
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
        fixedSalary: input?.prorateFixedSalary
          ? calculateProratedFixedSalary(salarySettings.fixedSalaries.get(agent.id) ?? 0, rangeStart, rangeEnd)
          : (salarySettings.fixedSalaries.get(agent.id) ?? 0),
        kpiAmount: 0,
        bonusAmount: 0,
        planBonusAmount: 0,
        attendancePenaltyFixed: 0,
        attendancePenaltyKpi: 0,
        attendancePenaltyTotal: 0,
        salaryAfterAttendance: 0,
        bonusBreakdown: createZeroBreakdown(),
        kpiBreakdown: null,
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
            lte: rangeEnd,
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
            lte: rangeEnd,
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
      if (closeDate < rangeStart || closeDate > rangeEnd) {
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
            gte: rangeStart,
            lte: rangeEnd,
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
        if (closeDate < rangeStart || closeDate > rangeEnd) {
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

      const monthStartMs = rangeStart.getTime();
      const monthEndMs = rangeEnd.getTime();
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
          if (hasExplicitRange) {
            if (closeTimestamp < monthStartMs || closeTimestamp > monthEndMs) {
              continue;
            }
          } else if (plan.periodMode === 'monthly' && (closeTimestamp < monthStartMs || closeTimestamp > monthEndMs)) {
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

    // ── KPI Scoring ──
    const kpi = salarySettings.kpiSettings;
    if (kpi.enabled && kpi.monthlyBudget > 0) {
      // Fetch agent -> AmoCRM mapping + extensions
      let agentAmoMappings: Array<{ id: string; amocrmResponsibleUserId: string | null; utelManagerExternalId: string | null }> = [];
      try {
        agentAmoMappings = await prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: agentIds },
            isActive: true,
          },
          select: {
            id: true,
            amocrmResponsibleUserId: true,
            utelManagerExternalId: true,
          },
        }) as Array<{ id: string; amocrmResponsibleUserId: string | null; utelManagerExternalId: string | null }>;
      } catch (error) {
        if (!isMissingUserMappingColumnError(error)) throw error;
      }

      const agentAmoIdMap = new Map<string, string>(); // agentId -> amoId
      const amoIdToAgentId = new Map<string, string>(); // amoId -> agentId
      const agentExtensions = new Map<string, string[]>(); // agentId -> extensions
      for (const mapping of agentAmoMappings) {
        if (mapping.amocrmResponsibleUserId) {
          agentAmoIdMap.set(mapping.id, mapping.amocrmResponsibleUserId);
          amoIdToAgentId.set(mapping.amocrmResponsibleUserId, mapping.id);
        }
        if (mapping.utelManagerExternalId) {
          const ext = mapping.utelManagerExternalId.replace(/[^\d]/g, '');
          if (ext.length >= 2) {
            const existing = agentExtensions.get(mapping.id) || [];
            existing.push(ext);
            agentExtensions.set(mapping.id, existing);
          }
        }
      }

      const amoManagerIds = Array.from(new Set(agentAmoIdMap.values()));
      const allExtensions = Array.from(new Set(Array.from(agentExtensions.values()).flat()));

      // Parallel fetch: new leads, calls, activity, all incomes for debt collection
      const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
      const [newLeads, calls, activityByManager, allIncomes] = await Promise.all([
        amoContext && amoManagerIds.length > 0
          ? amocrmService.fetchAllLeads(
              amoContext.accessToken,
              {
                responsibleUserIds: amoManagerIds,
                createdAtFrom: rangeStart,
                createdAtTo: rangeEnd,
                limit: 250,
                maxPages: 20,
              },
              amoContext.baseUrl,
            )
          : Promise.resolve([]),
        allExtensions.length > 0
          ? prisma.call.findMany({
              where: {
                tenantId: ctx.tenantId,
                provider: 'utel',
                startedAt: { gte: rangeStart, lte: rangeEnd },
                OR: [
                  { from: { in: allExtensions } },
                  { to: { in: allExtensions } },
                ],
              },
              select: {
                from: true,
                to: true,
                duration: true,
                startedAt: true,
              },
            })
          : Promise.resolve([]),
        amoContext && amoManagerIds.length > 0
          ? getAmoCRMActivityMetrics({
              tenantId: ctx.tenantId,
              accessToken: amoContext.accessToken,
              baseUrl: amoContext.baseUrl,
              managerIds: amoManagerIds,
              rangeStart,
              rangeEnd,
              rangeKind: 'custom',
            })
          : Promise.resolve(new Map<string, { followUpCount: number; noteCount: number; stageChangeCount: number; overdueFollowUpCount: number; todayFollowUpCount: number }>()),
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            managerUserId: { in: agentIds },
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: { gte: rangeStart, lte: rangeEnd },
          },
          select: {
            managerUserId: true,
            type: true,
            paymentAmount: true,
            coursePriceAmount: true,
          },
        }),
      ]);

      // Group new leads by AmoCRM manager -> count per agent
      const newLeadCountByAgent = new Map<string, number>();
      for (const lead of newLeads) {
        const amoId = String(lead.responsible_user_id ?? '').trim();
        const agentId = amoIdToAgentId.get(amoId);
        if (agentId) {
          newLeadCountByAgent.set(agentId, (newLeadCountByAgent.get(agentId) || 0) + 1);
        }
      }

      // Group calls by agent -> total duration
      const extensionToAgent = new Map<string, string>();
      for (const [agentId, exts] of agentExtensions.entries()) {
        for (const ext of exts) {
          extensionToAgent.set(ext, agentId);
        }
      }
      const callDurationByAgent = new Map<string, number>();
      const callDaysByAgent = new Map<string, Set<string>>();
      for (const call of calls) {
        const fromExt = (call.from || '').replace(/[^\d]/g, '');
        const toExt = (call.to || '').replace(/[^\d]/g, '');
        const agentId = extensionToAgent.get(fromExt) || extensionToAgent.get(toExt);
        if (!agentId) continue;
        callDurationByAgent.set(agentId, (callDurationByAgent.get(agentId) || 0) + (call.duration || 0));
        if (call.startedAt) {
          const dayKey = call.startedAt.toISOString().slice(0, 10);
          const days = callDaysByAgent.get(agentId) || new Set<string>();
          days.add(dayKey);
          callDaysByAgent.set(agentId, days);
        }
      }

      // Group incomes for debt collection by agent
      const paidByAgent = new Map<string, number>();
      const agreementByAgent = new Map<string, number>();
      const salesCountByAgent = new Map<string, number>();
      for (const inc of allIncomes) {
        const agentId = inc.managerUserId;
        paidByAgent.set(agentId, (paidByAgent.get(agentId) || 0) + (inc.paymentAmount || 0));
        agreementByAgent.set(agentId, (agreementByAgent.get(agentId) || 0) + (inc.coursePriceAmount || 0));
        if (inc.type === 'new_sale') {
          salesCountByAgent.set(agentId, (salesCountByAgent.get(agentId) || 0) + 1);
        }
      }

      // Score each agent
      const perKpiBudget = Math.round(kpi.monthlyBudget / 4);
      for (const salaryRow of salaryByAgent.values()) {
        const agentId = salaryRow.userId;
        const amoId = agentAmoIdMap.get(agentId);

        // 1. Conversion Rate = sales / new leads * 100
        const salesCount = salesCountByAgent.get(agentId) || 0;
        const newLeadCount = newLeadCountByAgent.get(agentId) || 0;
        const conversionRate = newLeadCount > 0 ? (salesCount / newLeadCount) * 100 : 0;
        const conversionScore = scoreKpi(conversionRate, kpi.thresholds.conversionRate, true);

        // 2. Daily Talk Time (seconds) = total duration / active call days
        const totalDuration = callDurationByAgent.get(agentId) || 0;
        const activeDays = (callDaysByAgent.get(agentId) || new Set()).size;
        const dailyTalkTime = activeDays > 0 ? totalDuration / activeDays : 0;
        const talkTimeScore = scoreKpi(dailyTalkTime, kpi.thresholds.dailyTalkTime, true);

        // 3. Debt Collection Rate = paid / agreement * 100
        const totalPaid = paidByAgent.get(agentId) || 0;
        const totalAgreement = agreementByAgent.get(agentId) || 0;
        const debtCollectionRate = totalAgreement > 0 ? (totalPaid / totalAgreement) * 100 : 0;
        const debtScore = scoreKpi(debtCollectionRate, kpi.thresholds.debtCollectionRate, true);

        // 4. Follow-up Count
        const activity = amoId ? activityByManager.get(amoId) : null;
        const followUpCount = activity?.followUpCount ?? 0;
        const followUpScore = scoreKpi(followUpCount, kpi.thresholds.followUpCount, true);

        salaryRow.kpiAmount = Math.round(
          conversionScore * perKpiBudget
          + talkTimeScore * perKpiBudget
          + debtScore * perKpiBudget
          + followUpScore * perKpiBudget,
        );

        salaryRow.kpiBreakdown = {
          conversionRate: { value: Number(conversionRate.toFixed(2)), score: conversionScore, amount: Math.round(conversionScore * perKpiBudget) },
          dailyTalkTime: { value: Math.round(dailyTalkTime), score: talkTimeScore, amount: Math.round(talkTimeScore * perKpiBudget) },
          debtCollectionRate: { value: Number(debtCollectionRate.toFixed(2)), score: debtScore, amount: Math.round(debtScore * perKpiBudget) },
          followUpCount: { value: followUpCount, score: followUpScore, amount: Math.round(followUpScore * perKpiBudget) },
        };
      }
    }

    const attendancePenaltySettings = salarySettings.attendancePenaltySettings;
    const hasAttendancePenalty =
      (attendancePenaltySettings.applyToFixedSalary || attendancePenaltySettings.applyToKpi)
      && (
        attendancePenaltySettings.lateMinutePenaltyUZS > 0
        || attendancePenaltySettings.missingHourPenaltyUZS > 0
        || attendancePenaltySettings.absenceDayPenaltyUZS > 0
      );

    if (hasAttendancePenalty) {
      const dateFrom = toLocalDateKey(rangeStart);
      const dateTo = toLocalDateKey(rangeEnd);
      const summaries = await prisma.attendanceDaySummary.findMany({
        where: {
          tenantId: ctx.tenantId,
          userId: { in: agentIds },
          summaryDate: {
            gte: dateFrom,
            lte: dateTo,
          },
        },
        select: {
          userId: true,
          lateMinutes: true,
          missingSeconds: true,
          absence: true,
        },
      });

      const aggregate = new Map<string, { lateMinutes: number; missingSeconds: number; absenceDays: number }>();
      for (const row of summaries) {
        const existing = aggregate.get(row.userId) ?? { lateMinutes: 0, missingSeconds: 0, absenceDays: 0 };
        existing.lateMinutes += Math.max(0, row.lateMinutes ?? 0);
        existing.missingSeconds += Math.max(0, row.missingSeconds ?? 0);
        existing.absenceDays += row.absence ? 1 : 0;
        aggregate.set(row.userId, existing);
      }

      for (const salaryRow of salaryByAgent.values()) {
        const metrics = aggregate.get(salaryRow.userId) ?? { lateMinutes: 0, missingSeconds: 0, absenceDays: 0 };
        const latePenalty = metrics.lateMinutes * attendancePenaltySettings.lateMinutePenaltyUZS;
        const missingHourPenalty = Math.round((metrics.missingSeconds / 3600) * attendancePenaltySettings.missingHourPenaltyUZS);
        const absencePenalty = metrics.absenceDays * attendancePenaltySettings.absenceDayPenaltyUZS;
        let remainingPenalty = latePenalty + missingHourPenalty + absencePenalty;

        if (attendancePenaltySettings.monthlyPenaltyCapUZS > 0) {
          remainingPenalty = Math.min(remainingPenalty, attendancePenaltySettings.monthlyPenaltyCapUZS);
        }

        let fixedPenalty = 0;
        let kpiPenalty = 0;
        if (attendancePenaltySettings.applyToFixedSalary && remainingPenalty > 0) {
          fixedPenalty = Math.min(salaryRow.fixedSalary, remainingPenalty);
          remainingPenalty -= fixedPenalty;
        }
        if (attendancePenaltySettings.applyToKpi && remainingPenalty > 0) {
          kpiPenalty = Math.min(salaryRow.kpiAmount, remainingPenalty);
          remainingPenalty -= kpiPenalty;
        }

        salaryRow.attendancePenaltyFixed = fixedPenalty;
        salaryRow.attendancePenaltyKpi = kpiPenalty;
        salaryRow.attendancePenaltyTotal = fixedPenalty + kpiPenalty;
      }
    }

    const byAgent = Array.from(salaryByAgent.values())
      .map((row) => ({
        ...row,
        totalSalary: row.fixedSalary + row.kpiAmount + row.bonusAmount + row.planBonusAmount,
        salaryAfterAttendance:
          row.fixedSalary
          + row.kpiAmount
          + row.bonusAmount
          + row.planBonusAmount
          - row.attendancePenaltyTotal,
      }))
      .sort((a, b) => b.salaryAfterAttendance - a.salaryAfterAttendance);

    const totals = byAgent.reduce(
      (acc, row) => ({
        fixedSalary: acc.fixedSalary + row.fixedSalary,
        bonus: acc.bonus + row.bonusAmount,
        planBonus: acc.planBonus + row.planBonusAmount,
        kpi: acc.kpi + row.kpiAmount,
        attendancePenaltyFixed: acc.attendancePenaltyFixed + row.attendancePenaltyFixed,
        attendancePenaltyKpi: acc.attendancePenaltyKpi + row.attendancePenaltyKpi,
        attendancePenalty: acc.attendancePenalty + row.attendancePenaltyTotal,
        salaryAfterAttendance: acc.salaryAfterAttendance + row.salaryAfterAttendance,
        salary: acc.salary + row.totalSalary,
      }),
      {
        fixedSalary: 0,
        bonus: 0,
        planBonus: 0,
        kpi: 0,
        attendancePenaltyFixed: 0,
        attendancePenaltyKpi: 0,
        attendancePenalty: 0,
        salaryAfterAttendance: 0,
        salary: 0,
      },
    );

    return {
      monthStart: rangeStart.toISOString(),
      monthEnd: rangeEnd.toISOString(),
      scopedToCurrentAgent: Boolean(scopedManagerUserId),
      bonusMode: salarySettings.bonusMode,
      bonusPercentages: salarySettings.bonusPercentages,
      attendancePenaltySettings: salarySettings.attendancePenaltySettings,
      kpiSettings: kpi.enabled ? {
        monthlyBudget: kpi.monthlyBudget,
        thresholds: kpi.thresholds,
      } : null,
      totals,
      byAgent,
      currentUser: byAgent.find((row) => row.userId === ctx.user.userId) || null,
    };
    }),

  bonusIncomeDetails: protectedProcedure
    .input(
      z.object({
        range: dashboardRangeSchema.default('month'),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        courseId: z.string().uuid().optional(),
        managerUserId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (isTashkiliyOnly(ctx.user.roles)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Tashkiliy role cannot access bonus income details." });
      }

      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
      const selectedManagerUserId = scopedManagerUserId || input.managerUserId;

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
              hasSome: ['Agent', 'TeamLeader'],
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
      const visibleAgents = selectedManagerUserId
        ? allAgents.filter((agent) => agent.id === selectedManagerUserId)
        : allAgents;
      const visibleAgentIds = visibleAgents.map((agent) => agent.id);

      if (!visibleAgentIds.length) {
        return {
          rangeStart: rangeStart.toISOString(),
          rangeEnd: rangeEnd.toISOString(),
          scopedToCurrentAgent: Boolean(scopedManagerUserId),
          bonusMode: salarySettings.bonusMode,
          agentOptions: [],
          totals: {
            incomeAmount: 0,
            bonusAmount: 0,
            rowCount: 0,
          },
          rows: [] as Array<{
            id: string;
            saleId: string | null;
            entryDate: Date;
            type: string;
            customerNumber: string;
            customerName: string;
            managerUserId: string;
            managerLabel: string;
            courseName: string | null;
            tariffName: string | null;
            agreementAmount: number;
            paymentAmount: number;
            remainingDebtAmount: number;
            calculatedBonus: number;
            isLastPayment: boolean;
          }>,
        };
      }

      const incomes = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          managerUserId: { in: visibleAgentIds },
          ...(input.courseId ? { courseId: input.courseId } : {}),
          entryDate: {
            gte: rangeStart,
            lte: rangeEnd,
          },
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        take: 3000,
        select: {
          id: true,
          type: true,
          entryDate: true,
          createdAt: true,
          paymentAmount: true,
          remainingDebtAmount: true,
          coursePriceAmount: true,
          managerUserId: true,
          relatedDebtIncomeId: true,
          customer: {
            select: {
              customerNumber: true,
              name: true,
            },
          },
          manager: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
          course: {
            select: {
              name: true,
              category: true,
            },
          },
          tariff: {
            select: {
              name: true,
            },
          },
          relatedDebtIncome: {
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
              tariff: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      const saleIds = Array.from(
        new Set(
          incomes
            .map((income) => (income.type === 'new_sale' ? income.id : income.relatedDebtIncomeId))
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const chainRows = saleIds.length > 0
        ? await prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              OR: [
                { id: { in: saleIds } },
                { relatedDebtIncomeId: { in: saleIds } },
              ],
            },
            select: {
              id: true,
              type: true,
              entryDate: true,
              createdAt: true,
              relatedDebtIncomeId: true,
            },
          })
        : [];

      const lastPaymentBySaleId = new Map<string, { id: string; entryDate: Date; createdAt: Date }>();
      for (const row of chainRows) {
        const saleId = row.type === 'new_sale' ? row.id : row.relatedDebtIncomeId;
        if (!saleId) continue;
        const existing = lastPaymentBySaleId.get(saleId);
        if (
          !existing
          || row.entryDate.getTime() > existing.entryDate.getTime()
          || (
            row.entryDate.getTime() === existing.entryDate.getTime()
            && row.createdAt.getTime() > existing.createdAt.getTime()
          )
        ) {
          lastPaymentBySaleId.set(saleId, {
            id: row.id,
            entryDate: row.entryDate,
            createdAt: row.createdAt,
          });
        }
      }

      const [fullyPaidNewSalesForBonus, closingRepaymentsForBonus] = await Promise.all([
        prisma.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'new_sale',
            managerUserId: { in: visibleAgentIds },
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            remainingDebtAmount: 0,
            entryDate: {
              lte: rangeEnd,
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
              managerUserId: { in: visibleAgentIds },
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            },
            entryDate: {
              lte: rangeEnd,
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

      const closeDateBySaleIdForBonus = new Map<string, Date>();
      for (const repayment of closingRepaymentsForBonus) {
        if (!repayment.relatedDebtIncomeId) continue;
        if (!closeDateBySaleIdForBonus.has(repayment.relatedDebtIncomeId)) {
          closeDateBySaleIdForBonus.set(repayment.relatedDebtIncomeId, repayment.entryDate);
        }
      }

      const monthlyClosedCountsByAgent = new Map<string, SalaryBreakdown>();
      for (const sale of fullyPaidNewSalesForBonus) {
        const closeDate = closeDateBySaleIdForBonus.get(sale.id) ?? sale.entryDate;
        if (closeDate < rangeStart || closeDate > rangeEnd) {
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

      const getMonthlyClosedCount = (agentId: string, category: SalaryCategory): number => {
        const byAgent = monthlyClosedCountsByAgent.get(agentId);
        return byAgent?.[category] ?? 0;
      };

      const fullyPaidSaleIds = new Set(fullyPaidNewSalesForBonus.map((sale) => sale.id));
      const saleById = new Map(fullyPaidNewSalesForBonus.map((sale) => [sale.id, sale]));

      const rows = incomes.map((income) => {
        const saleId = income.type === 'new_sale' ? income.id : income.relatedDebtIncomeId;
        const last = saleId ? lastPaymentBySaleId.get(saleId) : undefined;
        const isLastPayment = Boolean(last && last.id === income.id);

        const courseCategory = income.course?.category ?? income.relatedDebtIncome?.course?.category;
        const courseName = income.course?.name ?? income.relatedDebtIncome?.course?.name;
        const category = classifyCourseCategoryFromField(courseCategory || courseName);

        let calculatedBonus = 0;
        if (isLastPayment && category !== 'other') {
          const closedCount = getMonthlyClosedCount(income.managerUserId, category);
          const percentage = resolveBonusPercent(salarySettings.bonusRules[category], closedCount);

          if (salarySettings.bonusMode === 'on_income') {
            calculatedBonus = getBonusAmount(income.paymentAmount ?? 0, percentage);
          } else if (saleId && fullyPaidSaleIds.has(saleId)) {
            const sale = saleById.get(saleId)
              || (income.type === 'new_sale'
                ? {
                    id: income.id,
                    managerUserId: income.managerUserId,
                    coursePriceAmount: income.coursePriceAmount,
                    paymentAmount: income.paymentAmount ?? 0,
                    entryDate: income.entryDate,
                    course: income.course
                      ? {
                          name: income.course.name,
                          category: income.course.category,
                        }
                      : null,
                  }
                : null);
            if (sale) {
              const closeDate = closeDateBySaleIdForBonus.get(saleId) ?? sale.entryDate;
              if (closeDate >= rangeStart && closeDate <= rangeEnd) {
                const agreementAmount = sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
                calculatedBonus = getBonusAmount(agreementAmount, percentage);
              }
            }
          }
        }

        const agreementAmount = income.type === 'new_sale'
          ? (income.coursePriceAmount ?? income.paymentAmount ?? 0)
          : (income.relatedDebtIncome?.coursePriceAmount ?? income.coursePriceAmount ?? income.paymentAmount ?? 0);

        return {
          id: income.id,
          saleId: saleId || null,
          entryDate: income.entryDate,
          type: income.type,
          customerNumber: income.customer.customerNumber,
          customerName: income.customer.name,
          managerUserId: income.managerUserId,
          managerLabel: income.manager.name || income.manager.username || income.manager.id,
          courseName: income.course?.name ?? income.relatedDebtIncome?.course?.name ?? null,
          tariffName: income.tariff?.name ?? income.relatedDebtIncome?.tariff?.name ?? null,
          agreementAmount,
          paymentAmount: income.paymentAmount ?? 0,
          remainingDebtAmount: income.remainingDebtAmount ?? 0,
          calculatedBonus,
          isLastPayment,
        };
      });

      const totals = rows.reduce(
        (acc, row) => {
          acc.incomeAmount += row.paymentAmount;
          acc.bonusAmount += row.calculatedBonus;
          acc.rowCount += 1;
          return acc;
        },
        {
          incomeAmount: 0,
          bonusAmount: 0,
          rowCount: 0,
        },
      );

      return {
        rangeStart: rangeStart.toISOString(),
        rangeEnd: rangeEnd.toISOString(),
        scopedToCurrentAgent: Boolean(scopedManagerUserId),
        bonusMode: salarySettings.bonusMode,
        agentOptions: visibleAgents.map((agent) => ({
          id: agent.id,
          label: agent.name || agent.username || agent.id,
        })),
        totals,
        rows,
      };
    }),
};
