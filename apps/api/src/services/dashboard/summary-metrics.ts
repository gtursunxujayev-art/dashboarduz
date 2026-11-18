/**
 * The numbers behind `dashboard.summary` (the KPI and team block of the dashboard): lead qualification counts,
 * sales by course category, income and sales per manager, talk time, and the seller performance table.
 * Pure functions over rows the procedure has already loaded.
 */
import { classifyIncomeCategory, resolveSaleAgreementAmount } from '../income-facts';
import type { AmoCRMLead } from '../integrations/amocrm';
import type { AmoCRMActivityDiagnostics, AmoCRMActivityMetrics } from '../integrations/amocrm-activity';
import { extractLeadValue, humanizeKey } from '../integrations/amocrm-live';

import { toPieData } from './catalog-fields';
import { classifyLeadQualification, type LeadQualificationRules } from './lead-qualification';
import type { createSummarySourceStatus } from './summary-sources';

type SummarySourceStatusEntry = ReturnType<typeof createSummarySourceStatus>['activity'];

type SummaryCourse = { name?: string | null; category?: string | null } | null;

/** A `new_sale` income row as the summary reads it. */
export type SummarySaleRow = {
  paymentAmount: number | null;
  coursePriceAmount: number | null;
  debtAmount: number | null;
  course: SummaryCourse;
};

/** Any income row (sale or repayment) of the period, with its manager. */
export type SummaryIncomeRow = SummarySaleRow & {
  type: string;
  managerUserId: string;
};

export type SummaryCallRow = { managerUserId: string | null; duration: number | null };

/** An active agent or team leader, with the amoCRM user they are linked to. */
export type SummaryAgent = {
  id: string;
  name: string | null;
  username: string | null;
  amocrmResponsibleUserId: string | null;
};

export type LeadCountsByResponsibleUser = Map<string, { newLeads: number; qualifiedLeads: number }>;

export type ManagerSalesStats = { sales: number; agreementsAmount: number; incomeAmount: number };

/** The agent's display name: name, else username, else id. */
export function summaryAgentName(agent: Pick<SummaryAgent, 'id' | 'name' | 'username'>): string {
  return agent.name || agent.username || agent.id;
}

/**
 * Qualified and non-qualified lead counts, non-qualified leads per reason value, and leads per source value
 * ("Unknown source" when the lead has none). Sources are counted only when a source field is configured.
 */
export function countSummaryLeads(leads: AmoCRMLead[], rules: LeadQualificationRules & { sourceFieldKey: string | null }) {
  const reasonCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  let qualifiedLeads = 0;
  let nonQualifiedLeads = 0;

  for (const lead of leads) {
    const { reasonValue, qualified, nonQualified } = classifyLeadQualification(lead, rules);

    if (qualified) {
      qualifiedLeads += 1;
    }
    if (nonQualified) {
      nonQualifiedLeads += 1;
      if (reasonValue) {
        reasonCounts.set(reasonValue, (reasonCounts.get(reasonValue) ?? 0) + 1);
      }
    }
    if (rules.sourceFieldKey) {
      const sourceValue = extractLeadValue(lead, rules.sourceFieldKey) || 'Unknown source';

      sourceCounts.set(sourceValue, (sourceCounts.get(sourceValue) ?? 0) + 1);
    }
  }

  return { qualifiedLeads, nonQualifiedLeads, reasonCounts, sourceCounts };
}

/** New and qualified leads per amoCRM responsible user id; leads without a responsible user are skipped. */
export function countLeadsByResponsibleUser(leads: AmoCRMLead[], rules: LeadQualificationRules): LeadCountsByResponsibleUser {
  const counts: LeadCountsByResponsibleUser = new Map();

  for (const lead of leads) {
    const responsibleUserId = lead.responsible_user_id !== null && lead.responsible_user_id !== undefined
      ? String(lead.responsible_user_id)
      : '';

    if (!responsibleUserId) {
      continue;
    }
    const current = counts.get(responsibleUserId) || { newLeads: 0, qualifiedLeads: 0 };

    current.newLeads += 1;
    if (classifyLeadQualification(lead, rules).qualified) {
      current.qualifiedLeads += 1;
    }
    counts.set(responsibleUserId, current);
  }

  return counts;
}

