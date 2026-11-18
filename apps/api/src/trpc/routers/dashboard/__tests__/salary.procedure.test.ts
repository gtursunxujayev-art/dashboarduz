/**
 * Characterization test: pins the whole `dashboard.salarySummary` answer on fixture data (fixed salary, bonus,
 * adjustments, plan bonus, KPI scoring and attendance penalties), with the database and amoCRM mocked.
 */
import { asJson, buildCallerContext } from '../../__tests__/procedure-test-context';
import { dashboardRouter } from '../index';

type FindManyArgs = { where?: Record<string, unknown> };

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000aa';
const AGENT_A = '00000000-0000-4000-8000-00000000000a';
const AGENT_B = '00000000-0000-4000-8000-00000000000b';
const AGENT_C = '00000000-0000-4000-8000-00000000000c';

const mockGetTenantAmoCRMContext = jest.fn();
const mockGetAmoLeads = jest.fn();
const mockGetActivity = jest.fn();
const mockCalculateBonusRange = jest.fn();
const mockGetApprovedAdjustments = jest.fn();
const mockLoadSaleClosures = jest.fn();
const mockResolvePolicy = jest.fn();
const mockComputePlanProgress = jest.fn();

const mockDb = {
  tenant: { findUnique: jest.fn() },
  user: { findMany: jest.fn(), findFirst: jest.fn() },
  subTariff: { findMany: jest.fn() },
  call: { findMany: jest.fn() },
  income: { findMany: jest.fn() },
  attendanceDaySummary: { findMany: jest.fn() },
};

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual<Record<string, unknown>>('@dashboarduz/db'),
  forTenant: () => mockDb,
}));
jest.mock('../../../../services/cache', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/cache'),
  getOrSet: (_key: string, _ttl: number, fetchFn: () => Promise<unknown>) => fetchFn(),
}));
jest.mock('../../../../services/integrations/amocrm-live', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/integrations/amocrm-live'),
  getTenantAmoCRMContext: (...args: unknown[]) => mockGetTenantAmoCRMContext(...args) as unknown,
}));
jest.mock('../../../../services/integrations/amocrm-lead-snapshot-read', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/integrations/amocrm-lead-snapshot-read'),
  getAmoLeads: (...args: unknown[]) => mockGetAmoLeads(...args) as unknown,
}));
jest.mock('../../../../services/integrations/amocrm-activity', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/integrations/amocrm-activity'),
  getAmoCRMActivityMetrics: (...args: unknown[]) => mockGetActivity(...args) as unknown,
}));
jest.mock('../../../../services/bonus-engine', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/bonus-engine'),
  calculateBonusRange: (...args: unknown[]) => mockCalculateBonusRange(...args) as unknown,
  getApprovedAdjustmentsForMonth: (...args: unknown[]) => mockGetApprovedAdjustments(...args) as unknown,
  loadSaleClosures: (...args: unknown[]) => mockLoadSaleClosures(...args) as unknown,
  resolveEffectiveBonusPolicy: (...args: unknown[]) => mockResolvePolicy(...args) as unknown,
}));
jest.mock('../../../../services/plan-bonus', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/plan-bonus'),
  computePlanProgressByAgent: (...args: unknown[]) => mockComputePlanProgress(...args) as unknown,
}));

const thresholds = {
  conversion: { full: 50, half: 25 },
  avgDailyTalkTime: { full: 300, half: 100 },
  debtCollectPercent: { full: 80, half: 40 },
  callCount: { full: 4, half: 2 },
  followUpDonePercent: { full: 90, half: 70 },
  stageChangeCount: { full: 3, half: 1 },
};

