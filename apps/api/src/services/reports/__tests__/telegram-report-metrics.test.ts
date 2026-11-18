const getTenantAmoCRMContext = jest.fn();
const getAmoLeads = jest.fn();
const getCorporateCallDurationTotal = jest.fn();
const getCorporateCallDurationByManager = jest.fn();

jest.mock('../../integrations/amocrm-live', () => ({
  ...jest.requireActual<typeof import('../../integrations/amocrm-live')>('../../integrations/amocrm-live'),
  getTenantAmoCRMContext: (...args: unknown[]) => getTenantAmoCRMContext(...args),
}));
jest.mock('../../integrations/amocrm-lead-snapshot-read', () => ({
  getAmoLeads: (...args: unknown[]) => getAmoLeads(...args),
}));
jest.mock('../../corporate-call-durations', () => ({
  getCorporateCallDurationTotal: (...args: unknown[]) => getCorporateCallDurationTotal(...args),
  getCorporateCallDurationByManager: (...args: unknown[]) => getCorporateCallDurationByManager(...args),
}));

import type { DbClient } from '@dashboarduz/db';

import { collectMetrics, getSelectedPipelineIdsForTenant } from '../telegram-report/metrics';

const periodStart = new Date('2026-11-01T00:00:00.000Z');
const periodEnd = new Date('2026-11-30T23:59:59.999Z');

const tenantSettings = {
  dashboard: {
    qualifiedStageIds: [142, '200'],
    qualifiedValues: [],
    nonQualifiedValues: ['Qimmat', 'Uzoq'],
    reasonFieldKey: 'metadata:reason',
    sourceFieldKey: 'metadata:source',
  },
};

type IncomeFixture = {
  id: string;
  type: string;
  relatedDebtIncomeId?: string | null;
  managerUserId: string;
  paymentAmount: number | null;
  coursePriceAmount: number | null;
  debtAmount: number | null;
  courseId: string | null;
  course?: { category: string | null; name: string } | null;
  tariff?: { name: string } | null;
};

const incomes: IncomeFixture[] = [
  { id: 'i1', type: 'new_sale', managerUserId: 'u1', paymentAmount: 1000, coursePriceAmount: 5000, debtAmount: null, courseId: 'c1', course: { category: 'online', name: 'Python' } },
  { id: 'i2', type: 'debt_payment', relatedDebtIncomeId: 'i1', managerUserId: 'u1', paymentAmount: 300, coursePriceAmount: null, debtAmount: null, courseId: 'c1', course: { category: 'online', name: 'Python' } },
  { id: 'i3', type: 'new_sale', managerUserId: 'u2', paymentAmount: 200, coursePriceAmount: null, debtAmount: 800, courseId: 'c2', course: { category: null, name: 'Offline guruh' } },
  { id: 'i4', type: 'new_sale', managerUserId: 'u2', paymentAmount: 1, coursePriceAmount: 1, debtAmount: null, courseId: 'c2', course: { category: 'offline', name: 'Design' } },
  { id: 'i5', type: 'debt_payment', relatedDebtIncomeId: 'i4', managerUserId: 'u2', paymentAmount: 40, coursePriceAmount: null, debtAmount: null, courseId: 'c2', course: null },
  { id: 'i6', type: 'new_sale', managerUserId: 'u9', paymentAmount: 50, coursePriceAmount: 100, debtAmount: null, courseId: 'c3', course: { category: 'intensive', name: 'Bootcamp' } },
  { id: 'i7', type: 'new_sale', managerUserId: 'u4', paymentAmount: null, coursePriceAmount: 70, debtAmount: null, courseId: null, course: null },
];

