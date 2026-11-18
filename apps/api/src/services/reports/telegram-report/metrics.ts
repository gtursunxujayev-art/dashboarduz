import { type DbClient } from '@dashboarduz/db';

import { roundPositivePercentage } from '../../../lib/number';
import { asObject } from '../../../lib/object';
import { AMOCRM_CALL_PROVIDER, countedCallsWhere } from '../../calls-source';
import { getCorporateCallDurationByManager, getCorporateCallDurationTotal } from '../../corporate-call-durations';
import { buildTechnicalSaleIdSet, excludeTechnicalRows, loadTechnicalSaleIdsForRows } from '../../income-facts';

import { collectReportLeadMetrics, readLeadOutcomeSettings } from './metrics-leads';
import { buildManagerRows, indexReportUsers, tallyManagerCalls } from './metrics-managers';
import { buildSelectedCourseRows, tallyReportIncomes } from './metrics-sales';
import { type ReportMetrics } from './types';

/** The report shows at most this many loss reasons and lead sources. */
const BREAKDOWN_LIMIT = 8;
/** The report lists at most this many picked courses. */
const SELECTED_COURSE_LIMIT = 3;

/** `part` as a rounded percentage of `whole`; 0 when there is no whole. */
function shareOf(part: number, whole: number): number {
  return whole > 0 ? roundPositivePercentage((part / whole) * 100) : 0;
}

