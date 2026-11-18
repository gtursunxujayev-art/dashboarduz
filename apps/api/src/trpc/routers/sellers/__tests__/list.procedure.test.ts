/**
 * Characterization test: pins the whole `sellers.list` answer on fixture data (amoCRM managers, leads, calls,
 * incomes, refunds, repeat customers and payment deadlines), with the database and amoCRM services mocked.
 */
import { sellersListCache } from '../../../../services/sellers/list-cache';
import { asJson, buildCallerContext } from '../../__tests__/procedure-test-context';
import { sellersRouter } from '../index';

type FindManyArgs = { where?: Record<string, unknown> };

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID = '00000000-0000-4000-8000-0000000000aa';

const mockGetTenantAmoCRMContext = jest.fn();
const mockGetAmoReference = jest.fn();
const mockGetAmoLeads = jest.fn();
const mockGetActivity = jest.fn();
const mockComputeLeadResponseTimes = jest.fn();
const mockGetCorporateDurations = jest.fn();

const mockDb = {
  corporateCallDuration: { aggregate: jest.fn() },
  user: { findMany: jest.fn(), findFirst: jest.fn() },
  call: { findMany: jest.fn() },
  income: { findMany: jest.fn() },
  incomeAdjustmentRequest: { findMany: jest.fn() },
};

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual<Record<string, unknown>>('@dashboarduz/db'),
  forTenant: () => mockDb,
}));
jest.mock('../../../../services/integrations/amocrm-live', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/integrations/amocrm-live'),
  getTenantAmoCRMContext: (...args: unknown[]) => mockGetTenantAmoCRMContext(...args) as unknown,
}));
jest.mock('../../../../services/integrations/amocrm-activity-snapshot-read', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/integrations/amocrm-activity-snapshot-read'),
  getAmoReference: (...args: unknown[]) => mockGetAmoReference(...args) as unknown,
}));
jest.mock('../../../../services/integrations/amocrm-lead-snapshot-read', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/integrations/amocrm-lead-snapshot-read'),
  getAmoLeads: (...args: unknown[]) => mockGetAmoLeads(...args) as unknown,
}));
jest.mock('../../../../services/integrations/amocrm-activity', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/integrations/amocrm-activity'),
  getAmoCRMActivityMetrics: (...args: unknown[]) => mockGetActivity(...args) as unknown,
}));
jest.mock('../../../../services/sellers/leads', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/sellers/leads'),
  computeLeadResponseTimes: (...args: unknown[]) => mockComputeLeadResponseTimes(...args) as unknown,
}));
jest.mock('../../../../services/corporate-call-durations', () => ({
  ...jest.requireActual<Record<string, unknown>>('../../../../services/corporate-call-durations'),
  getCorporateCallDurationByManager: (...args: unknown[]) => mockGetCorporateDurations(...args) as unknown,
}));

const onlineCourse = { category: 'online', name: 'Online-Iyul' };
const offlineCourse = { category: 'offline', name: 'Offline guruh' };

const incomeRows = [
  { managerUserId: 'u-a', type: 'new_sale', paymentAmount: 4_000_000, coursePriceAmount: 10_000_000, debtAmount: 6_000_000, id: 's1', relatedDebtIncomeId: null, course: onlineCourse },
  { managerUserId: 'u-a2', type: 'repayment', paymentAmount: 1_000_000, coursePriceAmount: null, debtAmount: null, id: 'r1', relatedDebtIncomeId: 's1', course: onlineCourse },
  { managerUserId: 'u-b', type: 'new_sale', paymentAmount: 3_000_000, coursePriceAmount: 3_000_000, debtAmount: 0, id: 's2', relatedDebtIncomeId: null, course: offlineCourse },
  { managerUserId: 'u-b', type: 'new_sale', paymentAmount: 1, coursePriceAmount: 1, debtAmount: 0, id: 's3', relatedDebtIncomeId: null, course: offlineCourse },
  { managerUserId: 'u-x', type: 'new_sale', paymentAmount: 9_000_000, coursePriceAmount: 9_000_000, debtAmount: 0, id: 's4', relatedDebtIncomeId: null, course: onlineCourse },
];

