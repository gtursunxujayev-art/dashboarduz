/**
 * The salary table behind `dashboard.salarySummary`: one row per agent with fixed salary, bonus, approved
 * adjustments, plan bonus, KPI amount and attendance penalties. Pure functions over rows the procedure loaded.
 */
import { TASHKENT_OFFSET_MS } from '@dashboarduz/shared';

import type { BonusCalculationItem } from '../bonus/types';
import { resolveSaleAgreementAmount } from '../income-facts';
import type { AmoCRMLead } from '../integrations/amocrm';
import type { AmoCRMActivityMetrics } from '../integrations/amocrm-activity';
import type { PlanProgress } from '../plan-bonus';

import { getDayOfWeekFromLocalDateKey, type KpiBreakdownEntry, scoreKpi } from './salary-helpers';
import { type AttendancePenaltySettings, createZeroBreakdown, KPI_METRIC_KEYS, type KpiMetricKey, type KpiSettings, type SalaryBreakdown } from './salary-settings';

/** One agent's salary while it is being built; `totalSalary` is added by {@link finalizeSalaryRows}. */
export type SalaryAgentRow = {
  userId: string;
  name: string;
  fixedSalary: number;
  kpiAmount: number;
  bonusAmount: number;
  approvedAdjustmentAmount: number;
  outstandingAdjustmentBalance: number;
  planBonusAmount: number;
  attendancePenaltyFixed: number;
  attendancePenaltyKpi: number;
  attendancePenaltyTotal: number;
  salaryAfterAttendance: number;
  bonusBreakdown: SalaryBreakdown;
  kpiBreakdown: Record<KpiMetricKey, KpiBreakdownEntry> | null;
  planProgress: PlanProgress[];
};

export type SalaryAgentResult = SalaryAgentRow & { totalSalary: number };

export type SalaryRows = Map<string, SalaryAgentRow>;

/** An agent's starting row: their fixed salary and nothing else yet. */
export function createSalaryAgentRow(agent: { id: string; name: string | null; username: string | null }, fixedSalary: number): SalaryAgentRow {
  return {
    userId: agent.id,
    name: agent.name || agent.username || agent.id,
    fixedSalary,
    kpiAmount: 0,
    bonusAmount: 0,
    approvedAdjustmentAmount: 0,
    outstandingAdjustmentBalance: 0,
    planBonusAmount: 0,
    attendancePenaltyFixed: 0,
    attendancePenaltyKpi: 0,
    attendancePenaltyTotal: 0,
    salaryAfterAttendance: 0,
    bonusBreakdown: createZeroBreakdown(),
    kpiBreakdown: null,
    planProgress: [],
  };
}

/** Adds the bonus engine's items to the agents' rows (items of other users are ignored). */
export function addBonusItems(rows: SalaryRows, items: Array<Pick<BonusCalculationItem, 'agentUserId' | 'category' | 'bonusAmount'>>): void {
  for (const item of items) {
    const row = rows.get(item.agentUserId);

    if (!row) continue;
    row.bonusAmount += item.bonusAmount;
    row.bonusBreakdown[item.category] += item.bonusAmount;
  }
}

/** Adds approved, still outstanding adjustments paid out from the range's first month on. */
export function addApprovedAdjustments(
  rows: SalaryRows,
  adjustments: Array<{ agentUserId: string; payoutMonth: Date | null; outstandingAmount: number }>,
  rangeMonthStart: Date,
): void {
  for (const adjustment of adjustments) {
    const row = rows.get(adjustment.agentUserId);

    if (!row || !adjustment.payoutMonth || adjustment.payoutMonth < rangeMonthStart) continue;
    row.approvedAdjustmentAmount += adjustment.outstandingAmount;
    row.outstandingAdjustmentBalance += adjustment.outstandingAmount;
  }
}