/** Count and agreement amount of the period's new sales, in total and per course category. */
export function summarizeNewSalesByCategory(sales: SummarySaleRow[]) {
  const totals = {
    newSalesAgreementAmount: 0,
    onlineSalesCount: 0,
    onlineSalesAgreementAmount: 0,
    offlineSalesCount: 0,
    offlineSalesAgreementAmount: 0,
    intensiveSalesCount: 0,
    intensiveSalesAgreementAmount: 0,
  };

  for (const sale of sales) {
    const agreementAmount = resolveSaleAgreementAmount(sale);
    const category = classifyIncomeCategory(sale.course);

    totals.newSalesAgreementAmount += agreementAmount;
    if (category === 'online') {
      totals.onlineSalesCount += 1;
      totals.onlineSalesAgreementAmount += agreementAmount;
    } else if (category === 'offline') {
      totals.offlineSalesCount += 1;
      totals.offlineSalesAgreementAmount += agreementAmount;
    } else if (category === 'intensive') {
      totals.intensiveSalesCount += 1;
      totals.intensiveSalesAgreementAmount += agreementAmount;
    }
  }

  return totals;
}

/**
 * Income of the period: in total, per course category, and per manager (income, plus count and agreement
 * amount of their new sales).
 */
export function summarizeIncomeByManager(incomes: SummaryIncomeRow[]) {
  const salesByManager = new Map<string, ManagerSalesStats>();
  let totalIncomeAmount = 0;
  let onlineSalesIncomeAmount = 0;
  let offlineSalesIncomeAmount = 0;
  let intensiveSalesIncomeAmount = 0;

  for (const income of incomes) {
    const category = classifyIncomeCategory(income.course);
    const paymentAmount = income.paymentAmount ?? 0;

    totalIncomeAmount += paymentAmount;
    if (category === 'online') {
      onlineSalesIncomeAmount += paymentAmount;
    } else if (category === 'offline') {
      offlineSalesIncomeAmount += paymentAmount;
    } else if (category === 'intensive') {
      intensiveSalesIncomeAmount += paymentAmount;
    }

    const current = salesByManager.get(income.managerUserId) || { sales: 0, agreementsAmount: 0, incomeAmount: 0 };

    current.incomeAmount += paymentAmount;
    if (income.type === 'new_sale') {
      current.sales += 1;
      current.agreementsAmount += resolveSaleAgreementAmount(income);
    }
    salesByManager.set(income.managerUserId, current);
  }

  return { salesByManager, totalIncomeAmount, onlineSalesIncomeAmount, offlineSalesIncomeAmount, intensiveSalesIncomeAmount };
}

/**
 * Calls and talk seconds per agent. Negative durations count as 0. Manually entered corporate call time is added
 * for agents linked to amoCRM, agents with manual time, and agents who already have calls; other agents get no
 * talk-time entry at all (shown as unknown).
 */
export function summarizeTalkTime(params: {
  calls: SummaryCallRow[];
  agents: SummaryAgent[];
  corporateDurationByUserId: Map<string, number>;
}) {
  const talkSecondsByAgent = new Map<string, number>();
  const callCountByAgent = new Map<string, number>();

  for (const call of params.calls) {
    if (!call.managerUserId) continue;
    talkSecondsByAgent.set(call.managerUserId, (talkSecondsByAgent.get(call.managerUserId) || 0) + Math.max(0, call.duration ?? 0));
    callCountByAgent.set(call.managerUserId, (callCountByAgent.get(call.managerUserId) || 0) + 1);
  }
  for (const agent of params.agents) {
    const manualDurationSeconds = params.corporateDurationByUserId.get(agent.id) || 0;
    // Talk time is shown (0 when silent) for agents linked to amoCRM, where their calls come from.
    const hasCallSource = Boolean(String(agent.amocrmResponsibleUserId || '').trim());

    if (hasCallSource || manualDurationSeconds > 0 || talkSecondsByAgent.has(agent.id)) {
      talkSecondsByAgent.set(agent.id, (talkSecondsByAgent.get(agent.id) || 0) + manualDurationSeconds);
    }
  }

  return { talkSecondsByAgent, callCountByAgent };
}

