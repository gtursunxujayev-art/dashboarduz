/**
 * Characterization test: pins the whole `dashboard.summary` answer on fixture data, with the database and the
 * amoCRM services mocked, so refactors of the procedure keep every key, value, null and order unchanged.
 */
import { asJson, buildCallerContext } from '../../__tests__/procedure-test-context';
import { dashboardRouter } from '../index';

type FindManyArgs = { where?: Record<string, unknown> };

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000aa';

const mockGetTenantAmoCRMContext = jest.fn();
const mockGetAmoLeads = jest.fn();
const mockGetActivityWithin = jest.fn();
const mockCollectCatalogFieldOptions = jest.fn();
const mockGetCorporateDurations = jest.fn();
const mockInvalidateCache = jest.fn();

const onlineCourse = { name: 'Online-Iyul', category: 'online' };
const offlineCourse = { name: 'Offline guruh', category: 'offline' };
const intensiveCourse = { name: 'Intensiv kurs', category: null };

const incomeRows = [
  { id: 's1', type: 'new_sale', relatedDebtIncomeId: null, paymentAmount: 4_000_000, coursePriceAmount: 10_000_000, debtAmount: 6_000_000, managerUserId: 'agent-a', course: onlineCourse },
  { id: 's2', type: 'new_sale', relatedDebtIncomeId: null, paymentAmount: 6_000_000, coursePriceAmount: 6_000_000, debtAmount: 0, managerUserId: 'agent-b', course: offlineCourse },
  { id: 's3', type: 'new_sale', relatedDebtIncomeId: null, paymentAmount: 1_500_000, coursePriceAmount: 3_000_000, debtAmount: 1_500_000, managerUserId: 'agent-a', course: intensiveCourse },
  { id: 's4', type: 'new_sale', relatedDebtIncomeId: null, paymentAmount: 1, coursePriceAmount: 1, debtAmount: 0, managerUserId: 'agent-c', course: onlineCourse },
  { id: 's5', type: 'new_sale', relatedDebtIncomeId: null, paymentAmount: 500_000, coursePriceAmount: 500_000, debtAmount: 0, managerUserId: 'agent-c', course: null },
  { id: 'r1', type: 'repayment', relatedDebtIncomeId: 's1', paymentAmount: 2_000_000, coursePriceAmount: null, debtAmount: null, managerUserId: 'agent-a', course: onlineCourse },
  { id: 'r4', type: 'repayment', relatedDebtIncomeId: 's4', paymentAmount: 7, coursePriceAmount: null, debtAmount: null, managerUserId: 'agent-c', course: onlineCourse },
];

const agentRows = [
  { id: 'agent-a', name: 'Aziz', username: 'aziz', amocrmResponsibleUserId: '501' },
  { id: 'agent-b', name: null, username: 'bobur', amocrmResponsibleUserId: ' 502 ' },
  { id: 'agent-c', name: 'Zarina', username: null, amocrmResponsibleUserId: null },
  { id: 'agent-d', name: 'Dilnoza', username: 'dilnoza', amocrmResponsibleUserId: '503' },
];

const callRows = [
  { managerUserId: 'agent-a', duration: 120 },
  { managerUserId: 'agent-a', duration: null },
  { managerUserId: 'agent-a', duration: -10 },
  { managerUserId: 'agent-b', duration: 300 },
  { managerUserId: null, duration: 50 },
];

const leadRows = [
  { id: 1, status_id: 100, responsible_user_id: 501, quality: 'Sifatsiz', source: 'Instagram' },
  { id: 2, status_id: 200, responsible_user_id: 501, quality: 'Spam', source: 'Telegram' },
  { id: 3, status_id: 100, responsible_user_id: ' 502 ', source: 'Instagram' },
  { id: 4, status_id: 300, responsible_user_id: 999 },
  { id: 5, quality: 'Sifatsiz' },
];

