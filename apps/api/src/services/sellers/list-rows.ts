/**
 * The sellers list (`sellers.list`): rows of the period grouped per amoCRM manager, and one list row per manager.
 * Pure functions over rows the procedure has already loaded. A manager is keyed by their amoCRM user id; app users
 * are mapped to it through `amocrmResponsibleUserId`.
 */
import type { AmoCRMLead, AmoCRMUser } from '../integrations/amocrm';
import type { AmoCRMActivityMetrics } from '../integrations/amocrm-activity';

import { asString, buildMetrics, getLeadResponsibleId, type SellerIncomeMetricSource, summarizeSellerIncomeMetrics, toManagerRole } from './metrics';

export type SellerCallRow = { duration: number | null; direction: string; status: string; startedAt: Date | null };

export type LeadResponseTime = { avgResponseSeconds: number; medianResponseSeconds: number; respondedCount: number; totalCount: number };

/** The leads of the given managers, grouped by their responsible manager; other leads are dropped. */
export function groupLeadsByManager(leads: AmoCRMLead[], managerIds: Set<string>): Map<string, AmoCRMLead[]> {
  const byManager = new Map<string, AmoCRMLead[]>();

  for (const lead of leads) {
    const responsibleUserId = getLeadResponsibleId(lead);

    if (!responsibleUserId || !managerIds.has(responsibleUserId)) {
      continue;
    }
    const current = byManager.get(responsibleUserId) || [];

    current.push(lead);
    byManager.set(responsibleUserId, current);
  }

  return byManager;
}

/** App user id -> the amoCRM manager they are mapped to (the inverse of manager -> user ids). */
export function managerIdByMappedUserId(userIdsByManager: Map<string, string[]>): Map<string, string> {
  const byUserId = new Map<string, string>();

  for (const [managerId, userIds] of userIdsByManager.entries()) {
    for (const userId of userIds) {
      byUserId.set(userId, managerId);
    }
  }

  return byUserId;
}

/** Calls of mapped users, grouped by their manager. */
export function groupCallsByManager(
  calls: Array<SellerCallRow & { managerUserId: string | null }>,
  managerIdByUserId: Map<string, string>,
): Map<string, SellerCallRow[]> {
  const byManager = new Map<string, SellerCallRow[]>();

  for (const call of calls) {
    const managerId = call.managerUserId ? managerIdByUserId.get(call.managerUserId) : undefined;

    if (!managerId) {
      continue;
    }
    const current = byManager.get(managerId) || [];

    current.push({ duration: call.duration, direction: call.direction, status: call.status, startedAt: call.startedAt });
    byManager.set(managerId, current);
  }

  return byManager;
}

/** Adds up a per-user number (e.g. manually entered call seconds) per manager; unmapped users are skipped. */
export function sumByManager(valueByUserId: Map<string, number>, managerIdByUserId: Map<string, string>): Map<string, number> {
  const byManager = new Map<string, number>();

  for (const [userId, value] of valueByUserId.entries()) {
    const managerId = managerIdByUserId.get(userId);

    if (!managerId) {
      continue;
    }
    byManager.set(managerId, (byManager.get(managerId) || 0) + value);
  }

  return byManager;
}

/** Income rows (as sales metrics read them) grouped by the manager of the income's user. */
export function groupSellerIncomesByManager(
  incomes: Array<SellerIncomeMetricSource & { managerUserId: string | null }>,
  managerIdByUserId: Map<string, string>,
): Map<string, SellerIncomeMetricSource[]> {
  const byManager = new Map<string, SellerIncomeMetricSource[]>();

  for (const income of incomes) {
    const managerId = managerIdByUserId.get(income.managerUserId || '');

    if (!managerId) {
      continue;
    }
    const current = byManager.get(managerId) || [];

    current.push({
      type: income.type,
      paymentAmount: income.paymentAmount,
      coursePriceAmount: income.coursePriceAmount,
      course: income.course,
    });
    byManager.set(managerId, current);
  }

  return byManager;
}

/** Number of rows per manager of the row's user (e.g. approved refund requests). */
export function countByManager(userIds: Array<string | null>, managerIdByUserId: Map<string, string>): Map<string, number> {
  const counts = new Map<string, number>();

  for (const userId of userIds) {
    const managerId = managerIdByUserId.get(userId || '');

    if (!managerId) continue;
    counts.set(managerId, (counts.get(managerId) || 0) + 1);
  }

  return counts;
}

/**
 * New and repeat customers per manager: each customer counts once per manager, as repeat when they bought before
 * the period (`repeatCustomerIds`).
 */
export function countNewAndRepeatCustomers(
  sales: Array<{ managerUserId: string | null; customerId: string }>,
  repeatCustomerIds: Set<string>,
  managerIdByUserId: Map<string, string>,
) {
  const newCustomersByManager = new Map<string, number>();
  const repeatCustomersByManager = new Map<string, number>();
  const seenCustomerByManager = new Map<string, Set<string>>();

  for (const sale of sales) {
    const managerId = managerIdByUserId.get(sale.managerUserId || '');

    if (!managerId) continue;
    const seen = seenCustomerByManager.get(managerId) || new Set<string>();

    if (seen.has(sale.customerId)) continue;
    seen.add(sale.customerId);
    seenCustomerByManager.set(managerId, seen);
    const counts = repeatCustomerIds.has(sale.customerId) ? repeatCustomersByManager : newCustomersByManager;

    counts.set(managerId, (counts.get(managerId) || 0) + 1);
  }

  return { newCustomersByManager, repeatCustomersByManager };
}

