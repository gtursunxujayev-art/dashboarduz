import { systemPrisma } from '@dashboarduz/db';

import {
  buildStatusFilters,
  computeLeadResponseTimes,
  fetchLeadsByStatusFilters,
  getSelectedPipelines,
  loadSellerPipelineContext,
} from '../leads';
import { buildSellersListCacheKey } from '../list-cache';
import {
  asString,
  buildMetrics,
  excludeTechnicalSellerIncomes,
  getLeadResponsibleId,
  getManagerUserIdsMap,
  parseAmoDate,
  summarizeSellerIncomeMetrics,
  toManagerRole,
} from '../metrics';
import { buildSellerReportPdf } from '../report-pdf';

// `systemPrisma` below is this mock (the module is mocked), passed where the services take a DbClient.
const mockDb = {
  user: { findMany: jest.fn() },
  income: { findMany: jest.fn() },
};
const mockGetAmoEvents = jest.fn();
const mockGetAmoReference = jest.fn();
const mockGetAmoLeads = jest.fn();

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
}));
jest.mock('../../integrations/amocrm-activity-snapshot-read', () => ({
  getAmoEvents: (...args: unknown[]) => mockGetAmoEvents(...args),
  getAmoReference: (...args: unknown[]) => mockGetAmoReference(...args),
}));
jest.mock('../../integrations/amocrm-lead-snapshot-read', () => ({
  getAmoLeads: (...args: unknown[]) => mockGetAmoLeads(...args),
}));

const access = { integrationId: 'amo-1', accessToken: 't', config: {}, selectedPipelineIds: null };
const rangeStart = new Date('2026-11-01T00:00:00.000Z');
const rangeEnd = new Date('2026-11-11T00:00:00.000Z');

beforeEach(() => {
  jest.resetAllMocks();
});

