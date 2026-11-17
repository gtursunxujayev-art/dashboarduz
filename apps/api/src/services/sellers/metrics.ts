import type { DbClient } from '@dashboarduz/db';
import { type sellerRangeSchema } from '@dashboarduz/shared';
import type { z } from 'zod';

import { classifyIncomeCategory, isRowLinkedToTechnicalSale, loadTechnicalSaleIdsForRows, resolveSaleAgreementAmount } from '../income-facts';
import type { AmoCRMLead, AmoCRMUser } from '../integrations/amocrm';
import type { AmoCRMActivityMetrics } from '../integrations/amocrm-activity';

export const WON_STATUS_ID = '142';

export const LOST_STATUS_ID = '143';

export type SellerRange = z.infer<typeof sellerRangeSchema>;

export type SellerIncomeMetricSource = {
  type: string | null;
  paymentAmount: number | null;
  coursePriceAmount: number | null;
  debtAmount?: number | null;
  course: {
    category?: string | null;
    name?: string | null;
  } | null;
};

export type SellerSalesMetrics = {
  newSalesCount: number;
  newSalesAgreementAmount: number;
  incomeAmount: number;
  averageSalesCount: number;
  averageAgreementAmount: number;
  onlineSalesCount: number;
  onlineSalesAgreementAmount: number;
  onlineSalesIncomeAmount: number;
  offlineSalesCount: number;
  offlineSalesAgreementAmount: number;
  offlineSalesIncomeAmount: number;
  intensiveSalesCount: number;
  intensiveSalesAgreementAmount: number;
  intensiveSalesIncomeAmount: number;
  totalPaidAmount: number;
  totalAgreementAmount: number;
  debtCollectionRate: number;
};

export function asString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();

  return normalized.length > 0 ? normalized : null;
}

export function parseAmoDate(value: unknown): Date {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;

    return new Date(millis);
  }

  if (typeof value === 'string') {
    const asNumber = Number(value);

    if (!Number.isNaN(asNumber)) {
      return parseAmoDate(asNumber);
    }
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(0);
}