/** The largest counts first (ties keep first-seen order), at most BREAKDOWN_LIMIT. */
function topBreakdown(counts: Map<string, number>): Array<{ label: string; value: number }> {
  return Array.from(counts, ([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, BREAKDOWN_LIMIT);
}

function inPeriod(params: { periodStart: Date; periodEnd: Date }): { gte: Date; lte: Date } {
  return { gte: params.periodStart, lte: params.periodEnd };
}

/** Trimmed, distinct, non-empty course ids, at most SELECTED_COURSE_LIMIT. */
function normalizeSelectedCourseIds(courseIds: string[]): string[] {
  return Array.from(new Set(courseIds.map((id) => id.trim()).filter(Boolean))).slice(0, SELECTED_COURSE_LIMIT);
}

/** Loads the period's calls, incomes, users and picked courses (in parallel). */
function loadReportRows(params: { tenantId: string; periodStart: Date; periodEnd: Date; db: DbClient }, selectedCourseIds: string[]) {
  const { db, tenantId } = params;

  return Promise.all([
    db.call.aggregate({
      where: { tenantId, provider: AMOCRM_CALL_PROVIDER, startedAt: inPeriod(params) },
      _count: { id: true },
      _sum: { duration: true },
    }),
    db.income.findMany({
      where: { tenantId, lifecycleStatus: 'active', entryDate: inPeriod(params) },
      select: {
        id: true,
        type: true,
        relatedDebtIncomeId: true,
        entryDate: true,
        managerUserId: true,
        paymentAmount: true,
        coursePriceAmount: true,
        debtAmount: true,
        courseId: true,
        course: { select: { category: true, name: true } },
        tariff: { select: { name: true } },
      },
    }),
    db.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, username: true, roles: true, amocrmResponsibleUserId: true },
    }),
    getCorporateCallDurationTotal({ db, tenantId, rangeStart: params.periodStart, rangeEnd: params.periodEnd }),
    selectedCourseIds.length > 0
      ? db.course.findMany({
          where: { tenantId, id: { in: selectedCourseIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    selectedCourseIds.length > 0
      ? db.income.findMany({
          where: {
            tenantId,
            lifecycleStatus: 'active',
            type: 'new_sale',
            courseId: { in: selectedCourseIds },
            entryDate: inPeriod(params),
          },
          select: {
            id: true,
            type: true,
            coursePriceAmount: true,
            debtAmount: true,
            paymentAmount: true,
            courseId: true,
            tariff: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);
}

export async function collectMetrics(params: {
  tenantId: string;
  tenantSettings: unknown;
  periodStart: Date;
  periodEnd: Date;
  selectedPipelineIds: string[];
  selectedReportCourseIds: string[];
  /** Request code passes ctx.db; the scheduler passes db. */
  db: DbClient;
}): Promise<ReportMetrics> {
  const { db } = params;
  const leadSettings = readLeadOutcomeSettings(params.tenantSettings);
  const selectedCourseIds = normalizeSelectedCourseIds(params.selectedReportCourseIds);
  const [callAggregate, incomesRaw, users, corporateDurationTotal, selectedReportCourses, selectedCourseIncomesRaw] = await loadReportRows(
    params,
    selectedCourseIds,
  );

  // Technical sales (agreement == 1) and their repayments are bookkeeping rows, not real income.
  const technicalSaleIds = await loadTechnicalSaleIdsForRows(params.tenantId, incomesRaw, db);
  const incomes = excludeTechnicalRows(incomesRaw, technicalSaleIds);
  const selectedCourseIncomes = selectedCourseIncomesRaw.filter((sale) => !buildTechnicalSaleIdSet([sale]).has(sale.id));

  const { newLeads, qualifiedLeads, tally } = await collectReportLeadMetrics(params, leadSettings);
  const { totals, managerSalesByUserId } = tallyReportIncomes(incomes);
  const userIds = users.map((user) => user.id);
  const corporateDurationByUserId = await getCorporateCallDurationByManager({
    db,
    tenantId: params.tenantId,
    managerUserIds: userIds,
    rangeStart: params.periodStart,
    rangeEnd: params.periodEnd,
  });
  const managerCalls = await db.call.findMany({
    where: {
      ...countedCallsWhere(params.tenantId, userIds),
      startedAt: inPeriod(params),
    },
    select: { managerUserId: true, duration: true },
  });

  const managerRows = buildManagerRows({
    users: indexReportUsers(users),
    managerLeadsByAmoId: tally.managerLeadsByAmoId,
    managerSalesByUserId,
    calls: tallyManagerCalls(managerCalls),
    corporateDurationByUserId,
  });
  const nonQualifiedLeads = Array.from(tally.reasons.values()).reduce((sum, value) => sum + value, 0);

  return {
    newLeads,
    qualifiedLeads,
    nonQualifiedLeads,
    qualifiedShare: shareOf(qualifiedLeads, newLeads),
    nonQualifiedShare: shareOf(nonQualifiedLeads, newLeads),
    newSalesCount: totals.newSalesCount,
    conversionPercent: shareOf(totals.newSalesCount, newLeads),
    agreementTotal: totals.agreementTotal,
    incomeTotal: totals.incomeTotal,
    newSalesIncomeTotal: totals.newSalesIncomeTotal,
    debtRepaymentIncomeTotal: totals.debtRepaymentIncomeTotal,
    onlineSalesCount: totals.onlineSalesCount,
    onlineAgreementTotal: totals.onlineAgreementTotal,
    offlineSalesCount: totals.offlineSalesCount,
    offlineAgreementTotal: totals.offlineAgreementTotal,
    intensiveSalesCount: totals.intensiveSalesCount,
    intensiveAgreementTotal: totals.intensiveAgreementTotal,
    totalCalls: Number(callAggregate._count.id || 0),
    talkDurationSeconds: Number(callAggregate._sum.duration || 0) + corporateDurationTotal,
    reasonBreakdown: topBreakdown(tally.reasons),
    sourceBreakdown: topBreakdown(tally.sources),
    selectedCourseRows: buildSelectedCourseRows(selectedCourseIds, selectedReportCourses, selectedCourseIncomes),
    managerRows,
  };
}

export async function getSelectedPipelineIdsForTenant(tenantId: string, db: DbClient): Promise<string[]> {
  const amocrmIntegration = await db.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'amocrm',
      },
    },
    select: {
      config: true,
    },
  });
  const selectedPipelineIds = asObject(amocrmIntegration?.config)?.selectedPipelineIds;

  return Array.isArray(selectedPipelineIds) ? selectedPipelineIds.map((value: unknown) => String(value)) : [];
}