/** Payment deadlines per manager, and how many were met (paid off, or entered on or before the deadline). */
export function countDeadlineAdherence(
  incomes: Array<{ managerUserId: string | null; entryDate: Date; deadline: Date | null; remainingDebtAmount: number }>,
  managerIdByUserId: Map<string, string>,
) {
  const deadlineMetByManager = new Map<string, number>();
  const deadlineTotalByManager = new Map<string, number>();

  for (const income of incomes) {
    const managerId = managerIdByUserId.get(income.managerUserId || '');

    if (!managerId || !income.deadline) continue;
    deadlineTotalByManager.set(managerId, (deadlineTotalByManager.get(managerId) || 0) + 1);
    if (income.remainingDebtAmount <= 0 || income.entryDate <= income.deadline) {
      deadlineMetByManager.set(managerId, (deadlineMetByManager.get(managerId) || 0) + 1);
    }
  }

  return { deadlineMetByManager, deadlineTotalByManager };
}

/** `part / whole` as a percentage with 2 decimals; 0 when `whole` is 0. */
export function percentToTwoDecimals(part: number, whole: number): number {
  return whole > 0 ? Number(((part / whole) * 100).toFixed(2)) : 0;
}

/** Everything a manager's list row reads, grouped by amoCRM manager id. */
export type SellerListSources = {
  rangeStart: Date;
  rangeEnd: Date;
  activeLeadsByManager: Map<string, AmoCRMLead[]>;
  newLeadsByManager: Map<string, AmoCRMLead[]>;
  callsByManager: Map<string, SellerCallRow[]>;
  activityByManager: Map<string, AmoCRMActivityMetrics>;
  incomesByManager: Map<string, SellerIncomeMetricSource[]>;
  corporateDurationByManager: Map<string, number>;
  refundsByManager: Map<string, number>;
  newCustomersByManager: Map<string, number>;
  repeatCustomersByManager: Map<string, number>;
  deadlineMetByManager: Map<string, number>;
  deadlineTotalByManager: Map<string, number>;
  leadResponseTimeByManager: Map<string, LeadResponseTime>;
};

/** One manager's row of the sellers list: lead and call metrics, sales of the period, and service quality rates. */
export function buildSellerListRow(manager: AmoCRMUser, sources: SellerListSources) {
  const managerId = asString(manager.id) || '';
  const salesMetrics = summarizeSellerIncomeMetrics(sources.incomesByManager.get(managerId) || [], sources.rangeStart, sources.rangeEnd);
  const newLeadCount = (sources.newLeadsByManager.get(managerId) || []).length;
  const refundCount = sources.refundsByManager.get(managerId) || 0;
  const newCustomers = sources.newCustomersByManager.get(managerId) || 0;
  const repeatCustomers = sources.repeatCustomersByManager.get(managerId) || 0;
  const deadlineTotal = sources.deadlineTotalByManager.get(managerId) || 0;
  const deadlineMet = sources.deadlineMetByManager.get(managerId) || 0;

  return {
    id: managerId,
    name: manager.name || manager.login || `Manager ${managerId}`,
    email: manager.email || null,
    phone: null,
    roles: toManagerRole(manager),
    lastLoginAt: null,
    createdAt: new Date(0),
    metrics: {
      ...buildMetrics(sources.activeLeadsByManager.get(managerId) || [], [], [], sources.callsByManager.get(managerId) || [], {
        neutralizeLeadOutcomes: true,
        activityMetrics: sources.activityByManager.get(managerId) || null,
        incomeAmountOverride: salesMetrics.incomeAmount,
        manualDurationSeconds: sources.corporateDurationByManager.get(managerId) || 0,
      }),
      salesCount: salesMetrics.newSalesCount,
      totalDealAmount: salesMetrics.newSalesAgreementAmount,
      averageDealAmount: salesMetrics.averageAgreementAmount,
      ...salesMetrics,
      newLeadsInRange: newLeadCount,
      conversionRate: percentToTwoDecimals(salesMetrics.newSalesCount, newLeadCount),
      refundCount,
      refundRate: percentToTwoDecimals(refundCount, salesMetrics.newSalesCount),
      newCustomers,
      repeatCustomers,
      newCustomerRate: percentToTwoDecimals(newCustomers, newCustomers + repeatCustomers),
      deadlineTotal,
      deadlineMet,
      deadlineAdherenceRate: percentToTwoDecimals(deadlineMet, deadlineTotal),
      leadResponseTime: sources.leadResponseTimeByManager.get(managerId) || { avgResponseSeconds: 0, medianResponseSeconds: 0, respondedCount: 0, totalCount: 0 },
    },
  };
}

export type SellerListRow = ReturnType<typeof buildSellerListRow>;

/** Most sales first, then most income, then most talk time, then by name. */
export function compareSellerListRows(a: SellerListRow, b: SellerListRow): number {
  return (b.metrics.salesCount - a.metrics.salesCount)
    || (b.metrics.incomeAmount - a.metrics.incomeAmount)
    || (b.metrics.totalCallDuration - a.metrics.totalCallDuration)
    || a.name.localeCompare(b.name);
}