const mockDb = {
  corporateCallDuration: { aggregate: jest.fn() },
  tenant: { findUnique: jest.fn() },
  notification: { count: jest.fn() },
  integration: { count: jest.fn() },
  income: { findMany: jest.fn() },
  call: { findMany: jest.fn() },
  user: { findMany: jest.fn(), findFirst: jest.fn() },
};

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual<Record<string, unknown>>('@dashboarduz/db'),
  forTenant: () => mockDb,
}));
jest.mock('../../../../services/cache', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/cache'),
  getOrSet: (_key: string, _ttl: number, fetchFn: () => Promise<unknown>) => fetchFn(),
  invalidateCache: (key: string) => mockInvalidateCache(key) as Promise<void>,
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
  getAmoCRMActivityMetricsWithin: (...args: unknown[]) => mockGetActivityWithin(...args) as unknown,
}));
jest.mock('../../../../services/dashboard/catalog-fields', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/dashboard/catalog-fields'),
  collectCatalogFieldOptions: (...args: unknown[]) => mockCollectCatalogFieldOptions(...args) as unknown,
}));
jest.mock('../../../../services/corporate-call-durations', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/corporate-call-durations'),
  getCorporateCallDurationByManager: (...args: unknown[]) => mockGetCorporateDurations(...args) as unknown,
}));

const amoContext = { accessToken: 'token', baseUrl: 'https://example.amocrm.ru', selectedPipelineIds: ['77'] };

function setUpFixtures(): void {
  mockDb.corporateCallDuration.aggregate.mockResolvedValue({ _max: { updatedAt: null } });
  mockDb.tenant.findUnique.mockResolvedValue({
    settings: {
      dashboard: {
        reasonFieldKey: 'metadata:quality',
        sourceFieldKey: 'metadata:source',
        qualifiedStageIds: ['100'],
        qualifiedValues: ['Sifatli'],
        nonQualifiedValues: ['Sifatsiz', 'Spam'],
      },
    },
  });
  mockDb.notification.count.mockResolvedValue(3);
  mockDb.integration.count.mockResolvedValue(2);
  mockDb.income.findMany.mockImplementation((args: FindManyArgs) => {
    const where = args.where ?? {};
    const idFilter = where.id as { in?: string[] } | undefined;

    if (idFilter?.in) {
      return Promise.resolve(incomeRows.filter((row) => idFilter.in?.includes(row.id) && row.type === 'new_sale'));
    }
    if (where.type === 'new_sale') {
      return Promise.resolve(incomeRows.filter((row) => row.type === 'new_sale'));
    }

    return Promise.resolve(incomeRows);
  });
  mockDb.call.findMany.mockResolvedValue(callRows);
  mockDb.user.findMany.mockResolvedValue(agentRows);
  mockDb.user.findFirst.mockResolvedValue({ id: ADMIN_ID, amocrmResponsibleUserId: null });
  mockGetTenantAmoCRMContext.mockResolvedValue(amoContext);
  mockCollectCatalogFieldOptions.mockResolvedValue([{ key: 'metadata:source', label: 'Lead source', source: 'catalog' }]);
  mockGetAmoLeads.mockResolvedValue(leadRows);
  mockGetActivityWithin.mockResolvedValue({
    pending: false,
    stale: false,
    metrics: new Map([
      ['501', { followUpCount: 4, noteCount: 2, stageChangeCount: 5, overdueFollowUpCount: 1, todayFollowUpCount: 3 }],
      ['503', { followUpCount: 1, noteCount: 0, stageChangeCount: 0, overdueFollowUpCount: 2, todayFollowUpCount: 0 }],
    ]),
  });
  mockGetCorporateDurations.mockResolvedValue(new Map([['agent-c', 600], ['agent-b', 60]]));
}

async function callSummary(roles: Parameters<typeof buildCallerContext>[0]['roles'], input?: { pipelineIds?: string[] }) {
  const caller = dashboardRouter.createCaller(buildCallerContext({ tenantId: TENANT_ID, userId: ADMIN_ID, roles }));
  const result = await caller.summary({ range: 'custom', dateFrom: '2026-09-01', dateTo: '2026-09-30', ...input });
  const { updatedAt, ...rest } = asJson(result) as Record<string, unknown>;

  expect(typeof updatedAt).toBe('string');

  return rest;
}

