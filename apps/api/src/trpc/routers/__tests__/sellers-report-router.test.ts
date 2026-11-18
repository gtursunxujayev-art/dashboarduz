import { TRPCError } from '@trpc/server';
import { request, response } from 'express';

import type { Context } from '../../context';
import { router } from '../../trpc';
import { sellerReportProcedures } from '../sellers/report';

// sellers.sendPdfToAdmins: builds one seller's PDF report (leads, calls by managerUserId, corporate call time,
// income, amoCRM activity) and sends it to every admin with a Telegram chat. amoCRM reads are mocked.
const mockScopeUser = jest.fn();
const mockDb = {
  user: {
    findFirst: jest.fn((args: { select: Record<string, boolean> }) => (
      args.select.amocrmResponsibleUserId ? mockScopeUser(args) : Promise.resolve({ id: ACTOR_ID })
    )),
    findMany: jest.fn((args: { where: Record<string, unknown> }) => {
      if (args.where.roles) return Promise.resolve(mockAdmins);
      if (args.where.amocrmResponsibleUserId === '501') return Promise.resolve([{ id: 'u-501' }]);

      return Promise.resolve([{ id: 'u-501', amocrmResponsibleUserId: '501' }]);
    }),
  },
  integration: { findUnique: jest.fn() },
  call: { findMany: jest.fn() },
  income: { findMany: jest.fn() },
  corporateCallDuration: { groupBy: jest.fn() },
};
let mockAdmins: Array<{ telegramId: string | null; name: string }> = [];
const mockAmoContext = jest.fn();
const mockAmoReference = jest.fn();
const mockAmoLeads = jest.fn();
const mockActivity = jest.fn();
const mockSendDocument = jest.fn();

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
  forTenant: () => mockDb,
}));
jest.mock('../../../services/integrations/amocrm-live', () => ({
  getTenantAmoCRMContext: (...args: unknown[]) => mockAmoContext(...args),
}));
jest.mock('../../../services/integrations/amocrm-activity-snapshot-read', () => ({
  getAmoReference: (...args: unknown[]) => mockAmoReference(...args),
  getAmoEvents: jest.fn(),
}));
jest.mock('../../../services/integrations/amocrm-lead-snapshot-read', () => ({
  getAmoLeads: (...args: unknown[]) => mockAmoLeads(...args),
}));
jest.mock('../../../services/integrations/amocrm-activity', () => ({
  getAmoCRMActivityMetrics: (...args: unknown[]) => mockActivity(...args),
}));
jest.mock('../../../services/integrations/telegram', () => ({
  telegramService: { sendDocument: (...args: unknown[]) => mockSendDocument(...args) },
}));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';

const testRouter = router(sellerReportProcedures);

function caller(roles: Array<'Admin' | 'Agent'>) {
  const ctx: Context = { req: request, res: response, user: { userId: ACTOR_ID, tenantId: TENANT_ID, roles }, tenantId: TENANT_ID };

  return testRouter.createCaller(ctx);
}

async function rejection(promise: Promise<unknown>): Promise<TRPCError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error;
    throw error;
  }
  throw new Error('Expected the procedure to throw');
}

const savedEnv = { ...process.env };

beforeEach(() => {
  mockScopeUser.mockReset();
  mockDb.user.findMany.mockClear();
  mockDb.integration.findUnique.mockReset();
  mockDb.call.findMany.mockReset();
  mockDb.income.findMany.mockReset();
  mockDb.corporateCallDuration.groupBy.mockReset();
  mockAmoContext.mockReset();
  mockAmoReference.mockReset();
  mockAmoLeads.mockReset();
  mockActivity.mockReset();
  mockSendDocument.mockReset();
  process.env = { ...savedEnv, TELEGRAM_BOT_TOKEN: '12345:bot' };
  mockAdmins = [{ telegramId: ' 9001 ', name: 'Boss' }, { telegramId: '', name: 'No chat' }, { telegramId: '9002', name: 'Owner' }];
  mockDb.integration.findUnique.mockResolvedValue(null);
  mockAmoContext.mockResolvedValue({ integrationId: 'amo-1', accessToken: 't', baseUrl: 'https://acme.amocrm.ru', config: {}, selectedPipelineIds: ['10'] });
  mockAmoReference.mockImplementation((_tenant: string, kind: string) => Promise.resolve(kind === 'users'
    ? [{ id: 501, name: 'Ali (Sotuv)', email: 'ali@x.uz' }]
    : { _embedded: { pipelines: [{ id: 10, _embedded: { statuses: [{ id: 1 }, { id: 142 }] } }] } }));
  mockAmoLeads.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  mockDb.call.findMany.mockResolvedValue([
    { duration: 120, direction: 'outbound', status: 'completed', startedAt: new Date('2026-11-10T06:00:00Z') },
    { duration: 0, direction: 'inbound', status: 'missed', startedAt: new Date('2026-11-11T06:00:00Z') },
  ]);
  mockDb.income.findMany
    .mockResolvedValueOnce([{ id: 's1', type: 'new_sale', relatedDebtIncomeId: null, paymentAmount: 1_000_000, coursePriceAmount: 3_000_000, debtAmount: 3_000_000, course: { category: 'online', name: 'Online' } }])
    .mockResolvedValue([]);
  mockDb.corporateCallDuration.groupBy.mockResolvedValue([{ managerUserId: 'u-501', _sum: { durationSeconds: 300 } }]);
  mockActivity.mockResolvedValue(new Map([['501', { followUpCount: 4, noteCount: 2, stageChangeCount: 1, overdueFollowUpCount: 0, todayFollowUpCount: 1 }]]));
  mockSendDocument.mockResolvedValue({ ok: true });
});