/** Names of the agents not linked to an amoCRM user. */
export function listUnmappedSellerNames(agents: SummaryAgent[]): string[] {
  return agents
    .filter((agent) => !String(agent.amocrmResponsibleUserId || '').trim())
    .map(summaryAgentName);
}

/** Marks a summary source as unavailable for the given reason. */
export function markSummarySourceUnavailable(entry: SummarySourceStatusEntry, reason: string): void {
  entry.ok = false;
  entry.reason = reason;
  entry.state = 'unavailable';
}

/**
 * The amoCRM activity source state after the activity lookup: still loading, amoCRM not connected, no agent
 * linked to amoCRM, or (when the lookup itself succeeded) partial/unavailable from the per-source diagnostics.
 * Then "mapping_missing" is appended when some agents are linked and others are not.
 */
export function resolveSummaryActivityStatus(entry: SummarySourceStatusEntry, params: {
  activityPending: boolean;
  amoConnected: boolean;
  activityManagerCount: number;
  diagnostics: AmoCRMActivityDiagnostics;
  unmappedSellerCount: number;
}): void {
  if (params.activityPending) {
    entry.ok = false;
    entry.reason = 'activity_loading';
    entry.state = 'partial';
  } else if (!params.amoConnected) {
    markSummarySourceUnavailable(entry, 'amo_unavailable');
  } else if (params.activityManagerCount === 0) {
    entry.ok = false;
    entry.reason = 'no_activity_mapping';
    entry.state = 'mapping_missing';
  } else if (entry.ok) {
    const activitySources = Object.values(params.diagnostics);
    const failedSources = activitySources.filter((source) => !source.ok);

    if (failedSources.length > 0) {
      entry.ok = false;
      entry.reason = failedSources.map((source) => source.reason).filter(Boolean).join(',') || 'partial';
      entry.state = failedSources.length === activitySources.length ? 'unavailable' : 'partial';
    }
  }
  if (params.amoConnected && params.activityManagerCount > 0 && params.unmappedSellerCount > 0) {
    entry.ok = false;
    entry.state = 'partial';
    entry.reason = [entry.reason, 'mapping_missing'].filter(Boolean).join(',');
  }
}

const EMPTY_ACTIVITY: AmoCRMActivityMetrics = {
  followUpCount: 0,
  noteCount: 0,
  stageChangeCount: 0,
  overdueFollowUpCount: 0,
  todayFollowUpCount: 0,
};

export type SellerPerformanceInputs = {
  leadsByResponsibleUser: LeadCountsByResponsibleUser;
  salesByManager: Map<string, ManagerSalesStats>;
  activityByManager: Map<string, AmoCRMActivityMetrics>;
  talkSecondsByAgent: Map<string, number>;
  callCountByAgent: Map<string, number>;
  /** Leads were fetched from amoCRM; otherwise lead cells are unknown (`null`). */
  leadsDataAvailable: boolean;
  /** The activity lookup is loading, timed out or failed; activity cells are unknown. */
  activityRequestUnavailable: boolean;
  diagnostics: AmoCRMActivityDiagnostics;
  /** Tashkiliy-only viewers see no money amounts. */
  hideMoney: boolean;
};