const okStatus = { ok: true, retried: false, reason: null, state: 'ok' };

const expectedSellerRows = [
  {
    userId: 'agent-c', name: 'Zarina', newLeads: null, qualifiedLeads: null, sales: 1, conversionPercent: null,
    agreementsAmount: 500000, incomeAmount: 500000, talkedSeconds: 600, callsCount: 0,
    followUpCount: null, noteCount: null, stageChangeCount: null, overdueFollowUpCount: null, todayFollowUpCount: null,
    crmAvailability: { mapped: false, completedTasks: false, pendingTasks: false, events: false },
  },
  {
    userId: 'agent-b', name: 'bobur', newLeads: 1, qualifiedLeads: 1, sales: 1, conversionPercent: 100,
    agreementsAmount: 6000000, incomeAmount: 6000000, talkedSeconds: 360, callsCount: 1,
    followUpCount: 0, noteCount: 0, stageChangeCount: 0, overdueFollowUpCount: 0, todayFollowUpCount: 0,
    crmAvailability: { mapped: true, completedTasks: true, pendingTasks: true, events: true },
  },
  {
    userId: 'agent-a', name: 'Aziz', newLeads: 2, qualifiedLeads: 1, sales: 2, conversionPercent: 100,
    agreementsAmount: 13000000, incomeAmount: 7500000, talkedSeconds: 120, callsCount: 3,
    followUpCount: 4, noteCount: 2, stageChangeCount: 5, overdueFollowUpCount: 1, todayFollowUpCount: 3,
    crmAvailability: { mapped: true, completedTasks: true, pendingTasks: true, events: true },
  },
  {
    userId: 'agent-d', name: 'Dilnoza', newLeads: 0, qualifiedLeads: 0, sales: 0, conversionPercent: 0,
    agreementsAmount: 0, incomeAmount: 0, talkedSeconds: 0, callsCount: 0,
    followUpCount: 1, noteCount: 0, stageChangeCount: 0, overdueFollowUpCount: 2, todayFollowUpCount: 0,
    crmAvailability: { mapped: true, completedTasks: true, pendingTasks: true, events: true },
  },
];