/** Sets each agent's plan progress and plan bonus (the sum of what the plans earned). */
export function applyPlanProgress(rows: SalaryRows, progressByAgent: Map<string, PlanProgress[]>): void {
  for (const row of rows.values()) {
    const planProgress = progressByAgent.get(row.userId) ?? [];

    row.planProgress = planProgress;
    row.planBonusAmount = planProgress.reduce((sum, item) => sum + item.earnedAmount, 0);
  }
}

/** Which amoCRM user each agent is linked to, both ways. Agents without a link are left out. */
export function mapAgentsToAmoUsers(mappings: Array<{ id: string; amocrmResponsibleUserId: string | null }>) {
  const amoIdByAgentId = new Map<string, string>();
  const agentIdByAmoId = new Map<string, string>();

  for (const mapping of mappings) {
    if (mapping.amocrmResponsibleUserId) {
      amoIdByAgentId.set(mapping.id, mapping.amocrmResponsibleUserId);
      agentIdByAmoId.set(mapping.amocrmResponsibleUserId, mapping.id);
    }
  }

  return { amoIdByAgentId, agentIdByAmoId };
}

/** New amoCRM leads per agent, by the lead's (trimmed) responsible user. */
export function countNewLeadsByAgent(leads: AmoCRMLead[], agentIdByAmoId: Map<string, string>): Map<string, number> {
  const counts = new Map<string, number>();

  for (const lead of leads) {
    const agentId = agentIdByAmoId.get(String(lead.responsible_user_id ?? '').trim());

    if (agentId) {
      counts.set(agentId, (counts.get(agentId) || 0) + 1);
    }
  }

  return counts;
}

export type KpiCallRow = { managerUserId: string | null; duration: number | null; startedAt: Date | null };

/** Call count, talk seconds and the Tashkent days with calls, per agent. */
export function summarizeKpiCalls(calls: KpiCallRow[]) {
  const durationByAgent = new Map<string, number>();
  const countByAgent = new Map<string, number>();
  const daysByAgent = new Map<string, Set<string>>();

  for (const call of calls) {
    const agentId = call.managerUserId;

    if (!agentId) continue;
    durationByAgent.set(agentId, (durationByAgent.get(agentId) || 0) + (call.duration || 0));
    countByAgent.set(agentId, (countByAgent.get(agentId) || 0) + 1);
    if (call.startedAt) {
      // Working day in Tashkent time, not the UTC date.
      const dayKey = new Date(call.startedAt.getTime() + TASHKENT_OFFSET_MS).toISOString().slice(0, 10);
      const days = daysByAgent.get(agentId) || new Set<string>();

      days.add(dayKey);
      daysByAgent.set(agentId, days);
    }
  }

  return { durationByAgent, countByAgent, daysByAgent };
}

export type KpiIncomeRow = {
  managerUserId: string;
  type: string;
  paymentAmount: number | null;
  coursePriceAmount: number | null;
  debtAmount: number | null;
};

/** Money paid, agreement amount of new sales and number of new sales, per agent. */
export function summarizeKpiIncomes(incomes: KpiIncomeRow[]) {
  const paidByAgent = new Map<string, number>();
  const agreementByAgent = new Map<string, number>();
  const salesCountByAgent = new Map<string, number>();

  for (const income of incomes) {
    const agentId = income.managerUserId;

    paidByAgent.set(agentId, (paidByAgent.get(agentId) || 0) + (income.paymentAmount || 0));
    if (income.type === 'new_sale') {
      agreementByAgent.set(agentId, (agreementByAgent.get(agentId) || 0) + resolveSaleAgreementAmount(income));
      salesCountByAgent.set(agentId, (salesCountByAgent.get(agentId) || 0) + 1);
    }
  }

  return { paidByAgent, agreementByAgent, salesCountByAgent };
}

