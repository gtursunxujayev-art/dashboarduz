import { extractSalarySettings, type KpiSettings } from '../salary-settings';
import {
  addApprovedAdjustments,
  addBonusItems,
  applyPlanProgress,
  computeAbsencePenalty,
  computeKpiMetricValues,
  countNewLeadsByAgent,
  createSalaryAgentRow,
  describeKpiSettings,
  finalizeSalaryRows,
  type KpiSources,
  mapAgentsToAmoUsers,
  type SalaryRows,
  scoreSalaryKpi,
  splitAttendancePenalty,
  summarizeAttendanceDays,
  summarizeKpiCalls,
  summarizeKpiIncomes,
  sumSalaryTotals,
} from '../salary-summary';

function rowsOf(...rows: Array<ReturnType<typeof createSalaryAgentRow>>): SalaryRows {
  return new Map(rows.map((row) => [row.userId, row]));
}

const penaltySettings = extractSalarySettings({}).attendancePenaltySettings;

describe('salary rows', () => {
  it('starts from the fixed salary with the agent name, username or id', () => {
    expect(createSalaryAgentRow({ id: 'a', name: null, username: 'aziz' }, 100).name).toBe('aziz');
    expect(createSalaryAgentRow({ id: 'a', name: null, username: null }, 100)).toMatchObject({ name: 'a', fixedSalary: 100, kpiBreakdown: null });
  });

  it('adds bonus items, adjustments from the range month on, and plan bonus', () => {
    const rows = rowsOf(createSalaryAgentRow({ id: 'a', name: 'A', username: null }, 0));
    const monthStart = new Date('2026-09-01T00:00:00Z');

    addBonusItems(rows, [
      { agentUserId: 'a', category: 'online', bonusAmount: 10 },
      { agentUserId: 'a', category: 'online', bonusAmount: 5 },
      { agentUserId: 'x', category: 'offline', bonusAmount: 99 },
    ]);
    addApprovedAdjustments(rows, [
      { agentUserId: 'a', payoutMonth: monthStart, outstandingAmount: 7 },
      { agentUserId: 'a', payoutMonth: new Date('2026-08-01T00:00:00Z'), outstandingAmount: 100 },
      { agentUserId: 'a', payoutMonth: null, outstandingAmount: 100 },
    ], monthStart);
    applyPlanProgress(rows, new Map([['a', [
      { planId: 'p', name: 'P', periodMode: 'monthly' as const, target: 1, fact: 2, completionPercent: 200, completedUnits: 2, earnedAmount: 30 },
      { planId: 'q', name: 'Q', periodMode: 'all_time' as const, target: 1, fact: 1, completionPercent: 100, completedUnits: 1, earnedAmount: 20 },
    ]]]));

    expect(rows.get('a')).toMatchObject({
      bonusAmount: 15,
      bonusBreakdown: { online: 15, offline: 0, intensive: 0, additional_service: 0 },
      approvedAdjustmentAmount: 7,
      outstandingAdjustmentBalance: 7,
      planBonusAmount: 50,
    });
  });

  it('totals rows (never below 0) and sorts by salary after attendance', () => {
    const low = { ...createSalaryAgentRow({ id: 'low', name: 'L', username: null }, 100), attendancePenaltyTotal: 150 };
    const high = { ...createSalaryAgentRow({ id: 'high', name: 'H', username: null }, 100), bonusAmount: 50, approvedAdjustmentAmount: -20 };
    const result = finalizeSalaryRows([low, high]);

    expect(result.map((row) => [row.userId, row.totalSalary, row.salaryAfterAttendance])).toEqual([['high', 130, 130], ['low', 100, 0]]);
    expect(Object.keys(result[0]!).slice(-4)).toEqual(['bonusBreakdown', 'kpiBreakdown', 'planProgress', 'totalSalary']);
    expect(sumSalaryTotals(result)).toEqual({
      fixedSalary: 200,
      bonus: 50,
      approvedAdjustments: -20,
      planBonus: 0,
      kpi: 0,
      attendancePenaltyFixed: 0,
      attendancePenaltyKpi: 0,
      attendancePenalty: 150,
      salaryAfterAttendance: 130,
      salary: 230,
    });
  });
});