const selectedCourseIncomes: IncomeFixture[] = [
  { id: 's1', type: 'new_sale', managerUserId: 'u1', paymentAmount: 10, coursePriceAmount: 100, debtAmount: null, courseId: 'c1', tariff: { name: 'Premium' } },
  { id: 's2', type: 'new_sale', managerUserId: 'u1', paymentAmount: 10, coursePriceAmount: 100, debtAmount: null, courseId: 'c1', tariff: null },
  { id: 's3', type: 'new_sale', managerUserId: 'u1', paymentAmount: 10, coursePriceAmount: 100, debtAmount: null, courseId: 'c1', tariff: { name: ' Premium ' } },
  { id: 's4', type: 'new_sale', managerUserId: 'u2', paymentAmount: 10, coursePriceAmount: 100, debtAmount: null, courseId: 'c2', tariff: { name: '  ' } },
  { id: 's5', type: 'new_sale', managerUserId: 'u2', paymentAmount: 1, coursePriceAmount: 1, debtAmount: null, courseId: 'c1', tariff: { name: 'Premium' } },
  { id: 's6', type: 'new_sale', managerUserId: 'u2', paymentAmount: 10, coursePriceAmount: 100, debtAmount: null, courseId: 'c9', tariff: { name: 'Lite' } },
  { id: 's7', type: 'new_sale', managerUserId: 'u2', paymentAmount: 10, coursePriceAmount: 100, debtAmount: null, courseId: 'c1', tariff: { name: 'Basic' } },
  { id: 's8', type: 'new_sale', managerUserId: 'u2', paymentAmount: 10, coursePriceAmount: 100, debtAmount: null, courseId: 'c1', tariff: { name: 'Basic' } },
];

const users = [
  { id: 'u1', name: 'Ali ', username: 'ali', roles: ['OnlineAgent'], amocrmResponsibleUserId: '500' },
  { id: 'u2', name: null, username: 'vali', roles: ['OfflineAgent'], amocrmResponsibleUserId: '501' },
  { id: 'u3', name: null, username: null, roles: ['Admin'], amocrmResponsibleUserId: '503' },
  { id: 'u4', name: 'Gani', username: 'gani', roles: ['TeamLeader'], amocrmResponsibleUserId: null },
  { id: 'u5', name: 'Bek', username: 'bek', roles: ['OnlineAgent'], amocrmResponsibleUserId: null },
];

const calls = [
  { managerUserId: 'u1', duration: 300 },
  { managerUserId: 'u1', duration: 30 },
  { managerUserId: 'u5', duration: 240 },
  { managerUserId: null, duration: 999 },
  { managerUserId: 'u2', duration: null },
  { managerUserId: 'u3', duration: 10 },
];

const liveLeads = [
  { id: 1, status_id: 142, responsible_user_id: 500, source: 'Instagram' },
  { id: 2, status_id: 143, responsible_user_id: 500, reason: 'qimmat ', source: 'Telegram' },
  { id: 3, status_id: 143, responsible_user_id: 501, reason: 'Other', source: 'Telegram' },
  { id: 4, status_id: '143', responsible_user_id: '', reason: 'Uzoq', source: 'Instagram' },
  { id: 5, status_id: '200', responsible_user_id: 502 },
  { id: 6, status_id: 143, responsible_user_id: 503, reason: 'UZOQ' },
  { id: 7, status_id: 77, responsible_user_id: 501, source: 'Instagram' },
];

type WhereArg = { where: Record<string, unknown> };

function createFakeDb() {
  const findIncomes = jest.fn(({ where }: WhereArg) => {
    const idFilter = where.id as { in: string[] } | undefined;

    if (idFilter) {
      return Promise.resolve([...incomes, ...selectedCourseIncomes].filter((row) => idFilter.in.includes(row.id) && row.type === 'new_sale'));
    }

    return Promise.resolve(where.courseId ? selectedCourseIncomes : incomes);
  });
  const db = {
    call: {
      aggregate: jest.fn(() => Promise.resolve({ _count: { id: 7 }, _sum: { duration: 900 } })),
      findMany: jest.fn(() => Promise.resolve(calls)),
    },
    income: { findMany: findIncomes },
    user: { findMany: jest.fn(() => Promise.resolve(users)) },
    course: {
      findMany: jest.fn(() => Promise.resolve([{ id: 'c2', name: 'Design' }, { id: 'c1', name: 'Python' }])),
    },
    lead: {
      count: jest.fn(({ where }: WhereArg) => Promise.resolve(where.status ? 4 : 9)),
      findMany: jest.fn(() => Promise.resolve([
        { status: '143', responsibleUserId: '500', metadata: { reason: 'Qimmat', source: 'Facebook' } },
        { status: '142', responsibleUserId: '501', metadata: { source: 'Facebook' } },
        { status: null, responsibleUserId: null, metadata: null },
        { status: '143', responsibleUserId: ' 501 ', metadata: { reason: 'Uzoq' } },
      ])),
    },
    integration: {
      findUnique: jest.fn((): Promise<{ config: unknown } | null> => Promise.resolve({ config: { selectedPipelineIds: [11, '12'] } })),
    },
  };

  return { db, asClient: db as unknown as DbClient };
}