function setUpFixtures(): void {
  mockDb.corporateCallDuration.aggregate.mockResolvedValue({ _max: { updatedAt: new Date('2026-09-01T00:00:00.000Z') } });
  mockDb.user.findFirst.mockResolvedValue({ id: ADMIN_ID, amocrmResponsibleUserId: '502' });
  mockDb.user.findMany.mockResolvedValue([
    { id: 'u-a', amocrmResponsibleUserId: '501' },
    { id: 'u-a2', amocrmResponsibleUserId: ' 501 ' },
    { id: 'u-b', amocrmResponsibleUserId: '502' },
    { id: 'u-x', amocrmResponsibleUserId: null },
  ]);
  mockDb.call.findMany.mockResolvedValue([
    { managerUserId: 'u-a', duration: 120, direction: 'inbound', status: 'completed', startedAt: new Date('2026-09-02T05:00:00.000Z') },
    { managerUserId: 'u-a2', duration: null, direction: 'outbound', status: 'missed', startedAt: new Date('2026-09-03T05:00:00.000Z') },
    { managerUserId: 'u-b', duration: 300, direction: 'outbound', status: 'completed', startedAt: new Date('2026-09-03T05:00:00.000Z') },
    { managerUserId: null, duration: 999, direction: 'inbound', status: 'completed', startedAt: new Date('2026-09-03T05:00:00.000Z') },
  ]);
  mockDb.income.findMany.mockImplementation((args: FindManyArgs) => {
    const where = args.where ?? {};
    const idFilter = where.id as { in?: string[] } | undefined;

    if (idFilter?.in) {
      return Promise.resolve(incomeRows.filter((row) => idFilter.in?.includes(row.id) && row.type === 'new_sale'));
    }
    if (where.customerId) {
      return Promise.resolve([{ customerId: 'c2' }]);
    }
    if (where.deadline) {
      return Promise.resolve([
        { managerUserId: 'u-a', entryDate: new Date('2026-09-05T00:00:00.000Z'), deadline: new Date('2026-09-10T00:00:00.000Z'), paymentAmount: 1, remainingDebtAmount: 100 },
        { managerUserId: 'u-a', entryDate: new Date('2026-09-15T00:00:00.000Z'), deadline: new Date('2026-09-10T00:00:00.000Z'), paymentAmount: 1, remainingDebtAmount: 500 },
        { managerUserId: 'u-b', entryDate: new Date('2026-09-20T00:00:00.000Z'), deadline: new Date('2026-09-10T00:00:00.000Z'), paymentAmount: 1, remainingDebtAmount: 0 },
        { managerUserId: 'u-x', entryDate: new Date('2026-09-20T00:00:00.000Z'), deadline: new Date('2026-09-10T00:00:00.000Z'), paymentAmount: 1, remainingDebtAmount: 0 },
      ]);
    }
    if (where.type === 'new_sale') {
      return Promise.resolve([
        { managerUserId: 'u-a', customerId: 'c1' },
        { managerUserId: 'u-a', customerId: 'c1' },
        { managerUserId: 'u-a2', customerId: 'c2' },
        { managerUserId: 'u-b', customerId: 'c3' },
      ]);
    }

    return Promise.resolve(incomeRows);
  });
  mockDb.incomeAdjustmentRequest.findMany.mockResolvedValue([
    { income: { managerUserId: 'u-a' } },
    { income: { managerUserId: 'u-x' } },
  ]);
  mockGetTenantAmoCRMContext.mockResolvedValue({ accessToken: 'token', baseUrl: 'https://example.amocrm.ru', selectedPipelineIds: null });
  mockGetAmoReference.mockImplementation((_tenantId: string, kind: string) => Promise.resolve(kind === 'users'
    ? [
        { id: 501, name: 'Aziz', email: 'aziz@example.uz', is_active: true },
        { id: '502', login: 'bobur', rights: { is_admin: true } },
        { id: 503, name: 'Old', is_active: false },
        { id: 504 },
      ]
    : { _embedded: { pipelines: [{ id: 77 }, { id: '78' }] } }));
  mockGetAmoLeads.mockImplementation((_tenantId: string, query: { createdAtFrom?: Date }) => Promise.resolve(query.createdAtFrom
    ? [{ id: 11, responsible_user_id: 501 }, { id: 12, responsible_user_id: '501' }, { id: 13, responsible_user_id: 502 }, { id: 14, responsible_user_id: 999 }]
    : [
        { id: 1, status_id: 10, responsible_user_id: 501, price: 500 },
        { id: 2, status_id: 142, responsible_user_id: 501 },
        { id: 3, status_id: 143, responsible_user_id: 502 },
        { id: 4, status_id: 20, responsible_user_id: 502 },
        { id: 5, status_id: 30, responsible_user_id: 504 },
        { id: 6, status_id: 30, responsible_user_id: 999 },
      ]));
  mockGetActivity.mockResolvedValue(new Map([
    ['501', { followUpCount: 4, noteCount: 2, stageChangeCount: 5, overdueFollowUpCount: 1, todayFollowUpCount: 3 }],
  ]));
  mockComputeLeadResponseTimes.mockResolvedValue(new Map([
    ['501', { avgResponseSeconds: 90, medianResponseSeconds: 60, respondedCount: 2, totalCount: 2 }],
  ]));
  mockGetCorporateDurations.mockResolvedValue(new Map([['u-b', 60], ['u-x', 30]]));
}