const salarySettings = {
  bonusMode: 'on_income',
  bonusPercentages: { online: 5, offline: 4 },
  fixedSalaries: [{ userId: AGENT_A, amount: 5_000_000 }, { userId: AGENT_B, amount: 3_000_000 }],
  planBonuses: [{ id: 'plan-1', name: 'Oylik reja', periodMode: 'monthly', courseCategory: 'online', targetClosedSales: 2, bonusAmount: 300_000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
  kpiSettings: {
    enabled: true,
    monthlyBudget: 1_200_000,
    selectedMetrics: ['conversion', 'avgDailyTalkTime', 'debtCollectPercent', 'callCount', 'followUpDonePercent', 'stageChangeCount'],
    thresholds,
  },
  attendancePenaltySettings: {
    lateMinutePenaltyUZS: 1_000,
    missingHourPenaltyUZS: 20_000,
    absenceDayPenaltyUZS: 1,
    latePenaltyTarget: 'kpi',
    missingHourPenaltyTarget: 'fixed',
    monthlyPenaltyCapUZS: 900_000,
  },
};

const agents = [
  { id: AGENT_A, name: 'Aziz', username: 'aziz' },
  { id: AGENT_B, name: null, username: 'bobur' },
  { id: AGENT_C, name: 'Zarina', username: null },
];

const incomes = [
  { id: 's1', relatedDebtIncomeId: null, managerUserId: AGENT_A, type: 'new_sale', paymentAmount: 4_000_000, coursePriceAmount: 10_000_000, debtAmount: 6_000_000 },
  { id: 's2', relatedDebtIncomeId: null, managerUserId: AGENT_A, type: 'new_sale', paymentAmount: 2_000_000, coursePriceAmount: 2_000_000, debtAmount: 0 },
  { id: 'r1', relatedDebtIncomeId: 's1', managerUserId: AGENT_A, type: 'repayment', paymentAmount: 3_000_000, coursePriceAmount: null, debtAmount: null },
  { id: 's3', relatedDebtIncomeId: null, managerUserId: AGENT_B, type: 'new_sale', paymentAmount: 1, coursePriceAmount: 1, debtAmount: 0 },
  { id: 's4', relatedDebtIncomeId: null, managerUserId: AGENT_B, type: 'new_sale', paymentAmount: 1_000_000, coursePriceAmount: 4_000_000, debtAmount: 3_000_000 },
];

function setUpFixtures(): void {
  mockDb.tenant.findUnique.mockResolvedValue({ settings: { salary: salarySettings } });
  mockDb.user.findFirst.mockResolvedValue({ id: ADMIN_ID });
  mockDb.user.findMany.mockImplementation((args: FindManyArgs) => {
    if (args.where?.roles) return Promise.resolve(agents);

    return Promise.resolve([
      { id: AGENT_A, amocrmResponsibleUserId: '501' },
      { id: AGENT_B, amocrmResponsibleUserId: '502' },
      { id: AGENT_C, amocrmResponsibleUserId: null },
    ]);
  });
  mockDb.subTariff.findMany.mockResolvedValue([{ id: 'st-1', name: ' Premium ' }]);
  mockDb.call.findMany.mockResolvedValue([
    { managerUserId: AGENT_A, duration: 200, startedAt: new Date('2026-09-02T04:00:00.000Z') },
    { managerUserId: AGENT_A, duration: 300, startedAt: new Date('2026-09-02T20:00:00.000Z') },
    { managerUserId: AGENT_A, duration: null, startedAt: new Date('2026-09-03T05:00:00.000Z') },
    { managerUserId: AGENT_B, duration: 90, startedAt: new Date('2026-09-04T05:00:00.000Z') },
    { managerUserId: null, duration: 999, startedAt: new Date('2026-09-04T05:00:00.000Z') },
  ]);
  mockDb.income.findMany.mockImplementation((args: FindManyArgs) => {
    const idFilter = args.where?.id as { in?: string[] } | undefined;

    if (idFilter?.in) {
      return Promise.resolve(incomes.filter((row) => idFilter.in?.includes(row.id) && row.type === 'new_sale'));
    }

    return Promise.resolve(incomes);
  });
  mockDb.attendanceDaySummary.findMany.mockResolvedValue([
    { userId: AGENT_A, summaryDate: '2026-09-01', lateMinutes: 30, missingSeconds: 5_400, absence: false, firstInAt: new Date('2026-09-01T04:30:00.000Z') },
    { userId: AGENT_A, summaryDate: '2026-09-06', lateMinutes: null, missingSeconds: null, absence: false, firstInAt: new Date('2026-09-06T04:30:00.000Z') },
    { userId: AGENT_A, summaryDate: '2026-09-08', lateMinutes: -5, missingSeconds: 1_800, absence: true, firstInAt: null },
    { userId: AGENT_B, summaryDate: '2026-09-02', lateMinutes: 600, missingSeconds: 0, absence: false, firstInAt: new Date('2026-09-02T04:00:00.000Z') },
  ]);
  mockGetTenantAmoCRMContext.mockResolvedValue({ accessToken: 'token', baseUrl: 'https://example.amocrm.ru', selectedPipelineIds: [] });
  mockGetAmoLeads.mockResolvedValue([
    { id: 1, responsible_user_id: 501 },
    { id: 2, responsible_user_id: '501' },
    { id: 3, responsible_user_id: ' 501 ' },
    { id: 4, responsible_user_id: 502 },
    { id: 5, responsible_user_id: 999 },
    { id: 6 },
  ]);
  mockGetActivity.mockResolvedValue(new Map([
    ['501', { followUpCount: 9, noteCount: 1, stageChangeCount: 4, overdueFollowUpCount: 1, todayFollowUpCount: 0 }],
    ['502', { followUpCount: 0, noteCount: 0, stageChangeCount: 1, overdueFollowUpCount: 3, todayFollowUpCount: 0 }],
  ]));
  mockCalculateBonusRange.mockResolvedValue({
    months: [],
    totalBonusAmount: 0,
    items: [
      { agentUserId: AGENT_A, category: 'online', bonusAmount: 200_000 },
      { agentUserId: AGENT_A, category: 'offline', bonusAmount: 50_000 },
      { agentUserId: AGENT_B, category: 'intensive', bonusAmount: 150_000 },
      { agentUserId: 'someone-else', category: 'online', bonusAmount: 999 },
    ],
  });
  mockGetApprovedAdjustments.mockResolvedValue([
    { agentUserId: AGENT_A, payoutMonth: new Date('2026-09-10T00:00:00.000Z'), outstandingAmount: 70_000 },
    { agentUserId: AGENT_A, payoutMonth: new Date('2026-07-10T00:00:00.000Z'), outstandingAmount: 11_000 },
    { agentUserId: AGENT_B, payoutMonth: null, outstandingAmount: 22_000 },
    { agentUserId: AGENT_C, payoutMonth: new Date('2026-09-20T00:00:00.000Z'), outstandingAmount: -40_000 },
  ]);
  mockLoadSaleClosures.mockResolvedValue([{ profileSubTariffId: 'st-1' }, { profileSubTariffId: null }]);
  mockResolvePolicy.mockResolvedValue({ policy: { bonusMode: 'on_debt_closed' } });
  mockComputePlanProgress.mockReturnValue(new Map([
    [AGENT_A, [{ planId: 'plan-1', name: 'Oylik reja', periodMode: 'monthly', target: 2, fact: 3, completionPercent: 150, completedUnits: 1, earnedAmount: 300_000 }]],
  ]));
}

async function callSalary(roles: Parameters<typeof buildCallerContext>[0]['roles'], input?: Record<string, unknown>) {
  const caller = dashboardRouter.createCaller(buildCallerContext({ tenantId: TENANT_ID, userId: ADMIN_ID, roles }));

  return asJson(await caller.salarySummary({ range: 'custom', dateFrom: '2026-09-01', dateTo: '2026-09-30', ...input })) as Record<string, unknown>;
}

const expectedThresholds = {
  conversion: { full: 50, half: 25 },
  avgDailyTalkTime: { full: 300, half: 100 },
  debtCollectPercent: { full: 80, half: 40 },
  avgLeadResponseTime: { full: 0, half: 0 },
  callCount: { full: 4, half: 2 },
  followUpCount: { full: 0, half: 0 },
  followUpDonePercent: { full: 90, half: 70 },
  stageChangeCount: { full: 3, half: 1 },
};

const expectedAttendanceSettings = {
  lateMinutePenaltyUZS: 1000,
  missingHourPenaltyUZS: 20_000,
  absenceDayPenaltyUZS: 1,
  applyToFixedSalary: true,
  applyToKpi: false,
  latePenaltyTarget: 'kpi',
  missingHourPenaltyTarget: 'fixed',
  absenceDayPenaltyTarget: 'fixed',
  monthlyPenaltyCapUZS: 900_000,
};

describe('dashboard.salarySummary (characterization)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUpFixtures();
  });

  it('answers the full salary table for an admin', async () => {
    const result = await callSalary(['Admin']);

    expect(JSON.stringify(result)).toBe(JSON.stringify(EXPECTED_FULL));
    expect(mockComputePlanProgress).toHaveBeenCalledWith(expect.objectContaining({
      agentIds: [AGENT_A, AGENT_B, AGENT_C],
      subTariffNameById: new Map([['st-1', 'Premium']]),
    }));
    expect(mockGetAmoLeads).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ responsibleUserIds: ['501', '502'] }),
      expect.anything(),
      mockDb,
    );
  });

  it('prorates the fixed salary over a part of the month', async () => {
    const result = await callSalary(['Admin'], { dateTo: '2026-09-15', prorateFixedSalary: true });
    const rows = result.byAgent as Array<Record<string, unknown>>;

    expect(rows.map((row) => [row.userId, row.fixedSalary])).toEqual(EXPECTED_PRORATED_FIXED);
  });

  it('skips amoCRM activity when no selected KPI needs it, and scores without amoCRM', async () => {
    mockDb.tenant.findUnique.mockResolvedValue({
      settings: { salary: { ...salarySettings, kpiSettings: { ...salarySettings.kpiSettings, selectedMetrics: ['callCount'] } } },
    });
    mockGetTenantAmoCRMContext.mockResolvedValue(null);

    const result = await callSalary(['Admin']);
    const rows = result.byAgent as Array<Record<string, unknown>>;

    expect(mockGetActivity).not.toHaveBeenCalled();
    expect(mockGetAmoLeads).not.toHaveBeenCalled();
    expect(rows.map((row) => [row.userId, row.kpiAmount, row.kpiBreakdown])).toEqual(EXPECTED_CALL_ONLY_KPI);
  });

  it('answers an empty table when the selected manager is not an agent', async () => {
    const result = await callSalary(['Admin'], { managerUserId: '00000000-0000-4000-8000-0000000000ff' });

    expect(JSON.stringify(result)).toBe(JSON.stringify(EXPECTED_EMPTY));
    expect(mockCalculateBonusRange).not.toHaveBeenCalled();
  });

  it('limits an agent to their own row', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: AGENT_B });
    const caller = dashboardRouter.createCaller(buildCallerContext({ tenantId: TENANT_ID, userId: AGENT_B, roles: ['OnlineAgent'] }));
    const result = asJson(await caller.salarySummary({ range: 'custom', dateFrom: '2026-09-01', dateTo: '2026-09-30', managerUserId: AGENT_A })) as Record<string, unknown>;
    const rows = result.byAgent as Array<Record<string, unknown>>;
    const currentUser = result.currentUser as Record<string, unknown>;

    expect(result.scopedToCurrentAgent).toBe(true);
    expect(rows.map((row) => row.userId)).toEqual([AGENT_B]);
    expect(currentUser.userId).toBe(AGENT_B);
  });
});