const baseParams = {
  tenantId: 'tenant-1',
  tenantSettings,
  periodStart,
  periodEnd,
  selectedPipelineIds: ['11'],
  selectedReportCourseIds: [' c1 ', 'c2', 'c1', 'c3', 'c4'],
};

const expectedSales = {
  newSalesCount: 4,
  agreementTotal: 5970,
  incomeTotal: 1550,
  newSalesIncomeTotal: 1250,
  debtRepaymentIncomeTotal: 300,
  onlineSalesCount: 1,
  onlineAgreementTotal: 5000,
  offlineSalesCount: 1,
  offlineAgreementTotal: 800,
  intensiveSalesCount: 1,
  intensiveAgreementTotal: 100,
  totalCalls: 7,
  talkDurationSeconds: 960,
  selectedCourseRows: [
    {
      courseId: 'c1',
      courseName: 'Python',
      salesCount: 5,
      tariffBreakdown: [
        { label: 'Basic', value: 2 },
        { label: 'Premium', value: 2 },
        { label: "Tarif yo'q", value: 1 },
      ],
    },
    { courseId: 'c2', courseName: 'Design', salesCount: 1, tariffBreakdown: [{ label: "Tarif yo'q", value: 1 }] },
  ],
};

describe('collectMetrics', () => {
  beforeEach(() => {
    getTenantAmoCRMContext.mockReset();
    getAmoLeads.mockReset();
    getCorporateCallDurationTotal.mockReset().mockResolvedValue(60);
    getCorporateCallDurationByManager.mockReset().mockResolvedValue(new Map([['u1', 30], ['u4', 5]]));
  });

  it('counts live amoCRM leads, sales, calls and per-manager rows', async () => {
    const { db, asClient } = createFakeDb();
    const amoContext = { accessToken: 'tok' };

    getTenantAmoCRMContext.mockResolvedValue(amoContext);
    getAmoLeads.mockResolvedValue(liveLeads);

    const metrics = await collectMetrics({ ...baseParams, db: asClient });

    expect(metrics).toEqual({
      newLeads: 7,
      qualifiedLeads: 2,
      nonQualifiedLeads: 3,
      qualifiedShare: 28.57,
      nonQualifiedShare: 42.86,
      conversionPercent: 57.14,
      reasonBreakdown: [{ label: 'qimmat', value: 1 }, { label: 'Uzoq', value: 1 }, { label: 'UZOQ', value: 1 }],
      sourceBreakdown: [{ label: 'Instagram', value: 3 }, { label: 'Telegram', value: 2 }],
      ...expectedSales,
      managerRows: [
        { group: 'online', name: 'Ali', leads: 2, qualified: 1, nonQualified: 1, sales: 1, conversion: 50, agreementAmount: 5000, incomeAmount: 1300, callDurationSeconds: 360, callCount: 2, longCallCount: 1 },
        { group: 'offline', name: 'vali', leads: 2, qualified: 0, nonQualified: 0, sales: 1, conversion: 50, agreementAmount: 800, incomeAmount: 200, callDurationSeconds: 0, callCount: 1, longCallCount: 0 },
        { group: 'offline', name: 'Gani', leads: 0, qualified: 0, nonQualified: 0, sales: 1, conversion: 0, agreementAmount: 70, incomeAmount: 0, callDurationSeconds: 5, callCount: 0, longCallCount: 0 },
        { group: 'online', name: 'Bek', leads: 0, qualified: 0, nonQualified: 0, sales: 0, conversion: 0, agreementAmount: 0, incomeAmount: 0, callDurationSeconds: 240, callCount: 1, longCallCount: 1 },
      ],
    });
    expect(getAmoLeads).toHaveBeenCalledWith('tenant-1', {
      pipelineIds: ['11'],
      createdAtFrom: periodStart,
      createdAtTo: periodEnd,
    }, amoContext, asClient);
    expect(db.lead.count).not.toHaveBeenCalled();
    expect(db.course.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', id: { in: ['c1', 'c2', 'c3'] } },
      select: { id: true, name: true },
    });
  });

  it('falls back to the local leads when amoCRM is not connected', async () => {
    const { db, asClient } = createFakeDb();

    getTenantAmoCRMContext.mockResolvedValue(null);

    const metrics = await collectMetrics({ ...baseParams, db: asClient });

    expect(metrics).toMatchObject({
      newLeads: 9,
      qualifiedLeads: 4,
      nonQualifiedLeads: 2,
      qualifiedShare: 44.44,
      nonQualifiedShare: 22.22,
      conversionPercent: 44.44,
      reasonBreakdown: [{ label: 'Qimmat', value: 1 }, { label: 'Uzoq', value: 1 }],
      sourceBreakdown: [{ label: 'Facebook', value: 2 }],
    });
    expect(metrics.managerRows.map((row) => [row.name, row.leads, row.qualified, row.nonQualified])).toEqual([
      ['vali', 2, 1, 1],
      ['Ali', 1, 0, 1],
      ['Gani', 0, 0, 0],
      ['Bek', 0, 0, 0],
    ]);
    const where = {
      tenantId: 'tenant-1',
      amocrmId: { not: null },
      OR: [
        { externalCreatedAt: { gte: periodStart, lte: periodEnd } },
        { externalCreatedAt: null, createdAt: { gte: periodStart, lte: periodEnd } },
      ],
      pipelineId: { in: ['11'] },
    };

    expect(db.lead.count).toHaveBeenNthCalledWith(1, { where });
    expect(db.lead.count).toHaveBeenNthCalledWith(2, { where: { ...where, status: { in: ['142', '200'] } } });
    expect(db.lead.findMany).toHaveBeenCalledWith({
      where,
      select: { status: true, responsibleUserId: true, metadata: true },
      take: 10000,
    });
  });

  it('falls back to the local leads when the amoCRM read fails, and skips the empty pipeline filter', async () => {
    const { db, asClient } = createFakeDb();

    getTenantAmoCRMContext.mockResolvedValue({ accessToken: 'tok' });
    getAmoLeads.mockRejectedValue(new Error('amo down'));

    const metrics = await collectMetrics({ ...baseParams, selectedPipelineIds: [], db: asClient });

    expect(metrics.newLeads).toBe(9);
    expect(getAmoLeads).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ pipelineIds: undefined }), expect.anything(), asClient);
    expect(db.lead.count).toHaveBeenNthCalledWith(1, {
      where: expect.not.objectContaining({ pipelineId: expect.anything() }) as unknown,
    });
  });

  it('reads no settings, no qualified count and no course rows from empty input', async () => {
    const { db, asClient } = createFakeDb();

    getTenantAmoCRMContext.mockRejectedValue('context failure');

    const metrics = await collectMetrics({ ...baseParams, tenantSettings: [], selectedReportCourseIds: [' '], db: asClient });

    expect(metrics).toMatchObject({
      newLeads: 9,
      qualifiedLeads: 0,
      nonQualifiedLeads: 0,
      reasonBreakdown: [],
      sourceBreakdown: [],
      selectedCourseRows: [],
    });
    expect(db.lead.count).toHaveBeenCalledTimes(1);
    expect(db.course.findMany).not.toHaveBeenCalled();
  });
});

describe('getSelectedPipelineIdsForTenant', () => {
  it('reads the amoCRM integration pipeline ids as strings', async () => {
    const { db, asClient } = createFakeDb();

    await expect(getSelectedPipelineIdsForTenant('tenant-1', asClient)).resolves.toEqual(['11', '12']);
    expect(db.integration.findUnique).toHaveBeenCalledWith({
      where: { tenantId_type: { tenantId: 'tenant-1', type: 'amocrm' } },
      select: { config: true },
    });

    db.integration.findUnique.mockResolvedValueOnce({ config: { selectedPipelineIds: 'nope' } });
    await expect(getSelectedPipelineIdsForTenant('tenant-1', asClient)).resolves.toEqual([]);
    db.integration.findUnique.mockResolvedValueOnce(null);
    await expect(getSelectedPipelineIdsForTenant('tenant-1', asClient)).resolves.toEqual([]);
  });
});
