import { AGENT_ROLES, dateRangeInput, fromTashkentLocalParts, isTashkiliyOnly, reportRangeSchema, shiftToTashkent, TEAM_LEADER_ROLES } from '@dashboarduz/shared';

import { resolveCallerDataScope } from '../../../lib/access';
import { resolveDateRange } from '../../../lib/dates';
import { buildCacheKey, getOrSet } from '../../../services/cache';
import { filterRowsToScope, resolveManagerFilter } from '../../../services/dashboard/data-scope';
import { buildSaleChainMetricsBySaleId, INCOME_LIFECYCLE_ACTIVE, INCOME_LIFECYCLE_REFUNDED } from '../../../services/income-chain';
import { resolveSaleAgreementAmount } from '../../../services/income-facts';
import { buildTechnicalSaleIdSet, isRowLinkedToTechnicalSale } from '../../../services/technical-income';

import { buildTrend, classifyCourseCategoryFromField, getDaysInReportLocalMonth, getReportLocalDayOfYear, getReportLocalDayOfYearForMonthEnd, getReportLocalDaysInYear, protectedProcedure, REPORT_MONTH_LABELS_UZ, TRPCError, z } from './helpers';

export const financeSummaryProcedures = {
  financeSummary: protectedProcedure
    .input(
      z.object({
        range: reportRangeSchema,
        ...dateRangeInput.shape,
        courseId: z.string().uuid().optional(),
        managerUserId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (isTashkiliyOnly(ctx.user.roles)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Tashkiliy role cannot access finance summary.' });
      }

      const financeCacheKey = buildCacheKey('financeSummary', {
        t: ctx.tenantId,
        u: ctx.user.userId,
        r: input.range,
        df: input.dateFrom,
        dt: input.dateTo,
        c: input.courseId,
        m: input.managerUserId,
      });

      return getOrSet(financeCacheKey, 120, async () => {
      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const scope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
      const agentScoped = scope.scope.kind === 'self';
      // A requested manager must be inside the caller's scope; agents are always limited to themselves.
      const effectiveManagerUserId = agentScoped ? ctx.user.userId : (input.managerUserId || undefined);
      const managerFilter = resolveManagerFilter(scope, effectiveManagerUserId);

      const where = {
        tenantId: ctx.tenantId,
        entryDate: {
          gte: rangeStart,
          lte: rangeEnd,
        },
        ...managerFilter,
        ...(input.courseId
          ? {
              courseId: input.courseId,
            }
          : {}),
      };
      const analyticsBaseWhere = {
        tenantId: ctx.tenantId,
        ...managerFilter,
        ...(input.courseId
          ? {
              courseId: input.courseId,
            }
          : {}),
      };

      const nowLocal = shiftToTashkent(now);
      const currentYear = nowLocal.getUTCFullYear();
      const currentMonth = nowLocal.getUTCMonth();
      const currentDay = nowLocal.getUTCDate();
      const currentHour = nowLocal.getUTCHours();
      const currentMinute = nowLocal.getUTCMinutes();
      const currentSecond = nowLocal.getUTCSeconds();
      const currentMillisecond = nowLocal.getUTCMilliseconds();

      const previousMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;
      const previousMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const previousMonthSameDay = Math.min(currentDay, getDaysInReportLocalMonth(previousMonthYear, previousMonth));
      const lastYearSameMonthDay = Math.min(currentDay, getDaysInReportLocalMonth(currentYear - 1, currentMonth));
      const currentMonthTotalDays = getDaysInReportLocalMonth(currentYear, currentMonth);

      const currentMonthStart = fromTashkentLocalParts(currentYear, currentMonth, 1, 0, 0, 0, 0);
      const previousMonthStart = fromTashkentLocalParts(previousMonthYear, previousMonth, 1, 0, 0, 0, 0);
      const previousMonthSameMoment = fromTashkentLocalParts(
        previousMonthYear,
        previousMonth,
        previousMonthSameDay,
        currentHour,
        currentMinute,
        currentSecond,
        currentMillisecond,
      );
      const lastYearSameMonthStart = fromTashkentLocalParts(currentYear - 1, currentMonth, 1, 0, 0, 0, 0);
      const lastYearSameMonthMoment = fromTashkentLocalParts(
        currentYear - 1,
        currentMonth,
        lastYearSameMonthDay,
        currentHour,
        currentMinute,
        currentSecond,
        currentMillisecond,
      );
      const currentYearStart = fromTashkentLocalParts(currentYear, 0, 1, 0, 0, 0, 0);
      const previousYearStart = fromTashkentLocalParts(currentYear - 1, 0, 1, 0, 0, 0, 0);
      const previousYearYtdMoment = fromTashkentLocalParts(
        currentYear - 1,
        currentMonth,
        lastYearSameMonthDay,
        currentHour,
        currentMinute,
        currentSecond,
        currentMillisecond,
      );

      const technicalSales = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          ...managerFilter,
          ...(input.courseId
            ? {
                courseId: input.courseId,
              }
            : {}),
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

      const [
        incomes,
        courses,
        managers,
        activeIncomeAnalyticsRows,
      ] = await Promise.all([
        ctx.db.income.findMany({
          where,
          // No row limit: every total below is summed from this list. Only recentIncomes is trimmed.
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            type: true,
            lifecycleStatus: true,
            relatedDebtIncomeId: true,
            paymentAmount: true,
            coursePriceAmount: true,
            debtAmount: true,
            remainingDebtAmount: true,
            entryDate: true,
            customerId: true,
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
                id: true,
                name: true,
              },
            },
            tariff: {
              select: {
                name: true,
              },
            },
          },
        }),
        ctx.db.course.findMany({
          where: { tenantId: ctx.tenantId, isActive: true },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            category: true,
          },
        }),
        ctx.db.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            isActive: true,
            roles: {
              hasSome: ['Admin', 'OnlineAdmin', 'Manager', ...TEAM_LEADER_ROLES, ...AGENT_ROLES],
            },
          },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            username: true,
            roles: true,
          },
        }),
        ctx.db.income.findMany({
          where: {
            ...analyticsBaseWhere,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            entryDate: {
              gte: previousYearStart,
              lte: now,
            },
          },
          select: {
            id: true,
            type: true,
            relatedDebtIncomeId: true,
            entryDate: true,
            paymentAmount: true,
          },
        }),
      ]);

      const totals = {
        totalIncomeAmount: 0,
        newSalesCount: 0,
        repaymentCount: 0,
        refundCount: 0,
        refundAmount: 0,
        debtorsCount: 0,
        totalDebtAmount: 0,
      };

      const debtorCustomers = new Set<string>();
      const incomeByCourse = new Map<string, { count: number; amount: number; agreementAmount: number }>();
      const incomeByAgent = new Map<string, { count: number; amount: number }>();
      let currentMonthToDateIncome = 0;
      let previousMonthToDateIncome = 0;
      let lastYearSameMonthToDateIncome = 0;
      let currentYearToDateIncome = 0;
      let previousYearToDateIncome = 0;
      const monthDailyMap = new Map<number, number>();
      const yearMonthlyMap = new Map<number, number>();
      const activeNewSales = (incomes as Array<{
        id: string;
        type: string;
        lifecycleStatus: string;
        entryDate: Date;
        coursePriceAmount: number | null;
        paymentAmount: number;
        debtAmount: number | null;
      }>)
        .filter((income) => (
          income.type === 'new_sale'
          && income.lifecycleStatus === INCOME_LIFECYCLE_ACTIVE
          && !technicalSaleIds.has(income.id)
        ))
        .map((sale) => ({
          id: sale.id,
          entryDate: sale.entryDate,
          coursePriceAmount: sale.coursePriceAmount,
          paymentAmount: sale.paymentAmount,
          debtAmount: sale.debtAmount,
        }));
      const activeSaleChainMetricsBySaleId = activeNewSales.length > 0
        ? buildSaleChainMetricsBySaleId({
            sales: activeNewSales,
            chainRows: await ctx.db.income.findMany({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                OR: [
                  { id: { in: activeNewSales.map((sale) => sale.id) } },
                  { relatedDebtIncomeId: { in: activeNewSales.map((sale) => sale.id) } },
                ],
              },
              select: {
                id: true,
                relatedDebtIncomeId: true,
                paymentAmount: true,
                entryDate: true,
              },
            }),
          })
        : new Map<string, { currentDebtAmount: number }>();

      for (const income of activeIncomeAnalyticsRows as Array<{
        id: string;
        type: string;
        relatedDebtIncomeId: string | null;
        entryDate: Date;
        paymentAmount: number;
      }>) {
        if (isRowLinkedToTechnicalSale({
          rowType: income.type,
          rowId: income.id,
          relatedDebtIncomeId: income.relatedDebtIncomeId,
          technicalSaleIds,
        })) {
          continue;
        }

        const amount = Number(income.paymentAmount || 0);
        const entryTime = income.entryDate.getTime();

        if (entryTime >= currentMonthStart.getTime() && entryTime <= now.getTime()) {
          currentMonthToDateIncome += amount;
          const localDate = shiftToTashkent(income.entryDate);
          const day = localDate.getUTCDate();

          monthDailyMap.set(day, (monthDailyMap.get(day) || 0) + amount);
        }

        if (entryTime >= previousMonthStart.getTime() && entryTime <= previousMonthSameMoment.getTime()) {
          previousMonthToDateIncome += amount;
        }

        if (entryTime >= lastYearSameMonthStart.getTime() && entryTime <= lastYearSameMonthMoment.getTime()) {
          lastYearSameMonthToDateIncome += amount;
        }

        if (entryTime >= currentYearStart.getTime() && entryTime <= now.getTime()) {
          currentYearToDateIncome += amount;
          const localDate = shiftToTashkent(income.entryDate);
          const monthIndex = localDate.getUTCMonth();

          yearMonthlyMap.set(monthIndex, (yearMonthlyMap.get(monthIndex) || 0) + amount);
        }

        if (entryTime >= previousYearStart.getTime() && entryTime <= previousYearYtdMoment.getTime()) {
          previousYearToDateIncome += amount;
        }
      }

      for (const income of incomes as Array<{
        id: string;
        type: string;
        lifecycleStatus: string;
        paymentAmount: number;
        coursePriceAmount: number | null;
        debtAmount: number | null;
        remainingDebtAmount: number;
        entryDate: Date;
        customerId: string;
        customer: { customerNumber: string; name: string };
        manager: { id: string; name: string | null; username: string | null };
        course: { id: string; name: string } | null;
        tariff: { name: string } | null;
      }>) {
        const technicalRow = isRowLinkedToTechnicalSale({
          rowType: income.type,
          rowId: income.id,
          relatedDebtIncomeId: (income as { relatedDebtIncomeId?: string | null }).relatedDebtIncomeId,
          technicalSaleIds,
        });

        if (income.lifecycleStatus === INCOME_LIFECYCLE_REFUNDED) {
          totals.refundCount += 1;
          totals.refundAmount += income.paymentAmount || 0;
        }

        if (income.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE || technicalRow) {
          continue;
        }

        const paymentAmount = income.paymentAmount || 0;

        totals.totalIncomeAmount += paymentAmount;

        const courseName = income.course?.name || 'No course';
        const byCourse = incomeByCourse.get(courseName) || {
          count: 0,
          amount: 0,
          agreementAmount: 0,
        };

        byCourse.count += 1;
        byCourse.amount += paymentAmount;
        if (income.type === 'new_sale') {
          byCourse.agreementAmount += resolveSaleAgreementAmount(income);
        }
        incomeByCourse.set(courseName, byCourse);

        const agentLabel = income.manager.name || income.manager.username || income.manager.id;
        const byAgent = incomeByAgent.get(agentLabel) || {
          count: 0,
          amount: 0,
        };

        byAgent.count += 1;
        byAgent.amount += paymentAmount;
        incomeByAgent.set(agentLabel, byAgent);

        if (income.type === 'new_sale') {
          totals.newSalesCount += 1;
          const chainDebt = activeSaleChainMetricsBySaleId.get(income.id)?.currentDebtAmount ?? income.remainingDebtAmount;

          if (chainDebt > 0) {
            debtorCustomers.add(income.customerId);
            totals.totalDebtAmount += chainDebt;
          }
        } else if (income.type === 'repayment') {
          totals.repaymentCount += 1;
        }
      }

      totals.debtorsCount = debtorCustomers.size;
      const monthTrend = buildTrend(currentMonthToDateIncome, previousMonthToDateIncome);
      const monthVsLastYearTrend = buildTrend(currentMonthToDateIncome, lastYearSameMonthToDateIncome);
      const ytdTrend = buildTrend(currentYearToDateIncome, previousYearToDateIncome);

      let monthCumulativeActual = 0;
      const monthElapsedDays = Math.max(1, currentDay);
      const monthRunRatePerDay = currentMonthToDateIncome > 0 ? currentMonthToDateIncome / monthElapsedDays : 0;
      const monthForecastSeries: Array<{ label: string; actual: number | null; forecast: number }> = [];

      for (let day = 1; day <= currentMonthTotalDays; day += 1) {
        monthCumulativeActual += monthDailyMap.get(day) || 0;
        monthForecastSeries.push({
          label: String(day),
          actual: day <= currentDay ? Math.round(monthCumulativeActual) : null,
          forecast: Math.round(monthRunRatePerDay * day),
        });
      }

      const monthProjectedTotal = Math.round(monthRunRatePerDay * currentMonthTotalDays);
      const monthRemainingAmount = Math.max(0, monthProjectedTotal - Math.round(currentMonthToDateIncome));
      const monthProgressPercent = monthProjectedTotal > 0
        ? Number(((currentMonthToDateIncome / monthProjectedTotal) * 100).toFixed(2))
        : 0;

      const yearElapsedDays = Math.max(1, getReportLocalDayOfYear(now));
      const yearTotalDays = getReportLocalDaysInYear(currentYear);
      const yearRunRatePerDay = currentYearToDateIncome > 0 ? currentYearToDateIncome / yearElapsedDays : 0;
      let yearCumulativeActual = 0;
      const yearForecastSeries: Array<{ label: string; actual: number | null; forecast: number }> = [];

      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        yearCumulativeActual += yearMonthlyMap.get(monthIndex) || 0;
        yearForecastSeries.push({
          label: REPORT_MONTH_LABELS_UZ[monthIndex] || String(monthIndex + 1),
          actual: monthIndex <= currentMonth ? Math.round(yearCumulativeActual) : null,
          forecast: Math.round(yearRunRatePerDay * getReportLocalDayOfYearForMonthEnd(currentYear, monthIndex)),
        });
      }

      const yearProjectedTotal = Math.round(yearRunRatePerDay * yearTotalDays);
      const yearRemainingAmount = Math.max(0, yearProjectedTotal - Math.round(currentYearToDateIncome));
      const yearProgressPercent = yearProjectedTotal > 0
        ? Number(((currentYearToDateIncome / yearProjectedTotal) * 100).toFixed(2))
        : 0;

      const managerOptions = (managers as Array<{ id: string; name: string | null; username: string | null; roles: string[] }>)
        .map((manager) => ({
          id: manager.id,
          label: manager.name || manager.username || manager.id,
          roles: manager.roles,
        }));
      const visibleManagerOptions = filterRowsToScope(scope, managerOptions, (manager) => manager.id);

      return {
        range: input.range,
        dateFrom: input.range === 'custom' ? input.dateFrom || null : null,
        dateTo: input.range === 'custom' ? input.dateTo || null : null,
        filters: {
          courseId: input.courseId || null,
          managerUserId: effectiveManagerUserId || null,
          agentScoped,
        },
        comparisons: {
          monthToDateVsLastMonthToDate: {
            ...monthTrend,
            currentStart: currentMonthStart.toISOString(),
            currentEnd: now.toISOString(),
            previousStart: previousMonthStart.toISOString(),
            previousEnd: previousMonthSameMoment.toISOString(),
          },
          monthToDateVsLastYearSameMonth: {
            ...monthVsLastYearTrend,
            currentStart: currentMonthStart.toISOString(),
            currentEnd: now.toISOString(),
            previousStart: lastYearSameMonthStart.toISOString(),
            previousEnd: lastYearSameMonthMoment.toISOString(),
          },
          ytdVsLastYearYtd: {
            ...ytdTrend,
            currentStart: currentYearStart.toISOString(),
            currentEnd: now.toISOString(),
            previousStart: previousYearStart.toISOString(),
            previousEnd: previousYearYtdMoment.toISOString(),
          },
        },
        forecast: {
          monthEnd: {
            currentToDate: Math.round(currentMonthToDateIncome),
            projectedTotal: monthProjectedTotal,
            remainingAmount: monthRemainingAmount,
            progressPercent: monthProgressPercent,
            runRatePerDay: Number(monthRunRatePerDay.toFixed(2)),
            periodStart: currentMonthStart.toISOString(),
            periodEnd: fromTashkentLocalParts(currentYear, currentMonth, currentMonthTotalDays, 23, 59, 59, 999).toISOString(),
          },
          yearEnd: {
            currentToDate: Math.round(currentYearToDateIncome),
            projectedTotal: yearProjectedTotal,
            remainingAmount: yearRemainingAmount,
            progressPercent: yearProgressPercent,
            runRatePerDay: Number(yearRunRatePerDay.toFixed(2)),
            periodStart: currentYearStart.toISOString(),
            periodEnd: fromTashkentLocalParts(currentYear, 11, 31, 23, 59, 59, 999).toISOString(),
          },
          monthSeries: monthForecastSeries,
          yearSeries: yearForecastSeries,
        },
        totals,
        incomeByCourse: Array.from(incomeByCourse.entries())
          .map(([courseName, value]) => ({
            courseName,
            count: value.count,
            amount: value.amount,
            agreementAmount: value.agreementAmount,
          }))
          .sort((a, b) => b.amount - a.amount),
        incomeByAgent: Array.from(incomeByAgent.entries())
          .map(([agent, value]) => ({
            agent,
            count: value.count,
            amount: value.amount,
          }))
          .sort((a, b) => b.amount - a.amount),
        courseOptions: (courses as Array<{ id: string; name: string; category: string }>).map((course) => ({
          ...course,
          category: classifyCourseCategoryFromField(course.category || course.name),
        })),
        managerOptions: visibleManagerOptions,
        recentIncomes: (incomes as Array<{
          id: string;
          type: string;
          lifecycleStatus: string;
          paymentAmount: number;
          coursePriceAmount: number | null;
          remainingDebtAmount: number;
          relatedDebtIncomeId?: string | null;
          entryDate: Date;
          customer: { customerNumber: string; name: string };
          manager: { id: string; name: string | null; username: string | null };
          course: { id: string; name: string } | null;
          tariff: { name: string } | null;
        }>)
          .filter((income) => !isRowLinkedToTechnicalSale({
            rowType: income.type,
            rowId: income.id,
            relatedDebtIncomeId: income.relatedDebtIncomeId,
            technicalSaleIds,
          }))
          .slice(0, 300)
          .map((income) => ({
          id: income.id,
          type: income.type,
          lifecycleStatus: income.lifecycleStatus,
          paymentAmount: income.paymentAmount,
          coursePriceAmount: income.coursePriceAmount,
          remainingDebtAmount: income.remainingDebtAmount,
          entryDate: income.entryDate,
          customerNumber: income.customer.customerNumber,
          customerName: income.customer.name,
          managerLabel: income.manager.name || income.manager.username || income.manager.id,
          courseName: income.course?.name || null,
          tariffName: income.tariff?.name || null,
        })),
        updatedAt: now.toISOString(),
      };
      }); // end getOrSet
    }),
};
