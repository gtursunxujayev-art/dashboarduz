import type { DbClient } from '@dashboarduz/db';
import { dateRangeInput, isAgentOnly, isTashkiliyOnly, reportRangeSchema, type UserRole } from '@dashboarduz/shared';
import { z } from 'zod';

import { resolveDateRange } from '../../lib/dates';
import { classifyCourseCategoryFromField, createZeroBreakdown, type SalaryBreakdown, type SalaryCategory, TRPCError } from '../../trpc/routers/dashboard/helpers';
import { buildBonusDetailIncomeWhere, isBonusDetailExportOverLimit } from '../bonus-detail-export';
import { calculateBonusRange, loadSaleClosures, resolveEffectiveBonusPolicy } from '../bonus-engine';
import { buildSaleChainMetricsBySaleId, INCOME_LIFECYCLE_ACTIVE } from '../income-chain';
import { resolveSaleAgreementAmount } from '../income-facts';
import { buildTechnicalSaleIdSet, isRowLinkedToTechnicalSale } from '../technical-income';

import { extractBonusDetailSubTariffId } from './salary-helpers';
import { loadSalarySettingsAndAgents } from './salary-settings';

export const bonusIncomeDetailsInputSchema = z.object({
  range: reportRangeSchema.default('month'),
  ...dateRangeInput.shape,
  courseId: z.string().uuid().optional(),
  managerUserId: z.string().uuid().optional(),
});

type BonusIncomeDetailsInput = z.infer<typeof bonusIncomeDetailsInputSchema>;

type BonusIncomeDetailsContext = {
  tenantId: string;
  db: DbClient;
  user: {
    userId: string;
    roles: UserRole[];
  };
};

type BonusIncomeDetailsOptions = {
  rowLimit?: number;
  rejectAboveLimit?: number;
};