/* Expected answers, filled from the procedure's output before the refactor and checked by hand. */
const EXPECTED_FULL = {
  monthStart: '2026-08-31T19:00:00.000Z',
  monthEnd: '2026-09-30T18:59:59.999Z',
  scopedToCurrentAgent: false,
  bonusMode: 'on_debt_closed',
  bonusPercentages: { online: 5, offline: 4, intensive: 0, additional_service: 0 },
  attendancePenaltySettings: expectedAttendanceSettings,
  kpiSettings: {
    monthlyBudget: 1_200_000,
    selectedMetrics: salarySettings.kpiSettings.selectedMetrics,
    thresholds: expectedThresholds,
  },
  totals: {
    fixedSalary: 8_000_000,
    bonus: 400_000,
    approvedAdjustments: 30_000,
    planBonus: 300_000,
    kpi: 1_200_000,
    attendancePenaltyFixed: 1_170_000,
    attendancePenaltyKpi: 330_000,
    attendancePenalty: 1_500_000,
    salaryAfterAttendance: 8_470_000,
    salary: 9_970_000,
  },
  byAgent: [
    {
      userId: AGENT_A,
      name: 'Aziz',
      fixedSalary: 5_000_000,
      kpiAmount: 900_000,
      bonusAmount: 250_000,
      approvedAdjustmentAmount: 70_000,
      outstandingAdjustmentBalance: 70_000,
      planBonusAmount: 300_000,
      attendancePenaltyFixed: 870_000,
      attendancePenaltyKpi: 30_000,
      attendancePenaltyTotal: 900_000,
      salaryAfterAttendance: 5_620_000,
      bonusBreakdown: { online: 200_000, offline: 50_000, intensive: 0, additional_service: 0 },
      kpiBreakdown: {
        conversion: { value: 66.67, score: 1, amount: 200_000 },
        avgDailyTalkTime: { value: 250, score: 0.5, amount: 100_000 },
        debtCollectPercent: { value: 75, score: 0.5, amount: 100_000 },
        callCount: { value: 3, score: 0.5, amount: 100_000 },
        followUpDonePercent: { value: 90, score: 1, amount: 200_000 },
        stageChangeCount: { value: 4, score: 1, amount: 200_000 },
      },
      planProgress: [
        {
          planId: 'plan-1',
          name: 'Oylik reja',
          periodMode: 'monthly',
          target: 2,
          fact: 3,
          completionPercent: 150,
          completedUnits: 1,
          earnedAmount: 300_000,
        },
      ],
      totalSalary: 6_520_000,
    },
    {
      userId: AGENT_B,
      name: 'bobur',
      fixedSalary: 3_000_000,
      kpiAmount: 300_000,
      bonusAmount: 150_000,
      approvedAdjustmentAmount: 0,
      outstandingAdjustmentBalance: 0,
      planBonusAmount: 0,
      attendancePenaltyFixed: 300_000,
      attendancePenaltyKpi: 300_000,
      attendancePenaltyTotal: 600_000,
      salaryAfterAttendance: 2_850_000,
      bonusBreakdown: { online: 0, offline: 0, intensive: 150_000, additional_service: 0 },
      kpiBreakdown: {
        conversion: { value: 100, score: 1, amount: 200_000 },
        avgDailyTalkTime: { value: 90, score: 0, amount: 0 },
        debtCollectPercent: { value: 25, score: 0, amount: 0 },
        callCount: { value: 1, score: 0, amount: 0 },
        followUpDonePercent: { value: 0, score: 0, amount: 0 },
        stageChangeCount: { value: 1, score: 0.5, amount: 100_000 },
      },
      planProgress: [],
      totalSalary: 3_450_000,
    },
    {
      userId: AGENT_C,
      name: 'Zarina',
      fixedSalary: 0,
      kpiAmount: 0,
      bonusAmount: 0,
      approvedAdjustmentAmount: -40_000,
      outstandingAdjustmentBalance: -40_000,
      planBonusAmount: 0,
      attendancePenaltyFixed: 0,
      attendancePenaltyKpi: 0,
      attendancePenaltyTotal: 0,
      salaryAfterAttendance: 0,
      bonusBreakdown: { online: 0, offline: 0, intensive: 0, additional_service: 0 },
      kpiBreakdown: {
        conversion: { value: 0, score: 0, amount: 0 },
        avgDailyTalkTime: { value: 0, score: 0, amount: 0 },
        debtCollectPercent: { value: 0, score: 0, amount: 0 },
        callCount: { value: 0, score: 0, amount: 0 },
        followUpDonePercent: { value: 0, score: 0, amount: 0 },
        stageChangeCount: { value: 0, score: 0, amount: 0 },
      },
      planProgress: [],
      totalSalary: 0,
    },
  ],
  currentUser: null,
};

const EXPECTED_PRORATED_FIXED = [[AGENT_A, 2_500_000], [AGENT_B, 1_500_000], [AGENT_C, 0]];

const EXPECTED_CALL_ONLY_KPI = [
  [AGENT_A, 600_000, { callCount: { value: 3, score: 0.5, amount: 600_000 } }],
  [AGENT_B, 0, { callCount: { value: 1, score: 0, amount: 0 } }],
  [AGENT_C, 0, { callCount: { value: 0, score: 0, amount: 0 } }],
];

const EXPECTED_EMPTY = {
  monthStart: '2026-08-31T19:00:00.000Z',
  monthEnd: '2026-09-30T18:59:59.999Z',
  scopedToCurrentAgent: false,
  bonusMode: 'on_debt_closed',
  bonusPercentages: { online: 5, offline: 4, intensive: 0, additional_service: 0 },
  kpiSettings: {
    monthlyBudget: 1_200_000,
    selectedMetrics: salarySettings.kpiSettings.selectedMetrics,
    thresholds: expectedThresholds,
  },
  attendancePenaltySettings: expectedAttendanceSettings,
  totals: {
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
  },
  byAgent: [],
  currentUser: null,
};