describe('seller metric helpers', () => {
  it('normalizes strings and amoCRM dates', () => {
    expect(asString('  7 ')).toBe('7');
    expect(asString('   ')).toBeNull();
    expect(asString(null)).toBeNull();
    expect(asString(501)).toBe('501');
    expect(parseAmoDate(1_762_000_000)).toEqual(new Date(1_762_000_000_000));
    expect(parseAmoDate(1_762_000_000_123)).toEqual(new Date(1_762_000_000_123));
    expect(parseAmoDate('1762000000')).toEqual(new Date(1_762_000_000_000));
    expect(parseAmoDate('2026-11-05T10:00:00Z')).toEqual(new Date('2026-11-05T10:00:00Z'));
    expect(parseAmoDate('not a date')).toEqual(new Date(0));
    expect(parseAmoDate(undefined)).toEqual(new Date(0));
    expect(getLeadResponsibleId({ responsible_user_id: 501 })).toBe('501');
    expect(toManagerRole({ rights: { is_admin: true } })).toEqual(['Manager']);
    expect(toManagerRole({})).toEqual(['Agent']);
  });

  it('sums sales and income per course category with agreements only on sales', () => {
    const metrics = summarizeSellerIncomeMetrics([
      { type: 'new_sale', paymentAmount: 1_000_000, coursePriceAmount: 3_000_000, course: { category: 'online' } },
      { type: 'new_sale', paymentAmount: 500_000, coursePriceAmount: null, debtAmount: 2_000_000, course: { category: 'offline' } },
      { type: 'new_sale', paymentAmount: 2_000_000, coursePriceAmount: 2_000_000, course: { name: 'Intensiv' } },
      { type: 'repayment', paymentAmount: 250_000, coursePriceAmount: 3_000_000, course: { category: 'online' } },
      { type: 'new_sale', paymentAmount: null, coursePriceAmount: 100, course: null },
    ], rangeStart, rangeEnd);

    expect(metrics).toEqual({
      newSalesCount: 4,
      newSalesAgreementAmount: 7_000_100,
      incomeAmount: 3_750_000,
      // 4 sales over 10 days
      averageSalesCount: 0.4,
      averageAgreementAmount: 1_750_025,
      onlineSalesCount: 1,
      onlineSalesAgreementAmount: 3_000_000,
      onlineSalesIncomeAmount: 1_250_000,
      offlineSalesCount: 1,
      offlineSalesAgreementAmount: 2_000_000,
      offlineSalesIncomeAmount: 500_000,
      intensiveSalesCount: 1,
      intensiveSalesAgreementAmount: 2_000_000,
      intensiveSalesIncomeAmount: 2_000_000,
      totalPaidAmount: 3_750_000,
      totalAgreementAmount: 7_000_100,
      debtCollectionRate: 53.57,
    });
  });

  it('returns zeros for no incomes and treats an empty range as one day', () => {
    const empty = summarizeSellerIncomeMetrics([], rangeEnd, rangeStart);

    expect(empty).toMatchObject({ newSalesCount: 0, averageSalesCount: 0, averageAgreementAmount: 0, debtCollectionRate: 0 });

    const sameDay = summarizeSellerIncomeMetrics(
      [{ type: 'new_sale', paymentAmount: 1, coursePriceAmount: 10, course: { category: 'online' } }],
      rangeStart,
      rangeStart,
    );

    expect(sameDay.averageSalesCount).toBe(1);
  });

  it('builds lead, deal and call metrics', () => {
    const metrics = buildMetrics(
      [{ id: 1 }, { id: 2 }],
      [{ id: 3, price: 1_000_000 }, { id: 4, price: '500000' }],
      [{ id: 5 }],
      [
        { duration: 120, direction: 'outbound', status: 'completed', startedAt: new Date('2026-11-02T08:00:00Z') },
        { duration: 0, direction: 'inbound', status: 'missed', startedAt: new Date('2026-11-02T09:00:00Z') },
        { duration: null, direction: 'outbound', status: 'missed', startedAt: new Date('2026-11-03T09:00:00Z') },
        { duration: 60, direction: 'outbound', status: 'completed', startedAt: null },
      ],
      { manualDurationSeconds: 20, activityMetrics: { followUpCount: 3, noteCount: 2, stageChangeCount: 1, overdueFollowUpCount: 0, todayFollowUpCount: 4 } },
    );

    expect(metrics).toEqual({
      newLeads: 5,
      qualifiedLeads: 2,
      unqualifiedLeads: 1,
      salesCount: 2,
      totalLeads: 5,
      activeLeads: 2,
      wonLeads: 2,
      lostLeads: 1,
      conversionRate: 40,
      totalDealAmount: 1_500_000,
      averageDealAmount: 750_000,
      totalCalls: 4,
      inboundCalls: 1,
      outboundCalls: 3,
      missedCalls: 2,
      missedCallRate: 50,
      totalCallDuration: 200,
      averageCallDuration: 50,
      averageDailyCalls: 2,
      averageDailyCallDuration: 100,
      incomeAmount: 1_500_000,
      followUpCount: 3,
      noteCount: 2,
      stageChangeCount: 1,
      overdueFollowUpCount: 0,
      todayFollowUpCount: 4,
    });
  });

  it('neutralizes lead outcomes and takes an income override', () => {
    const metrics = buildMetrics([{ id: 1 }], [{ id: 2 }], [{ id: 3 }], [], { neutralizeLeadOutcomes: true, incomeAmountOverride: 42.5 });

    expect(metrics).toMatchObject({
      newLeads: 1,
      qualifiedLeads: 0,
      unqualifiedLeads: 0,
      salesCount: 0,
      totalLeads: 1,
      wonLeads: 0,
      lostLeads: 0,
      conversionRate: 0,
      totalDealAmount: 0,
      averageCallDuration: 0,
      averageDailyCalls: 0,
      incomeAmount: 42.5,
      followUpCount: 0,
    });
  });

  it('maps amoCRM managers to their active users', async () => {
    mockDb.user.findMany.mockResolvedValue([
      { id: 'u1', amocrmResponsibleUserId: '501' },
      { id: 'u2', amocrmResponsibleUserId: '501' },
      { id: 'u3', amocrmResponsibleUserId: ' ' },
      { id: 'u4', amocrmResponsibleUserId: '502' },
    ]);

    const map = await getManagerUserIdsMap('t1', ['501', '502'], systemPrisma);

    expect(Array.from(map.entries())).toEqual([['501', ['u1', 'u2']], ['502', ['u4']]]);
    expect(mockDb.user.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', isActive: true, amocrmResponsibleUserId: { in: ['501', '502'] } },
      select: { id: true, amocrmResponsibleUserId: true },
    });
    expect((await getManagerUserIdsMap('t1', [], systemPrisma)).size).toBe(0);
    expect(mockDb.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('drops technical sales and their repayments from seller incomes', async () => {
    mockDb.income.findMany.mockResolvedValue([
      { id: 'tech', type: 'new_sale', coursePriceAmount: 1, debtAmount: 1, paymentAmount: 1 },
      { id: 'real', type: 'new_sale', coursePriceAmount: 3_000_000, debtAmount: 3_000_000, paymentAmount: 1_000_000 },
    ]);
    const rows = [
      { id: 'tech', type: 'new_sale', relatedDebtIncomeId: null },
      { id: 'tech-repay', type: 'repayment', relatedDebtIncomeId: 'tech' },
      { id: 'real', type: 'new_sale', relatedDebtIncomeId: null },
      { type: 'repayment', relatedDebtIncomeId: 'tech' },
    ];

    const kept = await excludeTechnicalSellerIncomes('t1', rows, systemPrisma);

    expect(kept.map((row) => row.id ?? 'no-id')).toEqual(['real', 'no-id']);

    mockDb.income.findMany.mockResolvedValue([]);
    expect(await excludeTechnicalSellerIncomes('t1', rows, systemPrisma)).toBe(rows);
  });
});

describe('seller pipelines and leads', () => {
  const pipelines = [
    { id: 10, _embedded: { statuses: [{ id: 1 }, { id: 2 }, { id: 142 }, { id: 143 }] } },
    { id: '20', _embedded: { statuses: [{ id: 2 }, { id: 3 }] } },
    { id: 30 },
  ];

  it('uses the selected pipelines or else every pipeline', () => {
    expect(getSelectedPipelines([' 10 ', ''], pipelines)).toEqual(['10']);
    expect(getSelectedPipelines(null, pipelines)).toEqual(['10', '20', '30']);
  });

  it('builds unique pipeline/status filters for statuses that exist in each selected pipeline', () => {
    expect(buildStatusFilters(['10', '20'], pipelines, ['2', '3', '2'])).toEqual([
      { pipelineId: '10', statusId: '2' },
      { pipelineId: '20', statusId: '2' },
      { pipelineId: '20', statusId: '3' },
    ]);
    expect(buildStatusFilters([], pipelines, ['2'])).toEqual([]);
    expect(buildStatusFilters(['10'], pipelines, [])).toEqual([]);
  });

  it('loads users, pipelines and the in-progress status filters', async () => {
    mockGetAmoReference.mockImplementation((_tenant: string, kind: string) => Promise.resolve(kind === 'users'
      ? [{ id: 501 }]
      : { _embedded: { pipelines } }));

    const context = await loadSellerPipelineContext('t1', { ...access, selectedPipelineIds: ['10'] }, systemPrisma);

    expect(context.amocrmUsers).toEqual([{ id: 501 }]);
    expect(context.selectedPipelineIds).toEqual(['10']);
    // Won (142) and lost (143) are not "in progress".
    expect(context.activeStatusFilters).toEqual([
      { pipelineId: '10', statusId: '1' },
      { pipelineId: '10', statusId: '2' },
    ]);
  });

  it('copes with a pipelines response without pipelines', async () => {
    mockGetAmoReference.mockResolvedValue({});

    const context = await loadSellerPipelineContext('t1', access, systemPrisma);

    expect(context).toMatchObject({ pipelines: [], selectedPipelineIds: [], activeStatusFilters: [] });
  });

  it('reads snapshot leads only when there is something to filter by', async () => {
    mockGetAmoLeads.mockResolvedValue([{ id: 1 }]);

    expect(await fetchLeadsByStatusFilters('t1', systemPrisma, access, [], [{ pipelineId: '10', statusId: '1' }], ['501'])).toEqual([]);
    expect(await fetchLeadsByStatusFilters('t1', systemPrisma, access, ['10'], [], ['501'])).toEqual([]);
    expect(await fetchLeadsByStatusFilters('t1', systemPrisma, access, ['10'], [{ pipelineId: '10', statusId: '1' }], [])).toEqual([]);
    expect(mockGetAmoLeads).not.toHaveBeenCalled();

    expect(await fetchLeadsByStatusFilters('t1', systemPrisma, access, ['10'], [{ pipelineId: '10', statusId: '1' }], ['501'], rangeStart, rangeEnd))
      .toEqual([{ id: 1 }]);
    expect(mockGetAmoLeads).toHaveBeenCalledWith('t1', {
      pipelineIds: ['10'],
      statusFilters: [{ pipelineId: '10', statusId: '1' }],
      responsibleUserIds: ['501'],
      createdAtFrom: rangeStart,
      createdAtTo: rangeEnd,
    }, access, systemPrisma);
  });
});

describe('computeLeadResponseTimes', () => {
  const base = 1_762_000_000;

  it('measures the time from lead creation to the first later event, per manager', async () => {
    mockGetAmoEvents.mockResolvedValue([
      { entity_id: 1, created_at: base + 60 },
      { entity_id: 1, created_at: base + 30 },
      { entity_id: 2, created_at: String(base + 300) },
      { entity_id: 3, created_at: (base + 900) * 1000 },
      { entity_id: 4, created_at: base - 10 },
      { entity_id: '', created_at: base },
      { entity_id: 5, created_at: 'soon' },
    ]);

    const result = await computeLeadResponseTimes({
      tenantId: 't1',
      access,
      db: systemPrisma,
      managerIds: ['501', '502'],
      newLeads: [
        { id: 1, responsible_user_id: 501, created_at: base },
        { id: 2, responsible_user_id: 501, created_at: base },
        { id: 3, responsible_user_id: 501, created_at: base },
        { id: 4, responsible_user_id: 502, created_at: base },
        { id: 6, responsible_user_id: 999, created_at: base },
      ],
      rangeStart,
      rangeEnd,
    });

    expect(mockGetAmoEvents).toHaveBeenCalledWith('t1', { dateFrom: rangeStart, dateTo: rangeEnd, userIds: ['501', '502'], entityType: 'lead' }, access, systemPrisma);
    // 501: responses after 30 s, 300 s and 900 s -> average 410, median 300.
    expect(result.get('501')).toEqual({ avgResponseSeconds: 410, medianResponseSeconds: 300, respondedCount: 3, totalCount: 3 });
    // 502's only event happened before the lead was created.
    expect(result.get('502')).toEqual({ avgResponseSeconds: 0, medianResponseSeconds: 0, respondedCount: 0, totalCount: 1 });
    expect(result.has('999')).toBe(false);
  });

  it('takes the mean of the two middle values for an even count', async () => {
    mockGetAmoEvents.mockResolvedValue([{ entity_id: 1, created_at: base + 10 }, { entity_id: 2, created_at: base + 20 }]);

    const result = await computeLeadResponseTimes({
      tenantId: 't1',
      access,
      db: systemPrisma,
      managerIds: ['501'],
      newLeads: [{ id: 1, responsible_user_id: 501, created_at: base }, { id: 2, responsible_user_id: 501, created_at: base }],
      rangeStart,
      rangeEnd,
    });

    expect(result.get('501')).toEqual({ avgResponseSeconds: 15, medianResponseSeconds: 15, respondedCount: 2, totalCount: 2 });
  });

  it('returns nothing without leads or managers, or when events cannot be read', async () => {
    const params = { tenantId: 't1', access, db: systemPrisma, rangeStart, rangeEnd };

    expect((await computeLeadResponseTimes({ ...params, managerIds: ['501'], newLeads: [] })).size).toBe(0);
    expect((await computeLeadResponseTimes({ ...params, managerIds: [], newLeads: [{ id: 1 }] })).size).toBe(0);
    mockGetAmoEvents.mockRejectedValue(new Error('snapshot missing'));
    expect((await computeLeadResponseTimes({ ...params, managerIds: ['501'], newLeads: [{ id: 1, responsible_user_id: 501 }] })).size).toBe(0);
  });
});

describe('seller report PDF and list cache key', () => {
  it('writes a one-page PDF with escaped text and a valid xref table', () => {
    const metrics = {
      ...buildMetrics([], [], [], [{ duration: 90, direction: 'outbound', status: 'completed' }]),
      ...summarizeSellerIncomeMetrics([{ type: 'new_sale', paymentAmount: 1_000_000, coursePriceAmount: 3_000_000, course: { category: 'online' } }], rangeStart, rangeEnd),
    };
    const pdf = buildSellerReportPdf({
      seller: { id: 'u1', name: 'Ali (Lead) Valiyev', email: null, phone: null, roles: ['Agent'], lastLoginAt: null, createdAt: rangeStart },
      metrics,
      rangeStart,
      rangeEnd,
    }).toString('utf8');

    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('(Ali \\(Lead\\) Valiyev ? agent report) Tj');
    expect(pdf).toContain('(Sales count: 1) Tj');
    expect(pdf).toContain('(Calls: 1) Tj');
    expect(pdf).toContain('(Call duration: 90 seconds) Tj');
    const xrefOffset = Number(pdf.match(/startxref\n(\d+)\n/)?.[1]);

    expect(pdf.slice(xrefOffset, xrefOffset + 4)).toBe('xref');
    expect(pdf).toContain('xref\n0 6\n');
  });

  it('keys the sellers list cache by every input, with pipelines in a stable order', () => {
    expect(buildSellersListCacheKey('t1', null, ['20', '10'], 'month', 'rev1')).toBe('t1|all|10,20|month|rev1||');
    expect(buildSellersListCacheKey('t1', '501', ['10'], 'custom', 'rev2', '2026-11-01', '2026-11-10'))
      .toBe('t1|501|10|custom|rev2|2026-11-01|2026-11-10');
  });
});