/** Everything KPI scoring reads, already grouped per agent (activity per amoCRM user). */
export type KpiSources = {
  amoIdByAgentId: Map<string, string>;
  newLeadCountByAgent: Map<string, number>;
  calls: ReturnType<typeof summarizeKpiCalls>;
  incomes: ReturnType<typeof summarizeKpiIncomes>;
  activityByManager: Map<string, AmoCRMActivityMetrics>;
};

/** An agent's value for every KPI metric (percentages to 2 decimals, average daily talk time in whole seconds). */
export function computeKpiMetricValues(agentId: string, sources: KpiSources): Record<KpiMetricKey, number> {
  const amoId = sources.amoIdByAgentId.get(agentId);
  const salesCount = sources.incomes.salesCountByAgent.get(agentId) || 0;
  const newLeadCount = sources.newLeadCountByAgent.get(agentId) || 0;
  const conversionRate = newLeadCount > 0 ? (salesCount / newLeadCount) * 100 : 0;
  const totalDuration = sources.calls.durationByAgent.get(agentId) || 0;
  const activeDays = (sources.calls.daysByAgent.get(agentId) || new Set()).size;
  const dailyTalkTime = activeDays > 0 ? totalDuration / activeDays : 0;
  const totalPaid = sources.incomes.paidByAgent.get(agentId) || 0;
  const totalAgreement = sources.incomes.agreementByAgent.get(agentId) || 0;
  const debtCollectionRate = totalAgreement > 0 ? (totalPaid / totalAgreement) * 100 : 0;
  const activity = amoId ? sources.activityByManager.get(amoId) : null;
  const followUpCount = activity?.followUpCount ?? 0;
  const overdueFollowUpCount = activity?.overdueFollowUpCount ?? 0;
  const followUpDonePercent = (followUpCount + overdueFollowUpCount) > 0
    ? (followUpCount / (followUpCount + overdueFollowUpCount)) * 100
    : 0;

  return {
    conversion: Number(conversionRate.toFixed(2)),
    avgDailyTalkTime: Math.round(dailyTalkTime),
    debtCollectPercent: Number(debtCollectionRate.toFixed(2)),
    avgLeadResponseTime: 0,
    callCount: sources.calls.countByAgent.get(agentId) || 0,
    followUpCount,
    followUpDonePercent: Number(followUpDonePercent.toFixed(2)),
    stageChangeCount: activity?.stageChangeCount ?? 0,
  };
}

/** The selected metrics of the KPI settings, in their configured order, that are known metric keys. */
export function selectedKpiMetricKeys(kpi: KpiSettings): KpiMetricKey[] {
  return kpi.selectedMetrics.filter((metric): metric is KpiMetricKey => KPI_METRIC_KEYS.includes(metric));
}

/**
 * Scores each selected metric against its threshold (full = 1, half = 0.5) and pays that share of the metric's
 * equal part of the monthly KPI budget. No selected metric: amount 0 and no breakdown.
 */
export function scoreSalaryKpi(values: Record<KpiMetricKey, number>, kpi: KpiSettings) {
  const metrics = selectedKpiMetricKeys(kpi);
  const perKpiBudget = metrics.length > 0 ? kpi.monthlyBudget / metrics.length : 0;
  const breakdown = {} as Record<KpiMetricKey, KpiBreakdownEntry>;
  let kpiAmount = 0;

  for (const metric of metrics) {
    const value = values[metric] ?? 0;
    const score = scoreKpi(value, kpi.thresholds[metric], metric !== 'avgLeadResponseTime');
    const amount = Math.round(score * perKpiBudget);

    breakdown[metric] = { value, score, amount };
    kpiAmount += amount;
  }

  return { kpiAmount: Math.round(kpiAmount), kpiBreakdown: metrics.length > 0 ? breakdown : null };
}