afterAll(() => {
  process.env = savedEnv;
});

describe('sellers.sendPdfToAdmins', () => {
  it("sends the seller's PDF to every admin with a Telegram chat", async () => {
    expect(await caller(['Admin']).sendPdfToAdmins({ id: '501', range: 'month' })).toEqual({ success: true, recipientCount: 2 });

    expect(mockSendDocument.mock.calls.map((call) => call[1])).toEqual(['9001', '9002']);
    const [token, , pdf, fileName, caption] = mockSendDocument.mock.calls[0];

    expect([token, fileName, caption]).toEqual(['12345:bot', 'seller-report-Ali-Sotuv-.pdf', 'Ali (Sotuv) hisobot PDF']);
    const text = Buffer.from(pdf).toString('utf8');

    expect(text).toContain('(Sales count: 1) Tj');
    expect(text).toContain('(Calls: 2) Tj');
    // 120 s of amoCRM calls + 300 s corporate time.
    expect(text).toContain('(Call duration: 420 seconds) Tj');
    expect(text).toContain('(Follow-ups done: 4) Tj');
    expect(mockDb.call.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: TENANT_ID, provider: 'amocrm', managerUserId: { in: ['u-501'] } });
    expect(mockAmoLeads.mock.calls[0][1]).toMatchObject({ pipelineIds: ['10'], statusFilters: [{ pipelineId: '10', statusId: '1' }], responsibleUserIds: ['501'] });
    expect(mockActivity.mock.calls[0][0]).toMatchObject({ managerIds: ['501'], rangeKind: 'month' });
  });

  it('refuses without a bot token, amoCRM, admin chats or a known seller', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(await rejection(caller(['Admin']).sendPdfToAdmins({ id: '501' })))
      .toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Telegram bot token topilmadi.' });

    process.env.TELEGRAM_BOT_TOKEN = '12345:bot';
    mockAmoContext.mockResolvedValueOnce(null);
    expect(await rejection(caller(['Admin']).sendPdfToAdmins({ id: '501' })))
      .toMatchObject({ code: 'PRECONDITION_FAILED', message: 'AmoCRM integration is not connected.' });

    mockAdmins = [{ telegramId: null, name: 'Boss' }];
    expect(await rejection(caller(['Admin']).sendPdfToAdmins({ id: '501' })))
      .toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Telegram chat id bilan admin topilmadi.' });

    mockAdmins = [{ telegramId: '9001', name: 'Boss' }];
    expect(await rejection(caller(['Admin']).sendPdfToAdmins({ id: '777' }))).toMatchObject({ code: 'NOT_FOUND', message: 'Seller not found' });
    expect(mockSendDocument).not.toHaveBeenCalled();
  });

  it("lets an agent send only their own report", async () => {
    mockScopeUser.mockResolvedValue({ amocrmResponsibleUserId: '501' });

    expect(await rejection(caller(['Agent']).sendPdfToAdmins({ id: '502' }))).toMatchObject({ code: 'NOT_FOUND', message: 'Seller not found' });
    expect(await caller(['Agent']).sendPdfToAdmins({ id: '501', range: 'last30days' })).toEqual({ success: true, recipientCount: 2 });
    expect(mockActivity.mock.calls[0][0].rangeKind).toBe('custom');
  });
});
