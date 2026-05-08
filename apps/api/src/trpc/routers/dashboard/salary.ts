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
  type KpiMetricKey,
  type KpiSettings,
  KPI_METRIC_KEYS,
  isMissingUserMappingColumnError,
} from './helpers';
import { amocrmService, type AmoCRMLead } from '../../../services/integrations/amocrm';
import { getTenantAmoCRMContext } from '../../../services/integrations/amocrm-live';
import { getAmoCRMActivityMetrics } from '../../../services/integrations/amocrm-activity';
import { buildSaleChainMetricsBySaleId } from '../../../services/income-chain';
import { buildTechnicalSaleIdSet, isRowLinkedToTechnicalSale } from '../../../services/technical-income';

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

type KpiBreakdownEntry = {
  value: number;
  score: number;
  amount: number;
};

function toLocalDateKey(date: Date): string {
  const shifted = shiftToReportTimezone(date);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDateKey(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return {
    year: Number.parseInt(match[1] || '0', 10),
    month: Number.parseInt(match[2] || '0', 10),
    day: Number.parseInt(match[3] || '0', 10),
  };
}

function formatLocalDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDayOfWeekFromLocalDateKey(value: string): number {
  const parsed = parseLocalDateKey(value);
  if (!parsed) {
    return 0;
  }
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

function addOneDayToLocalDateKey(value: string): string {
  const parsed = parseLocalDateKey(value);
  if (!parsed) {
    return value;
  }
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1));
  return formatLocalDateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function buildRequiredWorkdaysByMonth(rangeStart: Date, rangeEnd: Date): Map<string, number> {
  const result = new Map<string, number>();
  let cursor = toLocalDateKey(rangeStart);
  const end = toLocalDateKey(rangeEnd);

  while (cursor <= end) {
    const dayOfWeek = getDayOfWeekFromLocalDateKey(cursor);
    if (dayOfWeek !== 0) {
      const monthKey = cursor.slice(0, 7);
      result.set(monthKey, (result.get(monthKey) || 0) + 1);
    }
    cursor = addOneDayToLocalDateKey(cursor);
  }

  return result;
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
          selectedMetrics: salarySettings.kpiSettings.selectedMetrics,
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
          kpiBreakdown: Record<KpiMetricKey, KpiBreakdownEntry> | null;
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
        kpiBreakdown: Record<KpiMetricKey, KpiBreakdownEntry> | null;
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
    const technicalSaleIdsForSalary = buildTechnicalSaleIdSet(fullyPaidNewSalesForBonus);
    const filteredFullyPaidNewSalesForBonus = fullyPaidNewSalesForBonus.filter((sale) => !technicalSaleIdsForSalary.has(sale.id));

    const closeDateBySaleIdForBonus = new Map<string, Date>();
    for (const repayment of closingRepaymentsForBonus) {
      if (!repayment.relatedDebtIncomeId) {
        continue;
      }
      if (technicalSaleIdsForSalary.has(repayment.relatedDebtIncomeId)) {
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

    for (const sale of filteredFullyPaidNewSalesForBonus) {
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
          id: true,
          type: true,
          relatedDebtIncomeId: true,
          managerUserId: true,
          paymentAmount: true,
          coursePriceAmount: true,
          course: {
            select: {
              name: true,
              category: true,
            },
          },
          relatedDebtIncome: {
            select: {
              id: true,
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
      const filteredIncomes = incomes.filter((income) => !isRowLinkedToTechnicalSale({
        rowType: income.type,
        rowId: income.id,
        relatedDebtIncomeId: income.relatedDebtIncomeId,
        technicalSaleIds: technicalSaleIdsForSalary,
      }));

      for (const income of filteredIncomes) {
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

      for (const sale of filteredFullyPaidNewSalesForBonus) {
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
      const technicalClosedSaleIds = buildTechnicalSaleIdSet(closedSales);
      const filteredClosedSales = closedSales.filter((sale) => !technicalClosedSaleIds.has(sale.id));

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
        if (technicalClosedSaleIds.has(repayment.relatedDebtIncomeId)) {
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

      for (const sale of filteredClosedSales) {
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
      const callCountByAgent = new Map<string, number>();
      const callDaysByAgent = new Map<string, Set<string>>();
      for (const call of calls) {
        const fromExt = (call.from || '').replace(/[^\d]/g, '');
        const toExt = (call.to || '').replace(/[^\d]/g, '');
        const agentId = extensionToAgent.get(fromExt) || extensionToAgent.get(toExt);
        if (!agentId) continue;
        callDurationByAgent.set(agentId, (callDurationByAgent.get(agentId) || 0) + (call.duration || 0));
        callCountByAgent.set(agentId, (callCountByAgent.get(agentId) || 0) + 1);
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
      const selectedKpiMetrics = kpi.selectedMetrics.filter((metric): metric is KpiMetricKey => KPI_METRIC_KEYS.includes(metric));
      const metricCount = selectedKpiMetrics.length;
      if (metricCount === 0) {
        for (const salaryRow of salaryByAgent.values()) {
          salaryRow.kpiAmount = 0;
          salaryRow.kpiBreakdown = null;
        }
      }
      const perKpiBudget = metricCount > 0 ? kpi.monthlyBudget / metricCount : 0;
      for (const salaryRow of salaryByAgent.values()) {
        const agentId = salaryRow.userId;
        const amoId = agentAmoIdMap.get(agentId);

        const salesCount = salesCountByAgent.get(agentId) || 0;
        const newLeadCount = newLeadCountByAgent.get(agentId) || 0;
        const conversionRate = newLeadCount > 0 ? (salesCount / newLeadCount) * 100 : 0;
        const totalDuration = callDurationByAgent.get(agentId) || 0;
        const activeDays = (callDaysByAgent.get(agentId) || new Set()).size;
        const dailyTalkTime = activeDays > 0 ? totalDuration / activeDays : 0;
        const totalPaid = paidByAgent.get(agentId) || 0;
        const totalAgreement = agreementByAgent.get(agentId) || 0;
        const debtCollectionRate = totalAgreement > 0 ? (totalPaid / totalAgreement) * 100 : 0;
        const activity = amoId ? activityByManager.get(amoId) : null;
        const followUpCount = activity?.followUpCount ?? 0;
        const callCount = callCountByAgent.get(agentId) || 0;
        const overdueFollowUpCount = activity?.overdueFollowUpCount ?? 0;
        const stageChangeCount = activity?.stageChangeCount ?? 0;
        const followUpDonePercent = (followUpCount + overdueFollowUpCount) > 0
          ? (followUpCount / (followUpCount + overdueFollowUpCount)) * 100
          : 0;

        const metricValues: Record<KpiMetricKey, number> = {
          conversion: Number(conversionRate.toFixed(2)),
          avgDailyTalkTime: Math.round(dailyTalkTime),
          debtCollectPercent: Number(debtCollectionRate.toFixed(2)),
          avgLeadResponseTime: 0,
          callCount: callCount,
          followUpCount: followUpCount,
          followUpDonePercent: Number(followUpDonePercent.toFixed(2)),
          stageChangeCount: stageChangeCount,
        };

        const kpiBreakdown = {} as Record<KpiMetricKey, KpiBreakdownEntry>;
        let kpiAmount = 0;

        for (const metric of selectedKpiMetrics) {
          const threshold = kpi.thresholds[metric];
          const value = metricValues[metric] ?? 0;
          const higherIsBetter = metric !== 'avgLeadResponseTime';
          const score = scoreKpi(value, threshold, higherIsBetter);
          const amount = Math.round(score * perKpiBudget);
          kpiBreakdown[metric] = {
            value,
            score,
            amount,
          };
          kpiAmount += amount;
        }

        salaryRow.kpiAmount = Math.round(kpiAmount);
        salaryRow.kpiBreakdown = selectedKpiMetrics.length > 0 ? kpiBreakdown : null;
      }
    }

    const attendancePenaltySettings = salarySettings.attendancePenaltySettings;
    const hasAttendancePenalty =
      attendancePenaltySettings.lateMinutePenaltyUZS > 0
      || attendancePenaltySettings.missingHourPenaltyUZS > 0
      || attendancePenaltySettings.absenceDayPenaltyUZS > 0;

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
          summaryDate: true,
          lateMinutes: true,
          missingSeconds: true,
          absence: true,
          firstInAt: true,
        },
      });

      const aggregate = new Map<string, { lateMinutes: number; missingSeconds: number }>();
      const presenceByUserMonth = new Map<string, { weekdayDates: Set<string>; sundayDates: Set<string> }>();
      const requiredWorkdaysByMonth = buildRequiredWorkdaysByMonth(rangeStart, rangeEnd);
      for (const row of summaries) {
        const existing = aggregate.get(row.userId) ?? { lateMinutes: 0, missingSeconds: 0 };
        existing.lateMinutes += Math.max(0, row.lateMinutes ?? 0);
        existing.missingSeconds += Math.max(0, row.missingSeconds ?? 0);
        aggregate.set(row.userId, existing);

        if (row.firstInAt) {
          const monthKey = row.summaryDate.slice(0, 7);
          const key = `${row.userId}|${monthKey}`;
          const monthPresence = presenceByUserMonth.get(key) ?? { weekdayDates: new Set<string>(), sundayDates: new Set<string>() };
          const dayOfWeek = getDayOfWeekFromLocalDateKey(row.summaryDate);
          if (dayOfWeek === 0) {
            monthPresence.sundayDates.add(row.summaryDate);
          } else {
            monthPresence.weekdayDates.add(row.summaryDate);
          }
          presenceByUserMonth.set(key, monthPresence);
        }
      }

      for (const salaryRow of salaryByAgent.values()) {
        const metrics = aggregate.get(salaryRow.userId) ?? { lateMinutes: 0, missingSeconds: 0 };
        const rawLatePenalty = metrics.lateMinutes * attendancePenaltySettings.lateMinutePenaltyUZS;
        const rawMissingHourPenalty = Math.round((metrics.missingSeconds / 3600) * attendancePenaltySettings.missingHourPenaltyUZS);
        const monthlyFixedSalary = salarySettings.fixedSalaries.get(salaryRow.userId) ?? salaryRow.fixedSalary;
        let rawAbsencePenalty = 0;
        if (monthlyFixedSalary > 0 && attendancePenaltySettings.absenceDayPenaltyUZS > 0) {
          for (const [monthKey, requiredWorkdays] of requiredWorkdaysByMonth.entries()) {
            if (requiredWorkdays <= 0) {
              continue;
            }
            const monthPresence = presenceByUserMonth.get(`${salaryRow.userId}|${monthKey}`);
            const weekdayAttended = monthPresence?.weekdayDates.size ?? 0;
            const sundayCredits = monthPresence?.sundayDates.size ?? 0;
            const creditedDays = weekdayAttended + sundayCredits;
            const missingDays = Math.max(requiredWorkdays - creditedDays, 0);
            if (missingDays <= 0) {
              continue;
            }
            const perDayPenalty = Math.round(monthlyFixedSalary / requiredWorkdays);
            rawAbsencePenalty += perDayPenalty * missingDays;
          }
        }

        const cap = attendancePenaltySettings.monthlyPenaltyCapUZS > 0
          ? attendancePenaltySettings.monthlyPenaltyCapUZS
          : Number.MAX_SAFE_INTEGER;
        let remainingCap = cap;
        const cappedLatePenalty = Math.min(rawLatePenalty, remainingCap);
        remainingCap -= cappedLatePenalty;
        const cappedMissingHourPenalty = Math.min(rawMissingHourPenalty, remainingCap);
        remainingCap -= cappedMissingHourPenalty;
        const cappedAbsencePenalty = Math.min(rawAbsencePenalty, remainingCap);

        let fixedPenalty = 0;
        let kpiPenalty = 0;

        const addPenalty = (amount: number, target: 'fixed' | 'kpi') => {
          if (amount <= 0) {
            return;
          }
          if (target === 'fixed') {
            const allowed = Math.max(0, salaryRow.fixedSalary - fixedPenalty);
            fixedPenalty += Math.min(amount, allowed);
            return;
          }
          const allowed = Math.max(0, salaryRow.kpiAmount - kpiPenalty);
          kpiPenalty += Math.min(amount, allowed);
        };

        addPenalty(cappedLatePenalty, attendancePenaltySettings.latePenaltyTarget);
        addPenalty(cappedMissingHourPenalty, attendancePenaltySettings.missingHourPenaltyTarget);
        addPenalty(cappedAbsencePenalty, 'fixed');

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
        selectedMetrics: kpi.selectedMetrics,
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
          summaryTotals: {
            incomeAmount: 0,
            closedAgreementAmount: 0,
            totalBonusAmount: 0,
            bonusByCategory: createZeroBreakdown(),
          },
          agentSummary: [] as Array<{
            managerUserId: string;
            managerLabel: string;
            incomeAmount: number;
            closedAgreementAmount: number;
            totalBonusAmount: number;
            bonusByCategory: SalaryBreakdown;
          }>,
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
            bonusDebug: {
              category: SalaryCategory | 'other';
              closedCount: number;
              appliedPercent: number;
              usedFallback: boolean;
            };
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

      const activeSalesForBonus = await prisma.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          managerUserId: { in: visibleAgentIds },
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          ...(input.courseId ? { courseId: input.courseId } : {}),
          entryDate: {
            lte: rangeEnd,
          },
        },
        select: {
          id: true,
          courseId: true,
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
      });
      const technicalSaleIdsForBonusDetails = buildTechnicalSaleIdSet(activeSalesForBonus);
      const filteredActiveSalesForBonus = activeSalesForBonus.filter((sale) => !technicalSaleIdsForBonusDetails.has(sale.id));

      const saleIdsForBonus = filteredActiveSalesForBonus.map((sale) => sale.id);
      const bonusChainRows = saleIdsForBonus.length > 0
        ? await prisma.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              OR: [
                { id: { in: saleIdsForBonus } },
                { relatedDebtIncomeId: { in: saleIdsForBonus } },
              ],
            },
            select: {
              id: true,
              type: true,
              entryDate: true,
              createdAt: true,
              relatedDebtIncomeId: true,
              paymentAmount: true,
              managerUserId: true,
            },
          })
        : [];

      const chainMetricsBySaleId = buildSaleChainMetricsBySaleId({
        sales: filteredActiveSalesForBonus,
        chainRows: bonusChainRows,
      });

      const agreementAmountBySaleId = new Map<string, number>();
      for (const sale of filteredActiveSalesForBonus) {
        agreementAmountBySaleId.set(
          sale.id,
          sale.coursePriceAmount ?? sale.paymentAmount ?? 0,
        );
      }

      const debtAfterPaymentByRowId = new Map<string, number>();
      const chainRowsBySaleId = new Map<string, typeof bonusChainRows>();
      for (const row of bonusChainRows) {
        const saleId = row.type === 'new_sale' ? row.id : row.relatedDebtIncomeId;
        if (!saleId) {
          continue;
        }
        const existing = chainRowsBySaleId.get(saleId) ?? [];
        existing.push(row);
        chainRowsBySaleId.set(saleId, existing);
      }
      for (const [saleId, chainRows] of chainRowsBySaleId.entries()) {
        const agreementAmount = agreementAmountBySaleId.get(saleId) ?? 0;
        const sorted = [...chainRows].sort((a, b) => {
          const dateDiff = a.entryDate.getTime() - b.entryDate.getTime();
          if (dateDiff !== 0) {
            return dateDiff;
          }
          const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
          if (createdDiff !== 0) {
            return createdDiff;
          }
          return a.id.localeCompare(b.id);
        });
        let runningPaid = 0;
        for (const row of sorted) {
          runningPaid += Number(row.paymentAmount ?? 0);
          const remaining = Math.max(agreementAmount - runningPaid, 0);
          debtAfterPaymentByRowId.set(row.id, remaining);
        }
      }

      const lastPaymentBySaleId = new Map<string, { id: string; entryDate: Date; createdAt: Date }>();
      for (const row of bonusChainRows) {
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

      const closeDateBySaleIdForBonus = new Map<string, Date>();
      for (const sale of filteredActiveSalesForBonus) {
        const metric = chainMetricsBySaleId.get(sale.id);
        if (!metric || metric.currentDebtAmount > 0.0001) {
          continue;
        }
        const lastPayment = lastPaymentBySaleId.get(sale.id);
        closeDateBySaleIdForBonus.set(sale.id, lastPayment?.entryDate ?? sale.entryDate);
      }

      const monthlyClosedCountsByAgent = new Map<string, SalaryBreakdown>();
      for (const sale of filteredActiveSalesForBonus) {
        const closeDate = closeDateBySaleIdForBonus.get(sale.id);
        if (!closeDate || closeDate < rangeStart || closeDate > rangeEnd) {
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

      const fullyPaidSaleIds = new Set(
        filteredActiveSalesForBonus
          .filter((sale) => (chainMetricsBySaleId.get(sale.id)?.currentDebtAmount ?? 0) <= 0.0001)
          .map((sale) => sale.id),
      );
      const saleById = new Map(filteredActiveSalesForBonus.map((sale) => [sale.id, sale]));
      const managerUserIdByChainRowId = new Map<string, string>();
      for (const chainRow of bonusChainRows) {
        managerUserIdByChainRowId.set(chainRow.id, chainRow.managerUserId);
      }
      const managerLabelById = new Map(
        visibleAgents.map((agent) => [agent.id, agent.name || agent.username || agent.id]),
      );

      const rows = incomes
        .filter((income) => !isRowLinkedToTechnicalSale({
          rowType: income.type,
          rowId: income.id,
          relatedDebtIncomeId: income.relatedDebtIncomeId,
          technicalSaleIds: technicalSaleIdsForBonusDetails,
        }))
        .map((income) => {
        const saleId = income.type === 'new_sale' ? income.id : income.relatedDebtIncomeId;
        const last = saleId ? lastPaymentBySaleId.get(saleId) : undefined;
        const isLastPayment = Boolean(last && last.id === income.id);

        const courseCategory = income.course?.category ?? income.relatedDebtIncome?.course?.category;
        const courseName = income.course?.name ?? income.relatedDebtIncome?.course?.name;
        const category = classifyCourseCategoryFromField(courseCategory || courseName);

        let calculatedBonus = 0;
        let appliedPercent = 0;
        let closedCount = 0;
        let usedFallback = false;
        if (isLastPayment && category !== 'other') {
          closedCount = getMonthlyClosedCount(income.managerUserId, category);
          const rule = salarySettings.bonusRules[category];
          appliedPercent = resolveBonusPercent(rule, closedCount);
          const tierMatched = rule.mode === 'tiered'
            && rule.tiers.some((tier) => closedCount >= tier.minSales && (tier.maxSales === null || closedCount <= tier.maxSales));
          usedFallback = rule.mode === 'tiered' && !tierMatched;

          if (salarySettings.bonusMode === 'on_income') {
            calculatedBonus = getBonusAmount(income.paymentAmount ?? 0, appliedPercent);
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
                calculatedBonus = getBonusAmount(agreementAmount, appliedPercent);
              }
            }
          }
        }

        const agreementAmount = income.type === 'new_sale'
          ? (income.coursePriceAmount ?? income.paymentAmount ?? 0)
          : (income.relatedDebtIncome?.coursePriceAmount ?? income.coursePriceAmount ?? income.paymentAmount ?? 0);

        const debtAfterPaymentAmount = debtAfterPaymentByRowId.get(income.id);
        const chainRemainingDebtAmount = debtAfterPaymentAmount ?? (
          saleId
            ? (chainMetricsBySaleId.get(saleId)?.currentDebtAmount ?? Number(income.remainingDebtAmount ?? 0))
            : Number(income.remainingDebtAmount ?? 0)
        );

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
          remainingDebtAmount: chainRemainingDebtAmount,
          calculatedBonus,
          isLastPayment,
          bonusDebug: {
            category,
            closedCount,
            appliedPercent,
            usedFallback,
          },
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

      const agentSummaryMap = new Map<string, {
        managerUserId: string;
        managerLabel: string;
        incomeAmount: number;
        closedAgreementAmount: number;
        totalBonusAmount: number;
        bonusByCategory: SalaryBreakdown;
      }>();

      for (const agent of visibleAgents) {
        agentSummaryMap.set(agent.id, {
          managerUserId: agent.id,
          managerLabel: managerLabelById.get(agent.id) || agent.id,
          incomeAmount: 0,
          closedAgreementAmount: 0,
          totalBonusAmount: 0,
          bonusByCategory: createZeroBreakdown(),
        });
      }

      for (const row of rows) {
        const summary = agentSummaryMap.get(row.managerUserId);
        if (!summary) {
          continue;
        }
        summary.incomeAmount += row.paymentAmount;
        summary.totalBonusAmount += row.calculatedBonus;
        const category = row.bonusDebug?.category;
        if (category && category !== 'other') {
          summary.bonusByCategory[category] += row.calculatedBonus;
        }
      }

      for (const [saleId, closeDate] of closeDateBySaleIdForBonus.entries()) {
        if (closeDate < rangeStart || closeDate > rangeEnd) {
          continue;
        }
        const sale = saleById.get(saleId);
        if (!sale) {
          continue;
        }
        const lastPayment = lastPaymentBySaleId.get(saleId);
        if (!lastPayment) {
          continue;
        }
        const ownerUserId = managerUserIdByChainRowId.get(lastPayment.id) || sale.managerUserId;
        const summary = agentSummaryMap.get(ownerUserId);
        if (!summary) {
          continue;
        }
        const agreementAmount = sale.coursePriceAmount ?? sale.paymentAmount ?? 0;
        summary.closedAgreementAmount += agreementAmount;
      }

      const agentSummary = Array.from(agentSummaryMap.values()).sort((a, b) =>
        a.managerLabel.localeCompare(b.managerLabel),
      );

      const summaryTotals = agentSummary.reduce(
        (acc, row) => {
          acc.incomeAmount += row.incomeAmount;
          acc.closedAgreementAmount += row.closedAgreementAmount;
          acc.totalBonusAmount += row.totalBonusAmount;
          acc.bonusByCategory.online += row.bonusByCategory.online;
          acc.bonusByCategory.offline += row.bonusByCategory.offline;
          acc.bonusByCategory.intensive += row.bonusByCategory.intensive;
          acc.bonusByCategory.additional_service += row.bonusByCategory.additional_service;
          return acc;
        },
        {
          incomeAmount: 0,
          closedAgreementAmount: 0,
          totalBonusAmount: 0,
          bonusByCategory: createZeroBreakdown(),
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
        summaryTotals,
        agentSummary,
        rows,
      };
    }),
};