/** Sets every row's KPI amount and breakdown. */
export function applyKpiScores(rows: SalaryRows, kpi: KpiSettings, sources: KpiSources): void {
  for (const row of rows.values()) {
    const { kpiAmount, kpiBreakdown } = scoreSalaryKpi(computeKpiMetricValues(row.userId, sources), kpi);

    row.kpiAmount = kpiAmount;
    row.kpiBreakdown = kpiBreakdown;
  }
}

export type AttendanceDayRow = {
  userId: string;
  summaryDate: string;
  lateMinutes: number | null;
  missingSeconds: number | null;
  firstInAt: Date | null;
};

/** Days with a check-in per user and month ("userId|YYYY-MM"): weekdays and Sundays apart. */
export type AttendancePresence = Map<string, { weekdayDates: Set<string>; sundayDates: Set<string> }>;

/** Late minutes and missing seconds per user (negatives count as 0), and the days each user checked in. */
export function summarizeAttendanceDays(days: AttendanceDayRow[]) {
  const totalsByUser = new Map<string, { lateMinutes: number; missingSeconds: number }>();
  const presenceByUserMonth: AttendancePresence = new Map();

  for (const row of days) {
    const existing = totalsByUser.get(row.userId) ?? { lateMinutes: 0, missingSeconds: 0 };

    existing.lateMinutes += Math.max(0, row.lateMinutes ?? 0);
    existing.missingSeconds += Math.max(0, row.missingSeconds ?? 0);
    totalsByUser.set(row.userId, existing);

    if (row.firstInAt) {
      const key = `${row.userId}|${row.summaryDate.slice(0, 7)}`;
      const monthPresence = presenceByUserMonth.get(key) ?? { weekdayDates: new Set<string>(), sundayDates: new Set<string>() };

      if (getDayOfWeekFromLocalDateKey(row.summaryDate) === 0) {
        monthPresence.sundayDates.add(row.summaryDate);
      } else {
        monthPresence.weekdayDates.add(row.summaryDate);
      }
      presenceByUserMonth.set(key, monthPresence);
    }
  }

  return { totalsByUser, presenceByUserMonth };
}

/**
 * Absence penalty: for each month, every required workday not covered by a check-in (a Sunday check-in covers a
 * day too) costs the monthly fixed salary divided by that month's required workdays.
 */
export function computeAbsencePenalty(params: {
  userId: string;
  monthlyFixedSalary: number;
  absenceDayPenaltyUZS: number;
  requiredWorkdaysByMonth: Map<string, number>;
  presenceByUserMonth: AttendancePresence;
}): number {
  let penalty = 0;

  if (params.monthlyFixedSalary <= 0 || params.absenceDayPenaltyUZS <= 0) {
    return penalty;
  }
  for (const [monthKey, requiredWorkdays] of params.requiredWorkdaysByMonth.entries()) {
    if (requiredWorkdays <= 0) {
      continue;
    }
    const monthPresence = params.presenceByUserMonth.get(`${params.userId}|${monthKey}`);
    const creditedDays = (monthPresence?.weekdayDates.size ?? 0) + (monthPresence?.sundayDates.size ?? 0);
    const missingDays = Math.max(requiredWorkdays - creditedDays, 0);

    if (missingDays <= 0) {
      continue;
    }
    penalty += Math.round(params.monthlyFixedSalary / requiredWorkdays) * missingDays;
  }

  return penalty;
}

/**
 * Splits the attendance penalties between fixed salary and KPI. Late and missing-hour penalties go to their
 * configured target, absence always to fixed salary; the monthly cap is used up in that order, and a target never
 * loses more than the row's fixed salary or KPI amount.
 */