describe('KPI', () => {
  const kpi: KpiSettings = {
    ...extractSalarySettings({}).kpiSettings,
    enabled: true,
    monthlyBudget: 1000,
    selectedMetrics: ['conversion', 'callCount', 'followUpDonePercent', 'avgDailyTalkTime'],
  };

  kpi.thresholds.conversion = { full: 50, half: 20 };
  kpi.thresholds.callCount = { full: 3, half: 2 };
  kpi.thresholds.followUpDonePercent = { full: 90, half: 50 };
  kpi.thresholds.avgDailyTalkTime = { full: 100, half: 60 };

  function sources(): KpiSources {
    const { amoIdByAgentId, agentIdByAmoId } = mapAgentsToAmoUsers([
      { id: 'a', amocrmResponsibleUserId: '501' },
      { id: 'b', amocrmResponsibleUserId: null },
    ]);

    return {
      amoIdByAgentId,
      newLeadCountByAgent: countNewLeadsByAgent([{ responsible_user_id: ' 501 ' }, { responsible_user_id: 501 }, { responsible_user_id: 999 }, {}], agentIdByAmoId),
      calls: summarizeKpiCalls([
        { managerUserId: 'a', duration: 100, startedAt: new Date('2026-09-01T18:00:00Z') },
        { managerUserId: 'a', duration: 61, startedAt: new Date('2026-09-01T20:00:00Z') },
        { managerUserId: 'a', duration: null, startedAt: null },
        { managerUserId: null, duration: 500, startedAt: null },
      ]),
      incomes: summarizeKpiIncomes([
        { managerUserId: 'a', type: 'new_sale', paymentAmount: 30, coursePriceAmount: 90, debtAmount: 60 },
        { managerUserId: 'a', type: 'repayment', paymentAmount: 30, coursePriceAmount: null, debtAmount: null },
      ]),
      activityByManager: new Map([['501', { followUpCount: 3, noteCount: 0, stageChangeCount: 2, overdueFollowUpCount: 1, todayFollowUpCount: 0 }]]),
    };
  }

  it('computes every metric value for an agent', () => {
    // Two calls fall on two Tashkent days (Sept 1 23:00 and Sept 2 01:00).
    expect(computeKpiMetricValues('a', sources())).toEqual({
      conversion: 50,
      avgDailyTalkTime: 81,
      debtCollectPercent: 66.67,
      avgLeadResponseTime: 0,
      callCount: 3,
      followUpCount: 3,
      followUpDonePercent: 75,
      stageChangeCount: 2,
    });
    expect(computeKpiMetricValues('b', sources()).conversion).toBe(0);
  });

  it('pays each selected metric its share of the budget by score', () => {
    const result = scoreSalaryKpi(computeKpiMetricValues('a', sources()), kpi);

    expect(result).toEqual({
      kpiAmount: 750,
      kpiBreakdown: {
        conversion: { value: 50, score: 1, amount: 250 },
        callCount: { value: 3, score: 1, amount: 250 },
        followUpDonePercent: { value: 75, score: 0.5, amount: 125 },
        avgDailyTalkTime: { value: 81, score: 0.5, amount: 125 },
      },
    });
    expect(scoreSalaryKpi(computeKpiMetricValues('a', sources()), { ...kpi, selectedMetrics: [] })).toEqual({ kpiAmount: 0, kpiBreakdown: null });
  });

  it('describes enabled KPI settings and hides disabled ones', () => {
    expect(describeKpiSettings(kpi)).toEqual({ monthlyBudget: 1000, selectedMetrics: kpi.selectedMetrics, thresholds: kpi.thresholds });
    expect(describeKpiSettings({ ...kpi, enabled: false })).toBeNull();
  });
});

describe('attendance penalties', () => {
  it('sums late and missing time and records check-in days by weekday or Sunday', () => {
    const { totalsByUser, presenceByUserMonth } = summarizeAttendanceDays([
      { userId: 'a', summaryDate: '2026-09-06', lateMinutes: 10, missingSeconds: -5, firstInAt: new Date() },
      { userId: 'a', summaryDate: '2026-09-07', lateMinutes: null, missingSeconds: 3600, firstInAt: new Date() },
      { userId: 'a', summaryDate: '2026-09-08', lateMinutes: 5, missingSeconds: null, firstInAt: null },
    ]);

    expect(totalsByUser.get('a')).toEqual({ lateMinutes: 15, missingSeconds: 3600 });
    expect(presenceByUserMonth.get('a|2026-09')).toEqual({ weekdayDates: new Set(['2026-09-07']), sundayDates: new Set(['2026-09-06']) });
  });

  it('charges a day of fixed salary for each uncovered required workday', () => {
    const presenceByUserMonth = new Map([['a|2026-09', { weekdayDates: new Set(['2026-09-01']), sundayDates: new Set(['2026-09-06']) }]]);
    const params = {
      userId: 'a',
      monthlyFixedSalary: 2600,
      absenceDayPenaltyUZS: 1,
      requiredWorkdaysByMonth: new Map([['2026-09', 26], ['2026-10', 0]]),
      presenceByUserMonth,
    };

    expect(computeAbsencePenalty(params)).toBe(2400);
    expect(computeAbsencePenalty({ ...params, absenceDayPenaltyUZS: 0 })).toBe(0);
    expect(computeAbsencePenalty({ ...params, monthlyFixedSalary: 0 })).toBe(0);
  });

  it('caps penalties, sends them to their targets and never takes more than the row has', () => {
    const settings = { ...penaltySettings, lateMinutePenaltyUZS: 10, missingHourPenaltyUZS: 100, latePenaltyTarget: 'kpi' as const, missingHourPenaltyTarget: 'fixed' as const };

    expect(splitAttendancePenalty({
      row: { fixedSalary: 1000, kpiAmount: 50 },
      settings: { ...settings, monthlyPenaltyCapUZS: 300 },
      lateMinutes: 20,
      missingSeconds: 5400,
      absencePenalty: 500,
    })).toEqual({ fixedPenalty: 100, kpiPenalty: 50 });
    expect(splitAttendancePenalty({
      row: { fixedSalary: 100, kpiAmount: 0 },
      settings,
      lateMinutes: 0,
      missingSeconds: 0,
      absencePenalty: 500,
    })).toEqual({ fixedPenalty: 100, kpiPenalty: 0 });
  });
});