async function callList(roles: Parameters<typeof buildCallerContext>[0]['roles']) {
  const caller = sellersRouter.createCaller(buildCallerContext({ tenantId: TENANT_ID, userId: ADMIN_ID, roles }));

  return asJson(await caller.list({ range: 'custom', dateFrom: '2026-09-01', dateTo: '2026-09-30' })) as Array<Record<string, unknown>>;
}

describe('sellers.list (characterization)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sellersListCache.clear();
    setUpFixtures();
  });

  it('answers every active amoCRM manager with lead, call, sales, refund, customer and deadline metrics', async () => {
    const result = await callList(['Admin']);

    expect(JSON.stringify(result)).toBe(JSON.stringify(EXPECTED_ADMIN_LIST));
    expect(mockGetAmoLeads).toHaveBeenCalledWith(
      TENANT_ID,
      { pipelineIds: ['77', '78'], responsibleUserIds: ['501', '502', '504'] },
      expect.anything(),
      mockDb,
    );
    expect(mockGetCorporateDurations).toHaveBeenCalledWith(expect.objectContaining({ managerUserIds: ['u-a', 'u-a2', 'u-b'] }));
  });

  it('serves a repeated request from the list cache', async () => {
    const first = await callList(['Admin']);
    const second = await callList(['Admin']);

    expect(second).toEqual(first);
    expect(mockGetAmoLeads).toHaveBeenCalledTimes(2);
  });

  it('limits an agent to their own amoCRM manager', async () => {
    const result = await callList(['OnlineAgent']);

    expect(result.map((row) => row.id)).toEqual(['502']);
  });

  it('refuses when amoCRM is not connected', async () => {
    mockGetTenantAmoCRMContext.mockResolvedValue(null);

    await expect(callList(['Admin'])).rejects.toThrow('AmoCRM integration is not connected.');
  });
});