function getDealAmount(lead: AmoCRMLead): number {
  const maybePrice = (lead as Record<string, unknown>).price;

  if (typeof maybePrice === 'number' && Number.isFinite(maybePrice)) {
    return maybePrice;
  }
  if (typeof maybePrice === 'string') {
    const parsed = Number(maybePrice);

    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
}

export function getLeadResponsibleId(lead: AmoCRMLead): string | null {
  return asString(lead.responsible_user_id);
}

function resolveSellerIncomeCategory(source: SellerIncomeMetricSource): 'online' | 'offline' | 'intensive' | null {
  const category = classifyIncomeCategory(source.course);

  return category === 'online' || category === 'offline' || category === 'intensive' ? category : null;
}

export async function excludeTechnicalSellerIncomes<T extends { id?: string; type: string | null; relatedDebtIncomeId?: string | null }>(
  tenantId: string,
  rows: T[],
  db: DbClient,
): Promise<T[]> {
  const refs = rows
    .filter((row): row is T & { id: string } => Boolean(row.id))
    .map((row) => ({ ...row, type: row.type || '' }));
  const technicalSaleIds = await loadTechnicalSaleIdsForRows(tenantId, refs, db);

  if (!technicalSaleIds.size) return rows;

  return rows.filter((row) => !row.id || !isRowLinkedToTechnicalSale({
    rowType: row.type || '',
    rowId: row.id,
    relatedDebtIncomeId: row.relatedDebtIncomeId,
    technicalSaleIds,
  }));
}

function getInclusiveRangeDayCount(rangeStart: Date, rangeEnd: Date): number {
  const millis = rangeEnd.getTime() - rangeStart.getTime();

  if (millis <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(millis / (24 * 60 * 60 * 1000)));
}

export function summarizeSellerIncomeMetrics(
  incomes: SellerIncomeMetricSource[],
  rangeStart: Date,
  rangeEnd: Date,
): SellerSalesMetrics {
  let newSalesCount = 0;
  let newSalesAgreementAmount = 0;
  let incomeAmount = 0;

  let onlineSalesCount = 0;
  let onlineSalesAgreementAmount = 0;
  let onlineSalesIncomeAmount = 0;
  let offlineSalesCount = 0;
  let offlineSalesAgreementAmount = 0;
  let offlineSalesIncomeAmount = 0;
  let intensiveSalesCount = 0;
  let intensiveSalesAgreementAmount = 0;
  let intensiveSalesIncomeAmount = 0;
  let totalPaidAmount = 0;
  let totalAgreementAmount = 0;

  for (const income of incomes) {
    const paymentAmount = Number(income.paymentAmount || 0);
    // Only sales carry an agreement; repayments add income but no new agreement.
    const agreementAmount = income.type === 'new_sale' ? resolveSaleAgreementAmount(income) : 0;
    const category = resolveSellerIncomeCategory(income);

    incomeAmount += paymentAmount;
    totalPaidAmount += paymentAmount;
    totalAgreementAmount += agreementAmount;

    if (income.type === 'new_sale') {
      newSalesCount += 1;
      newSalesAgreementAmount += agreementAmount;
      if (category === 'online') {
        onlineSalesCount += 1;
        onlineSalesAgreementAmount += agreementAmount;
      } else if (category === 'offline') {
        offlineSalesCount += 1;
        offlineSalesAgreementAmount += agreementAmount;
      } else if (category === 'intensive') {
        intensiveSalesCount += 1;
        intensiveSalesAgreementAmount += agreementAmount;
      }
    }

    if (category === 'online') {
      onlineSalesIncomeAmount += paymentAmount;
    } else if (category === 'offline') {
      offlineSalesIncomeAmount += paymentAmount;
    } else if (category === 'intensive') {
      intensiveSalesIncomeAmount += paymentAmount;
    }
  }

  const rangeDayCount = getInclusiveRangeDayCount(rangeStart, rangeEnd);
  const averageSalesCount = newSalesCount > 0 ? newSalesCount / rangeDayCount : 0;
  const averageAgreementAmount = newSalesCount > 0 ? newSalesAgreementAmount / newSalesCount : 0;

  return {
    newSalesCount,
    newSalesAgreementAmount: Number(newSalesAgreementAmount.toFixed(2)),
    incomeAmount: Number(incomeAmount.toFixed(2)),
    averageSalesCount: Number(averageSalesCount.toFixed(2)),
    averageAgreementAmount: Number(averageAgreementAmount.toFixed(2)),
    onlineSalesCount,
    onlineSalesAgreementAmount: Number(onlineSalesAgreementAmount.toFixed(2)),
    onlineSalesIncomeAmount: Number(onlineSalesIncomeAmount.toFixed(2)),
    offlineSalesCount,
    offlineSalesAgreementAmount: Number(offlineSalesAgreementAmount.toFixed(2)),
    offlineSalesIncomeAmount: Number(offlineSalesIncomeAmount.toFixed(2)),
    intensiveSalesCount,
    intensiveSalesAgreementAmount: Number(intensiveSalesAgreementAmount.toFixed(2)),
    intensiveSalesIncomeAmount: Number(intensiveSalesIncomeAmount.toFixed(2)),
    totalPaidAmount: Number(totalPaidAmount.toFixed(2)),
    totalAgreementAmount: Number(totalAgreementAmount.toFixed(2)),
    debtCollectionRate: totalAgreementAmount > 0
      ? Number(((totalPaidAmount / totalAgreementAmount) * 100).toFixed(2))
      : 0,
  };
}

export function toManagerRole(user: AmoCRMUser): string[] {
  return user.rights?.is_admin ? ['Manager'] : ['Agent'];
}

export function buildMetrics(
  activeLeads: AmoCRMLead[],
  wonLeadsData: AmoCRMLead[],
  lostLeadsData: AmoCRMLead[],
  calls: Array<{ duration: number | null; direction: string; status: string; startedAt?: Date | null }>,
  options?: {
    incomeAmountOverride?: number | null;
    neutralizeLeadOutcomes?: boolean;
    activityMetrics?: AmoCRMActivityMetrics | null;
    manualDurationSeconds?: number;
  },
) {
  const activeLeadsCount = activeLeads.length;
  const neutralizeLeadOutcomes = Boolean(options?.neutralizeLeadOutcomes);
  const wonLeads = neutralizeLeadOutcomes ? 0 : wonLeadsData.length;
  const lostLeads = neutralizeLeadOutcomes ? 0 : lostLeadsData.length;
  const totalLeads = neutralizeLeadOutcomes ? activeLeadsCount : (activeLeadsCount + wonLeads + lostLeads);
  const conversionRate = neutralizeLeadOutcomes ? 0 : (totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0);

  const totalDealAmount = neutralizeLeadOutcomes
    ? 0
    : wonLeadsData.reduce((sum, lead) => sum + getDealAmount(lead), 0);
  const averageDealAmount = neutralizeLeadOutcomes ? 0 : (wonLeads > 0 ? totalDealAmount / wonLeads : 0);

  const totalCalls = calls.length;
  const inboundCalls = calls.filter((call) => call.direction === 'inbound').length;
  const outboundCalls = calls.filter((call) => call.direction === 'outbound').length;
  const missedCalls = calls.filter((call) => call.status === 'missed').length;
  const missedCallRate = totalCalls > 0 ? (missedCalls / totalCalls) * 100 : 0;
  const manualDurationSeconds = Math.max(0, Number(options?.manualDurationSeconds || 0));
  const totalCallDuration = calls.reduce((sum, call) => sum + (call.duration || 0), 0) + manualDurationSeconds;
  const averageCallDuration = totalCalls > 0 ? totalCallDuration / totalCalls : 0;
  const activeCallDays = new Set(
    calls
      .map((call) => (call.startedAt instanceof Date ? call.startedAt : null))
      .filter((value): value is Date => Boolean(value))
      .map((value) => value.toISOString().slice(0, 10)),
  ).size;
  const averageDailyCalls = activeCallDays > 0 ? totalCalls / activeCallDays : 0;
  const averageDailyCallDuration = activeCallDays > 0 ? totalCallDuration / activeCallDays : 0;
  const incomeAmount = typeof options?.incomeAmountOverride === 'number' ? options.incomeAmountOverride : totalDealAmount;
  const activityMetrics = options?.activityMetrics || {
    followUpCount: 0,
    noteCount: 0,
    stageChangeCount: 0,
    overdueFollowUpCount: 0,
    todayFollowUpCount: 0,
  };

  return {
    newLeads: neutralizeLeadOutcomes ? activeLeadsCount : totalLeads,
    qualifiedLeads: neutralizeLeadOutcomes ? 0 : wonLeads,
    unqualifiedLeads: neutralizeLeadOutcomes ? 0 : lostLeads,
    salesCount: neutralizeLeadOutcomes ? 0 : wonLeads,
    totalLeads,
    activeLeads: activeLeadsCount,
    wonLeads,
    lostLeads,
    conversionRate: Number(conversionRate.toFixed(2)),
    totalDealAmount: Number(totalDealAmount.toFixed(2)),
    averageDealAmount: Number(averageDealAmount.toFixed(2)),
    totalCalls,
    inboundCalls,
    outboundCalls,
    missedCalls,
    missedCallRate: Number(missedCallRate.toFixed(2)),
    totalCallDuration,
    averageCallDuration: Number(averageCallDuration.toFixed(2)),
    averageDailyCalls: Number(averageDailyCalls.toFixed(2)),
    averageDailyCallDuration: Number(averageDailyCallDuration.toFixed(2)),
    incomeAmount: Number(incomeAmount.toFixed(2)),
    followUpCount: activityMetrics.followUpCount,
    noteCount: activityMetrics.noteCount,
    stageChangeCount: activityMetrics.stageChangeCount,
    overdueFollowUpCount: activityMetrics.overdueFollowUpCount,
    todayFollowUpCount: activityMetrics.todayFollowUpCount,
  };
}

/** amoCRM manager id -> ids of the active users mapped to it (the users whose `calls.managerUserId` counts for it). */
export async function getManagerUserIdsMap(tenantId: string, managerIds: string[], db: DbClient): Promise<Map<string, string[]>> {
  if (managerIds.length === 0) {
    return new Map();
  }

  const mappedUsers = await db.user.findMany({
    where: {
      tenantId,
      isActive: true,
      amocrmResponsibleUserId: { in: managerIds },
    },
    select: {
      id: true,
      amocrmResponsibleUserId: true,
    },
  });
  const byManager = new Map<string, string[]>();

  for (const mappedUser of mappedUsers) {
    const managerId = asString(mappedUser.amocrmResponsibleUserId);

    if (!managerId) {
      continue;
    }
    byManager.set(managerId, [...(byManager.get(managerId) || []), mappedUser.id]);
  }

  return byManager;
}