describe('dashboard.summary (characterization)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUpFixtures();
  });

  it('answers the admin view with every KPI, seller row and pie chart', async () => {
    const result = await callSummary(['Admin'], { pipelineIds: ['88'] });

    expect(result).toStrictEqual({
      range: 'custom',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      selectedPipelineIds: ['88'],
      sourceStatus: {
        amoContext: okStatus,
        catalog: okStatus,
        leads: okStatus,
        activity: { ok: false, retried: false, reason: 'mapping_missing', state: 'partial' },
        corporateCalls: okStatus,
      },
      unmappedSellerNames: ['Zarina'],
      sellerPerformance: expectedSellerRows,
      summary: {
        totalLeads: 5,
        qualifiedLeads: 2,
        nonQualifiedLeads: 3,
        totalCalls: 5,
        pendingNotifications: 3,
        activeIntegrations: 2,
        totalIncomeAmount: 14000000,
        newSalesCount: 4,
        newSalesAgreementAmount: 19500000,
        onlineSalesCount: 1,
        onlineSalesAgreementAmount: 10000000,
        onlineSalesIncomeAmount: 6000000,
        offlineSalesCount: 1,
        offlineSalesAgreementAmount: 6000000,
        offlineSalesIncomeAmount: 6000000,
        intensiveSalesCount: 1,
        intensiveSalesAgreementAmount: 3000000,
        intensiveSalesIncomeAmount: 1500000,
        qualifiedLeadSharePercent: 40,
        nonQualifiedLeadSharePercent: 60,
        conversionPercent: 80,
        followUpCount: 5,
        noteCount: 2,
        stageChangeCount: 5,
        overdueFollowUpCount: 3,
        todayFollowUpCount: 3,
      },
      pieCharts: {
        nonQualifiedByReason: {
          fieldKey: 'metadata:quality',
          fieldLabel: 'Metadata Quality',
          data: [
            { name: 'Sifatsiz', value: 2, color: expect.any(String) as unknown },
            { name: 'Spam', value: 1, color: expect.any(String) as unknown },
          ],
        },
        newLeadsBySource: {
          fieldKey: 'metadata:source',
          fieldLabel: 'Lead source',
          data: [
            { name: 'Instagram', value: 2, color: expect.any(String) as unknown },
            { name: 'Unknown source', value: 2, color: expect.any(String) as unknown },
            { name: 'Telegram', value: 1, color: expect.any(String) as unknown },
          ],
        },
      },
    });
    // Key order is part of the answer the web app renders.
    expect(Object.keys(result)).toEqual(['range', 'dateFrom', 'dateTo', 'selectedPipelineIds', 'sourceStatus', 'unmappedSellerNames', 'sellerPerformance', 'summary', 'pieCharts']);
    expect(JSON.stringify(result.sellerPerformance)).toBe(JSON.stringify(expectedSellerRows));
    expect(mockInvalidateCache).not.toHaveBeenCalled();
    expect(mockGetAmoLeads).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ pipelineIds: ['88'], responsibleUserIds: undefined }),
      amoContext,
      mockDb,
    );
  });

  it('shows lead and activity cells as unknown when amoCRM leads fail and activity is still loading', async () => {
    mockGetAmoLeads.mockRejectedValue(new Error('amo_leads_timeout'));
    mockGetActivityWithin.mockResolvedValue({ pending: true, stale: false, metrics: null });

    const result = await callSummary(['Admin']);
    const sourceStatus = result.sourceStatus as Record<string, unknown>;
    const rows = result.sellerPerformance as Array<Record<string, unknown>>;

    expect(result.selectedPipelineIds).toEqual(['77']);
    expect(sourceStatus.leads).toEqual({ ok: false, retried: true, reason: 'timeout', state: 'timeout' });
    expect(sourceStatus.activity).toEqual({ ok: false, retried: false, reason: 'activity_loading,mapping_missing', state: 'partial' });
    expect(rows.map((row) => [row.userId, row.newLeads, row.conversionPercent, row.followUpCount, row.crmAvailability])).toEqual([
      ['agent-c', null, null, null, { mapped: false, completedTasks: false, pendingTasks: false, events: false }],
      ['agent-b', null, null, null, { mapped: true, completedTasks: false, pendingTasks: false, events: false }],
      ['agent-a', null, null, null, { mapped: true, completedTasks: false, pendingTasks: false, events: false }],
      ['agent-d', null, null, null, { mapped: true, completedTasks: false, pendingTasks: false, events: false }],
    ]);
    expect((result.summary as Record<string, unknown>).totalLeads).toBe(0);
    expect(mockInvalidateCache).toHaveBeenCalledTimes(1);
  });

  it('marks partial activity when one amoCRM activity source failed', async () => {
    mockDb.user.findMany.mockResolvedValue(agentRows.filter((agent) => agent.amocrmResponsibleUserId));
    mockGetActivityWithin.mockImplementation((params: { diagnostics: Record<string, { ok: boolean; reason: string | null }> }) => {
      params.diagnostics.events = { ok: false, reason: 'network_error' };

      return Promise.resolve({ pending: false, stale: false, metrics: new Map() });
    });

    const result = await callSummary(['Admin']);
    const rows = result.sellerPerformance as Array<Record<string, unknown>>;

    expect((result.sourceStatus as Record<string, unknown>).activity).toEqual({ ok: false, retried: false, reason: 'network_error', state: 'partial' });
    expect(result.unmappedSellerNames).toEqual([]);
    expect(rows.map((row) => [row.userId, row.followUpCount, row.noteCount, row.overdueFollowUpCount])).toEqual([
      ['agent-b', 0, null, 0],
      ['agent-a', 0, null, 0],
      ['agent-d', 0, null, 0],
    ]);
  });

  it('reports every amoCRM source unavailable when amoCRM is not connected', async () => {
    mockGetTenantAmoCRMContext.mockResolvedValue(null);

    const result = await callSummary(['Admin']);

    expect(result.sourceStatus).toEqual({
      amoContext: { ok: false, retried: false, reason: 'amo_not_connected', state: 'unavailable' },
      catalog: { ok: false, retried: false, reason: 'amo_unavailable', state: 'unavailable' },
      leads: { ok: false, retried: false, reason: 'amo_unavailable', state: 'unavailable' },
      activity: { ok: false, retried: false, reason: 'amo_unavailable', state: 'unavailable' },
      corporateCalls: okStatus,
    });
    expect(result.selectedPipelineIds).toEqual([]);
    expect(mockGetAmoLeads).not.toHaveBeenCalled();
    expect(mockCollectCatalogFieldOptions).not.toHaveBeenCalled();
  });

  it('limits an agent to their own leads, calls and incomes', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: ADMIN_ID, amocrmResponsibleUserId: '501' });
    mockDb.user.findMany.mockResolvedValue([agentRows[0]]);

    const result = await callSummary(['OnlineAgent']);
    const summary = result.summary as Record<string, unknown>;

    expect(mockGetAmoLeads).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({ responsibleUserIds: ['501'] }),
      amoContext,
      mockDb,
    );
    expect(mockDb.notification.count).not.toHaveBeenCalled();
    expect(summary.pendingNotifications).toBe(0);
    expect(summary.activeIntegrations).toBe(0);
    // The scoped user's id is not one of the call rows' managers, so their total is 0.
    expect(summary.totalCalls).toBe(0);
  });

  it('limits a team leader to the group leads, incomes and agents', async () => {
    const groupMembers = [
      { id: 'agent-a', roles: ['OnlineAgent'], amocrmResponsibleUserId: '501' },
      { id: 'agent-b', roles: ['OnlineAgent'], amocrmResponsibleUserId: '502' },
    ];

    mockDb.user.findMany.mockImplementation((args: FindManyArgs) => (
      Promise.resolve((args.where?.roles as { hasSome?: string[] } | undefined)?.hasSome?.includes('OnlineTeamLeader') && !args.where?.isActive
        ? groupMembers
        : agentRows.slice(0, 2))
    ));

    const result = await callSummary(['OnlineTeamLeader']);
    const summary = result.summary as Record<string, unknown>;
    const incomeWhere = (mockDb.income.findMany.mock.calls[0] as [FindManyArgs])[0].where;
    const agentsWhere = (mockDb.user.findMany.mock.calls.at(-1) as [FindManyArgs])[0].where;

    expect(mockGetAmoLeads).toHaveBeenCalledWith(TENANT_ID, expect.objectContaining({ responsibleUserIds: ['501', '502'] }), amoContext, mockDb);
    expect(incomeWhere?.managerUserId).toEqual({ in: [ADMIN_ID, 'agent-a', 'agent-b'] });
    expect(agentsWhere?.id).toEqual({ in: [ADMIN_ID, 'agent-a', 'agent-b'] });
    expect(mockDb.notification.count).not.toHaveBeenCalled();
    // agent-a has 3 calls and agent-b 1; the unassigned call is not counted.
    expect(summary.totalCalls).toBe(4);
  });

  it('skips amoCRM leads for an agent without an amoCRM link', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: ADMIN_ID, amocrmResponsibleUserId: null });
    mockDb.user.findMany.mockResolvedValue([]);

    const result = await callSummary(['OfflineAgent']);

    expect(mockGetAmoLeads).not.toHaveBeenCalled();
    expect((result.sourceStatus as { leads: { reason: string } }).leads.reason).toBe('scope_unavailable');
  });

  it('hides money amounts from Tashkiliy-only users', async () => {
    const result = await callSummary(['Tashkiliy']);
    const summary = result.summary as Record<string, unknown>;
    const rows = result.sellerPerformance as Array<Record<string, unknown>>;

    expect([summary.totalIncomeAmount, summary.newSalesAgreementAmount, summary.onlineSalesIncomeAmount]).toEqual([0, 0, 0]);
    expect(summary.newSalesCount).toBe(4);
    expect(rows.map((row) => [row.agreementsAmount, row.incomeAmount])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
  });
});