/* Expected answers, filled from the procedure's output before the refactor and checked by hand. */
const EXPECTED_ADMIN_LIST = [
  {
    id: '501',
    name: 'Aziz',
    email: 'aziz@example.uz',
    phone: null,
    roles: ['Agent'],
    lastLoginAt: null,
    createdAt: '1970-01-01T00:00:00.000Z',
    metrics: {
      newLeads: 1,
      qualifiedLeads: 0,
      unqualifiedLeads: 0,
      salesCount: 1,
      totalLeads: 1,
      activeLeads: 1,
      wonLeads: 0,
      lostLeads: 0,
      conversionRate: 50,
      totalDealAmount: 10_000_000,
      averageDealAmount: 10_000_000,
      totalCalls: 2,
      inboundCalls: 1,
      outboundCalls: 1,
      missedCalls: 1,
      missedCallRate: 50,
      totalCallDuration: 120,
      averageCallDuration: 60,
      averageDailyCalls: 1,
      averageDailyCallDuration: 60,
      incomeAmount: 5_000_000,
      followUpCount: 4,
      noteCount: 2,
      stageChangeCount: 5,
      overdueFollowUpCount: 1,
      todayFollowUpCount: 3,
      newSalesCount: 1,
      newSalesAgreementAmount: 10_000_000,
      averageSalesCount: 0.03,
      averageAgreementAmount: 10_000_000,
      onlineSalesCount: 1,
      onlineSalesAgreementAmount: 10_000_000,
      onlineSalesIncomeAmount: 5_000_000,
      offlineSalesCount: 0,
      offlineSalesAgreementAmount: 0,
      offlineSalesIncomeAmount: 0,
      intensiveSalesCount: 0,
      intensiveSalesAgreementAmount: 0,
      intensiveSalesIncomeAmount: 0,
      totalPaidAmount: 5_000_000,
      totalAgreementAmount: 10_000_000,
      debtCollectionRate: 50,
      newLeadsInRange: 2,
      refundCount: 1,
      refundRate: 100,
      newCustomers: 1,
      repeatCustomers: 1,
      newCustomerRate: 50,
      deadlineTotal: 2,
      deadlineMet: 1,
      deadlineAdherenceRate: 50,
      leadResponseTime: { avgResponseSeconds: 90, medianResponseSeconds: 60, respondedCount: 2, totalCount: 2 },
    },
  },
  {
    id: '502',
    name: 'bobur',
    email: null,
    phone: null,
    roles: ['Manager'],
    lastLoginAt: null,
    createdAt: '1970-01-01T00:00:00.000Z',
    metrics: {
      newLeads: 1,
      qualifiedLeads: 0,
      unqualifiedLeads: 0,
      salesCount: 1,
      totalLeads: 1,
      activeLeads: 1,
      wonLeads: 0,
      lostLeads: 0,
      conversionRate: 100,
      totalDealAmount: 3_000_000,
      averageDealAmount: 3_000_000,
      totalCalls: 1,
      inboundCalls: 0,
      outboundCalls: 1,
      missedCalls: 0,
      missedCallRate: 0,
      totalCallDuration: 360,
      averageCallDuration: 360,
      averageDailyCalls: 1,
      averageDailyCallDuration: 360,
      incomeAmount: 3_000_000,
      followUpCount: 0,
      noteCount: 0,
      stageChangeCount: 0,
      overdueFollowUpCount: 0,
      todayFollowUpCount: 0,
      newSalesCount: 1,
      newSalesAgreementAmount: 3_000_000,
      averageSalesCount: 0.03,
      averageAgreementAmount: 3_000_000,
      onlineSalesCount: 0,
      onlineSalesAgreementAmount: 0,
      onlineSalesIncomeAmount: 0,
      offlineSalesCount: 1,
      offlineSalesAgreementAmount: 3_000_000,
      offlineSalesIncomeAmount: 3_000_000,
      intensiveSalesCount: 0,
      intensiveSalesAgreementAmount: 0,
      intensiveSalesIncomeAmount: 0,
      totalPaidAmount: 3_000_000,
      totalAgreementAmount: 3_000_000,
      debtCollectionRate: 100,
      newLeadsInRange: 1,
      refundCount: 0,
      refundRate: 0,
      newCustomers: 1,
      repeatCustomers: 0,
      newCustomerRate: 100,
      deadlineTotal: 1,
      deadlineMet: 1,
      deadlineAdherenceRate: 100,
      leadResponseTime: { avgResponseSeconds: 0, medianResponseSeconds: 0, respondedCount: 0, totalCount: 0 },
    },
  },
  {
    id: '504',
    name: 'Manager 504',
    email: null,
    phone: null,
    roles: ['Agent'],
    lastLoginAt: null,
    createdAt: '1970-01-01T00:00:00.000Z',
    metrics: {
      newLeads: 1,
      qualifiedLeads: 0,
      unqualifiedLeads: 0,
      salesCount: 0,
      totalLeads: 1,
      activeLeads: 1,
      wonLeads: 0,
      lostLeads: 0,
      conversionRate: 0,
      totalDealAmount: 0,
      averageDealAmount: 0,
      totalCalls: 0,
      inboundCalls: 0,
      outboundCalls: 0,
      missedCalls: 0,
      missedCallRate: 0,
      totalCallDuration: 0,
      averageCallDuration: 0,
      averageDailyCalls: 0,
      averageDailyCallDuration: 0,
      incomeAmount: 0,
      followUpCount: 0,
      noteCount: 0,
      stageChangeCount: 0,
      overdueFollowUpCount: 0,
      todayFollowUpCount: 0,
      newSalesCount: 0,
      newSalesAgreementAmount: 0,
      averageSalesCount: 0,
      averageAgreementAmount: 0,
      onlineSalesCount: 0,
      onlineSalesAgreementAmount: 0,
      onlineSalesIncomeAmount: 0,
      offlineSalesCount: 0,
      offlineSalesAgreementAmount: 0,
      offlineSalesIncomeAmount: 0,
      intensiveSalesCount: 0,
      intensiveSalesAgreementAmount: 0,
      intensiveSalesIncomeAmount: 0,
      totalPaidAmount: 0,
      totalAgreementAmount: 0,
      debtCollectionRate: 0,
      newLeadsInRange: 0,
      refundCount: 0,
      refundRate: 0,
      newCustomers: 0,
      repeatCustomers: 0,
      newCustomerRate: 0,
      deadlineTotal: 0,
      deadlineMet: 0,
      deadlineAdherenceRate: 0,
      leadResponseTime: { avgResponseSeconds: 0, medianResponseSeconds: 0, respondedCount: 0, totalCount: 0 },
    },
  },
];