export async function loadBonusIncomeDetails({
  ctx,
  input,
  options = {},
}: {
  ctx: BonusIncomeDetailsContext;
  input: BonusIncomeDetailsInput;
  options?: BonusIncomeDetailsOptions;
}) {
      if (isTashkiliyOnly(ctx.user.roles)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: "Tashkiliy role cannot access bonus income details." });
      }

      const now = new Date();
      const { rangeStart, rangeEnd } = resolveDateRange(input.range, now, input.dateFrom, input.dateTo);
      const scopedManagerUserId = isAgentOnly(ctx.user.roles) ? ctx.user.userId : undefined;
      const selectedManagerUserId = scopedManagerUserId || input.managerUserId;

      const { allAgents } = await loadSalarySettingsAndAgents(ctx.db, ctx.tenantId);
      // Label with the bonus policy that applies to the viewed period, not whatever was saved last.
      const viewedBonusMode = (await resolveEffectiveBonusPolicy(ctx.tenantId, rangeEnd, ctx.db)).policy.bonusMode;
      const visibleAgents = selectedManagerUserId
        ? allAgents.filter((agent) => agent.id === selectedManagerUserId)
        : allAgents;
      const visibleAgentIds = visibleAgents.map((agent) => agent.id);

      if (!visibleAgentIds.length) {
        return {
          rangeStart: rangeStart.toISOString(),
          rangeEnd: rangeEnd.toISOString(),
          scopedToCurrentAgent: Boolean(scopedManagerUserId),
          bonusMode: viewedBonusMode,
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
            subTariffName: string | null;
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

      // All sales, not only the visible agents' own: a visible agent may record the closing payment on a colleague's sale.
      const activeSalesForBonus = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          ...(input.courseId ? { courseId: input.courseId } : {}),
          entryDate: {
            lte: rangeEnd,
          },
        },
        select: {
          id: true,
          // buildTechnicalSaleIdSet only flags rows whose type is 'new_sale'; without it no technical sale is found.
          type: true,
          courseId: true,
          managerUserId: true,
          coursePriceAmount: true,
          debtAmount: true,
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

      const incomeWhere = buildBonusDetailIncomeWhere({
        tenantId: ctx.tenantId,
        managerUserIds: visibleAgentIds,
        rangeStart,
        rangeEnd,
        courseId: input.courseId,
        technicalSaleIds: Array.from(technicalSaleIdsForBonusDetails),
      });

      if (options.rejectAboveLimit) {
        const totalCount = await ctx.db.income.count({ where: incomeWhere });

        if (isBonusDetailExportOverLimit(totalCount, options.rejectAboveLimit)) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: "Tanlangan filtr bo'yicha yozuvlar juda ko'p. Iltimos, qisqaroq davr tanlang.",
          });
        }
      }

      const incomes = await ctx.db.income.findMany({
        where: incomeWhere,
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        take: options.rowLimit,
        select: {
          id: true,
          type: true,
          entryDate: true,
          createdAt: true,
          paymentAmount: true,
          remainingDebtAmount: true,
          coursePriceAmount: true,
          debtAmount: true,
          managerUserId: true,
          relatedDebtIncomeId: true,
          legacyImportMeta: true,
          customer: {
            select: {
              customerNumber: true,
              name: true,
              profileSubTariffId: true,
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
              debtAmount: true,
              paymentAmount: true,
              entryDate: true,
              legacyImportMeta: true,
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

      const subTariffIds = Array.from(new Set(
        incomes
          .map((income) => (
            extractBonusDetailSubTariffId(income.legacyImportMeta)
            || extractBonusDetailSubTariffId(income.relatedDebtIncome?.legacyImportMeta)
            || income.customer.profileSubTariffId
            || null
          ))
          .filter((id): id is string => Boolean(id)),
      ));
      const subTariffs = subTariffIds.length > 0
        ? await ctx.db.subTariff.findMany({
            where: {
              tenantId: ctx.tenantId,
              id: { in: subTariffIds },
            },
            select: { id: true, name: true },
          })
        : [];
      const subTariffNameById = new Map(subTariffs.map((subTariff) => [subTariff.id, subTariff.name]));

      const saleIdsForBonus = filteredActiveSalesForBonus.map((sale) => sale.id);
      const bonusChainRows = saleIdsForBonus.length > 0
        ? await ctx.db.income.findMany({
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
        agreementAmountBySaleId.set(sale.id, resolveSaleAgreementAmount(sale));
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

      // Closures come from the bonus engine so "closed" means exactly what it means for the bonus itself.
      const closuresInRange = (await loadSaleClosures({ tenantId: ctx.tenantId, rangeEnd, db: ctx.db }))
        .filter((closure) => closure.closedAt >= rangeStart && (!input.courseId || closure.courseId === input.courseId));
      const closingIncomeIds = new Set(closuresInRange.map((closure) => closure.closingIncomeId));
      const managerLabelById = new Map(
        visibleAgents.map((agent) => [agent.id, agent.name || agent.username || agent.id]),
      );

      const centralizedBonus = await calculateBonusRange({ tenantId: ctx.tenantId, rangeStart, rangeEnd, db: ctx.db });
      const bonusItemByIncomeId = new Map(
        centralizedBonus.items
          .filter((item) => visibleAgentIds.includes(item.agentUserId))
          .filter((item) => !input.courseId || item.courseId === input.courseId)
          .map((item) => [item.sourceIncomeId, item]),
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
        const isLastPayment = closingIncomeIds.has(income.id);

        const courseCategory = income.course?.category ?? income.relatedDebtIncome?.course?.category;
        const courseName = income.course?.name ?? income.relatedDebtIncome?.course?.name;
        const category = classifyCourseCategoryFromField(courseCategory || courseName);
        const subTariffId = extractBonusDetailSubTariffId(income.legacyImportMeta)
          || extractBonusDetailSubTariffId(income.relatedDebtIncome?.legacyImportMeta)
          || income.customer.profileSubTariffId
          || null;

        const bonusItem = bonusItemByIncomeId.get(income.id);
        const calculatedBonus = bonusItem?.bonusAmount || 0;
        const appliedPercent = bonusItem?.appliedPercent || 0;
        const closedCount = bonusItem?.closedCount || 0;
        const usedFallback = bonusItem?.usedFallback || false;

        const agreementAmount = (saleId ? agreementAmountBySaleId.get(saleId) : undefined)
          ?? resolveSaleAgreementAmount(income.type === 'new_sale' ? income : (income.relatedDebtIncome ?? income));

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
          subTariffName: subTariffId ? subTariffNameById.get(subTariffId) || null : null,
          agreementAmount,
          paymentAmount: income.paymentAmount ?? 0,
          remainingDebtAmount: chainRemainingDebtAmount,
          calculatedBonus,
          isLastPayment,
          bonusDebug: {
            category: bonusItem?.category || category,
            closedCount,
            appliedPercent,
            usedFallback,
            calculationMode: bonusItem?.calculationMode || null,
            finalized: centralizedBonus.months.some((month) => month.finalized),
          },
        };
      });

      // Totals are computed over the whole range, never from `rows`, which is capped for display.
      const incomeByManager = await ctx.db.income.groupBy({
        by: ['managerUserId'],
        where: incomeWhere,
        _sum: { paymentAmount: true },
        _count: { _all: true },
      });
      const visibleBonusItems = [...bonusItemByIncomeId.values()];
      const totals = {
        incomeAmount: incomeByManager.reduce((sum, group) => sum + Number(group._sum.paymentAmount || 0), 0),
        bonusAmount: visibleBonusItems.reduce((sum, item) => sum + item.bonusAmount, 0),
        rowCount: incomeByManager.reduce((sum, group) => sum + group._count._all, 0),
      };

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

      for (const group of incomeByManager) {
        const summary = agentSummaryMap.get(group.managerUserId);

        if (summary) summary.incomeAmount += Number(group._sum.paymentAmount || 0);
      }
      for (const item of visibleBonusItems) {
        const summary = agentSummaryMap.get(item.agentUserId);

        if (!summary) continue;
        summary.totalBonusAmount += item.bonusAmount;
        summary.bonusByCategory[item.category] += item.bonusAmount;
      }

      for (const closure of closuresInRange) {
        const summary = agentSummaryMap.get(closure.closerUserId);

        if (summary) summary.closedAgreementAmount += closure.agreementAmount;
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
        bonusMode: viewedBonusMode,
        agentOptions: visibleAgents.map((agent) => ({
          id: agent.id,
          label: agent.name || agent.username || agent.id,
        })),
        totals,
        summaryTotals,
        agentSummary,
        rows,
      };
}