export function splitAttendancePenalty(params: {
  row: Pick<SalaryAgentRow, 'fixedSalary' | 'kpiAmount'>;
  settings: AttendancePenaltySettings;
  lateMinutes: number;
  missingSeconds: number;
  absencePenalty: number;
}): { fixedPenalty: number; kpiPenalty: number } {
  const { row, settings } = params;
  const rawLatePenalty = params.lateMinutes * settings.lateMinutePenaltyUZS;
  const rawMissingHourPenalty = Math.round((params.missingSeconds / 3600) * settings.missingHourPenaltyUZS);
  let remainingCap = settings.monthlyPenaltyCapUZS > 0 ? settings.monthlyPenaltyCapUZS : Number.MAX_SAFE_INTEGER;
  const cappedLatePenalty = Math.min(rawLatePenalty, remainingCap);

  remainingCap -= cappedLatePenalty;
  const cappedMissingHourPenalty = Math.min(rawMissingHourPenalty, remainingCap);

  remainingCap -= cappedMissingHourPenalty;
  const cappedAbsencePenalty = Math.min(params.absencePenalty, remainingCap);
  let fixedPenalty = 0;
  let kpiPenalty = 0;
  const addPenalty = (amount: number, target: 'fixed' | 'kpi') => {
    if (amount <= 0) {
      return;
    }
    if (target === 'fixed') {
      fixedPenalty += Math.min(amount, Math.max(0, row.fixedSalary - fixedPenalty));

      return;
    }
    kpiPenalty += Math.min(amount, Math.max(0, row.kpiAmount - kpiPenalty));
  };

  addPenalty(cappedLatePenalty, settings.latePenaltyTarget);
  addPenalty(cappedMissingHourPenalty, settings.missingHourPenaltyTarget);
  addPenalty(cappedAbsencePenalty, 'fixed');

  return { fixedPenalty, kpiPenalty };
}

/** Adds each row's total salary (never below 0) and salary after attendance, highest salary after attendance first. */
export function finalizeSalaryRows(rows: Iterable<SalaryAgentRow>): SalaryAgentResult[] {
  return Array.from(rows)
    .map((row) => {
      const gross = row.fixedSalary + row.kpiAmount + row.bonusAmount + row.planBonusAmount + row.approvedAdjustmentAmount;

      return { ...row, totalSalary: Math.max(0, gross), salaryAfterAttendance: Math.max(0, gross - row.attendancePenaltyTotal) };
    })
    .sort((a, b) => b.salaryAfterAttendance - a.salaryAfterAttendance);
}

export function emptySalaryTotals() {
  return {
    fixedSalary: 0,
    bonus: 0,
    approvedAdjustments: 0,
    planBonus: 0,
    kpi: 0,
    attendancePenaltyFixed: 0,
    attendancePenaltyKpi: 0,
    attendancePenalty: 0,
    salaryAfterAttendance: 0,
    salary: 0,
  };
}

/** Column totals of the salary table. */
export function sumSalaryTotals(rows: SalaryAgentResult[]): ReturnType<typeof emptySalaryTotals> {
  return rows.reduce(
    (acc, row) => ({
      fixedSalary: acc.fixedSalary + row.fixedSalary,
      bonus: acc.bonus + row.bonusAmount,
      approvedAdjustments: acc.approvedAdjustments + row.approvedAdjustmentAmount,
      planBonus: acc.planBonus + row.planBonusAmount,
      kpi: acc.kpi + row.kpiAmount,
      attendancePenaltyFixed: acc.attendancePenaltyFixed + row.attendancePenaltyFixed,
      attendancePenaltyKpi: acc.attendancePenaltyKpi + row.attendancePenaltyKpi,
      attendancePenalty: acc.attendancePenalty + row.attendancePenaltyTotal,
      salaryAfterAttendance: acc.salaryAfterAttendance + row.salaryAfterAttendance,
      salary: acc.salary + row.totalSalary,
    }),
    emptySalaryTotals(),
  );
}

/** The KPI settings shown with the table, or `null` when KPI is off. */
export function describeKpiSettings(kpi: KpiSettings) {
  return kpi.enabled ? { monthlyBudget: kpi.monthlyBudget, selectedMetrics: kpi.selectedMetrics, thresholds: kpi.thresholds } : null;
}