/** One row of the seller performance table. Cells that cannot be known are `null`, not 0. */
export function buildSellerPerformanceRow(agent: SummaryAgent, inputs: SellerPerformanceInputs) {
  const responsibleUserId = agent.amocrmResponsibleUserId ? String(agent.amocrmResponsibleUserId) : '';
  const crmMapped = Boolean(responsibleUserId);
  const activityAvailable = crmMapped && !inputs.activityRequestUnavailable;
  const crmAvailability = {
    mapped: crmMapped,
    completedTasks: activityAvailable && inputs.diagnostics.completedTasks.ok,
    pendingTasks: activityAvailable && inputs.diagnostics.pendingTasks.ok,
    events: activityAvailable && inputs.diagnostics.events.ok,
  };
  const leadStats = responsibleUserId ? inputs.leadsByResponsibleUser.get(responsibleUserId) : undefined;
  const salesStats = inputs.salesByManager.get(agent.id) || { sales: 0, agreementsAmount: 0, incomeAmount: 0 };
  const activityStats = (responsibleUserId ? inputs.activityByManager.get(responsibleUserId) : undefined) || EMPTY_ACTIVITY;
  const leadMetricsAvailable = inputs.leadsDataAvailable && crmMapped;
  const newLeads = leadStats?.newLeads ?? 0;
  const conversionPercent = leadMetricsAvailable && newLeads > 0
    ? Number(((salesStats.sales / newLeads) * 100).toFixed(2))
    : (leadMetricsAvailable ? 0 : null);

  return {
    userId: agent.id,
    name: summaryAgentName(agent),
    newLeads: leadMetricsAvailable ? newLeads : null,
    qualifiedLeads: leadMetricsAvailable ? (leadStats?.qualifiedLeads ?? 0) : null,
    sales: salesStats.sales,
    conversionPercent,
    agreementsAmount: inputs.hideMoney ? 0 : salesStats.agreementsAmount,
    incomeAmount: inputs.hideMoney ? 0 : salesStats.incomeAmount,
    talkedSeconds: inputs.talkSecondsByAgent.has(agent.id) ? (inputs.talkSecondsByAgent.get(agent.id) ?? 0) : null,
    callsCount: inputs.callCountByAgent.get(agent.id) ?? 0,
    followUpCount: crmAvailability.completedTasks ? activityStats.followUpCount : null,
    noteCount: crmAvailability.events ? activityStats.noteCount : null,
    stageChangeCount: crmAvailability.events ? activityStats.stageChangeCount : null,
    overdueFollowUpCount: crmAvailability.pendingTasks ? activityStats.overdueFollowUpCount : null,
    todayFollowUpCount: crmAvailability.pendingTasks ? activityStats.todayFollowUpCount : null,
    crmAvailability,
  };
}

export type SellerPerformanceRow = ReturnType<typeof buildSellerPerformanceRow>;

/** Most talk time first (unknown talk time last), then by name in Uzbek collation. */
export function compareSellerPerformanceRows(a: SellerPerformanceRow, b: SellerPerformanceRow): number {
  const aDuration = a.talkedSeconds ?? -1;
  const bDuration = b.talkedSeconds ?? -1;

  if (bDuration !== aDuration) {
    return bDuration - aDuration;
  }

  return a.name.localeCompare(b.name, 'uz');
}

/** The seller performance table, sorted by {@link compareSellerPerformanceRows}. */
export function buildSellerPerformance(agents: SummaryAgent[], inputs: SellerPerformanceInputs): SellerPerformanceRow[] {
  return agents
    .map((agent) => buildSellerPerformanceRow(agent, inputs))
    .sort(compareSellerPerformanceRows);
}

/** One summary pie chart: the field it groups by, the field's label, and the slices. */
export function buildSummaryPieChart(fieldKey: string | null, fieldLabelMap: Map<string, string>, counts: Map<string, number>) {
  return {
    fieldKey,
    fieldLabel: fieldKey ? (fieldLabelMap.get(fieldKey) || humanizeKey(fieldKey)) : null,
    data: toPieData(counts),
  };
}
