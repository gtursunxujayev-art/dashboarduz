import { TRPCError } from '@trpc/server';
import { request, response } from 'express';

import type { Context } from '../../context';
import { callsRouter } from '../calls';
import { corporateCallsRouter } from '../corporate-calls';

// Call analytics count amoCRM calls by `managerUserId` (plus manual corporate call time), never by phone.
// Pins that attribution, the agent's own-row view, the list scoping, and the corporate-calls procedures.
const mockScopeUser = jest.fn();
const mockManagerLookup = jest.fn();
const mockDb = {
  user: {
    findFirst: jest.fn((args: { select: Record<string, boolean> }) => {
      if (args.select.amocrmResponsibleUserId) return mockScopeUser(args);
      if (args.select.name) return mockManagerLookup(args);

      // protectedProcedure's active-user check
      return Promise.resolve({ id: ACTOR_ID });
    }),
    findMany: jest.fn(),
  },
  call: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn() },
  corporateCallDuration: { groupBy: jest.fn(), upsert: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
  integration: { findUnique: jest.fn() },
};
const mockTelegramSend = jest.fn();

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
  forTenant: () => mockDb,
}));
jest.mock('../../../services/integrations/telegram', () => ({
  telegramService: { sendMessage: (...args: unknown[]) => mockTelegramSend(...args) },
}));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const CALL_ID = '44444444-4444-4444-8444-444444444444';

type Role = 'Admin' | 'Manager' | 'Agent' | 'Finance';

function ctxFor(roles: Role[]): Context {
  return { req: request, res: response, user: { userId: ACTOR_ID, tenantId: TENANT_ID, roles }, tenantId: TENANT_ID };
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
  mockManagerLookup.mockReset();
  mockDb.user.findMany.mockReset();
  mockDb.call.findMany.mockReset();
  mockDb.call.count.mockReset();
  mockDb.call.findFirst.mockReset();
  Object.values(mockDb.corporateCallDuration).forEach((fn) => fn.mockReset());
  mockDb.integration.findUnique.mockReset();
  mockTelegramSend.mockReset();
  mockDb.corporateCallDuration.groupBy.mockResolvedValue([]);
  process.env = { ...savedEnv, TELEGRAM_BOT_TOKEN: '12345:bot' };
  delete process.env.KORPORATIV_GROUP_ID;
});

afterAll(() => {
  process.env = savedEnv;
});

describe('calls.analytics', () => {
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600 * 1000);

  beforeEach(() => {
    mockDb.user.findMany.mockResolvedValue([
      { id: ACTOR_ID, name: null, username: 'ali' },
      { id: OTHER_ID, name: 'Bobur', username: 'bobur' },
    ]);
    mockDb.call.findMany.mockResolvedValue([
      { managerUserId: ACTOR_ID, direction: 'outbound', startedAt: now, duration: 120 },
      { managerUserId: ACTOR_ID, direction: 'INBOUND', startedAt: threeDaysAgo, duration: 60 },
      { managerUserId: OTHER_ID, direction: 'outbound', startedAt: now, duration: 30 },
      { managerUserId: OTHER_ID, direction: 'outbound', startedAt: now, duration: -10 },
      { managerUserId: 'not-an-agent', direction: 'outbound', startedAt: now, duration: 999 },
      { managerUserId: null, direction: 'outbound', startedAt: now, duration: 999 },
    ]);
    mockDb.corporateCallDuration.groupBy.mockResolvedValue([{ managerUserId: OTHER_ID, _sum: { durationSeconds: 600 } }]);
  });

  it('ranks agents by amoCRM plus corporate call time, counting calls by managerUserId only', async () => {
    const result = await callsRouter.createCaller(ctxFor(['Admin'])).analytics({ range: 'month' });

    expect(mockDb.call.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: TENANT_ID,
      provider: 'amocrm',
      managerUserId: { in: [ACTOR_ID, OTHER_ID] },
    });
    expect(result.rows).toEqual([
      {
        userId: OTHER_ID, agentName: 'Bobur', totalCalls: 2, averageDailyCalls: 2, callsToday: 2,
        incomingCalls: 0, outgoingCalls: 2, totalDurationSeconds: 630, rank: 1,
      },
      {
        userId: ACTOR_ID, agentName: 'ali', totalCalls: 2, averageDailyCalls: 1, callsToday: 1,
        incomingCalls: 1, outgoingCalls: 1, totalDurationSeconds: 180, rank: 2,
      },
    ]);
    expect(result.teamAverageTodayCalls).toBe(1.5);
    expect(result.totals).toEqual({ totalAgents: 2, totalCalls: 4, totalDurationSeconds: 810 });
    expect(result).toMatchObject({ range: 'month', dateFrom: null, dateTo: null, agentInsight: null });
  });

  it('shows an agent only their own row with a motivation message', async () => {
    const result = await callsRouter.createCaller(ctxFor(['Agent'])).analytics({ range: 'today' });

    expect(result.rows.map((row) => row.userId)).toEqual([ACTOR_ID]);
    expect(result.agentInsight).toEqual({
      isAgentOnly: true,
      aboveAverage: false,
      callsToday: 1,
      teamAverageTodayCalls: 1.5,
      message: "Bugun qolganlardan ortda qolyapsiz, qo'ng'iroqlarni ko'paytiring, ko'proq bonus ko'proq harakat qilganlarga nasib qiladi ",
    });
  });

  it('returns empty analytics when the tenant has no agents', async () => {
    mockDb.user.findMany.mockResolvedValue([]);

    const result = await callsRouter.createCaller(ctxFor(['Agent'])).analytics({ range: 'week' });

    expect(mockDb.call.findMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ rows: [], teamAverageTodayCalls: 0, totals: { totalAgents: 0, totalCalls: 0, totalDurationSeconds: 0 } });
    expect(result.agentInsight).toMatchObject({ aboveAverage: null, message: null });
  });
});

describe('calls.list / get / clickToCall', () => {
  it('lists amoCRM calls with search, status filter and pagination', async () => {
    mockDb.call.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
    mockDb.call.count.mockResolvedValue(5);

    const result = await callsRouter.createCaller(ctxFor(['Manager'])).list({ page: 2, limit: 2, search: '998', status: 'missed' });

    expect(result).toEqual({ data: [{ id: 'c1' }, { id: 'c2' }], pagination: { page: 2, limit: 2, total: 5, hasMore: true } });
    const args = mockDb.call.findMany.mock.calls[0][0];

    expect(args).toMatchObject({ skip: 2, take: 2, orderBy: { startedAt: 'desc' } });
    expect(args.where).toEqual({
      tenantId: TENANT_ID,
      provider: 'amocrm',
      status: 'missed',
      OR: [
        { from: { contains: '998', mode: 'insensitive' } },
        { to: { contains: '998', mode: 'insensitive' } },
        { callIdExternal: { contains: '998', mode: 'insensitive' } },
      ],
    });
  });

  it("scopes an agent to their amoCRM leads, and shows nothing to an unmapped agent", async () => {
    mockScopeUser.mockResolvedValueOnce({ amocrmResponsibleUserId: '501' });
    mockDb.call.findMany.mockResolvedValue([]);
    mockDb.call.count.mockResolvedValue(0);

    await callsRouter.createCaller(ctxFor(['Agent'])).list({ page: 1, limit: 20 });
    expect(mockDb.call.findMany.mock.calls[0][0].where).toEqual({ tenantId: TENANT_ID, provider: 'amocrm', lead: { responsibleUserId: '501' } });

    mockScopeUser.mockResolvedValueOnce({ amocrmResponsibleUserId: null });
    expect(await callsRouter.createCaller(ctxFor(['Agent'])).list({ page: 1, limit: 20 }))
      .toEqual({ data: [], pagination: { page: 1, limit: 20, total: 0, hasMore: false } });
  });

  it('gets one call within the scope and refuses click-to-call', async () => {
    mockScopeUser.mockResolvedValue({ amocrmResponsibleUserId: null });
    mockDb.call.findFirst.mockResolvedValueOnce({ id: CALL_ID }).mockResolvedValueOnce(null);

    expect(await callsRouter.createCaller(ctxFor(['Agent'])).get({ id: CALL_ID })).toEqual({ id: CALL_ID });
    expect(mockDb.call.findFirst.mock.calls[0][0].where).toEqual({ id: CALL_ID, tenantId: TENANT_ID, lead: { responsibleUserId: '__unmapped__' } });
    expect(await rejection(callsRouter.createCaller(ctxFor(['Admin'])).get({ id: CALL_ID })))
      .toMatchObject({ code: 'NOT_FOUND', message: 'Call not found' });
    expect(await rejection(callsRouter.createCaller(ctxFor(['Admin'])).clickToCall({ from: '1001', to: '998901112233' })))
      .toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

describe('corporateCalls', () => {
  const entry = {
    id: 'e1',
    managerUserId: OTHER_ID,
    callDate: new Date('2026-11-17T19:00:00.000Z'),
    durationSeconds: 5400,
    createdAt: new Date('2026-11-18T10:00:00.000Z'),
    updatedAt: new Date('2026-11-18T10:00:00.000Z'),
    manager: { name: 'Bobur Aliyev', username: 'bobur' },
  };

  it('lets an admin pick any manager and a custom date', async () => {
    mockDb.user.findMany.mockResolvedValue([{ id: OTHER_ID, name: null, username: 'bobur' }]);

    expect(await corporateCallsRouter.createCaller(ctxFor(['Admin'])).getFormOptions())
      .toEqual({ canChooseCustomDate: true, managers: [{ id: OTHER_ID, name: 'bobur' }] });
    expect(mockDb.user.findMany.mock.calls[0][0].where.roles).toBeDefined();
    expect(await rejection(corporateCallsRouter.createCaller(ctxFor(['Finance'])).getFormOptions()))
      .toMatchObject({ code: 'FORBIDDEN', message: "Sizda bu bo'lim uchun ruxsat yo'q." });
  });

  it('adds call time for a manager, increments an existing day and announces it to the corporate group', async () => {
    process.env.KORPORATIV_GROUP_ID = '-100777';
    mockManagerLookup.mockResolvedValue({ id: OTHER_ID, name: 'Bobur Aliyev', username: 'bobur' });
    mockDb.corporateCallDuration.upsert.mockResolvedValue(entry);
    mockDb.integration.findUnique.mockResolvedValue(null);
    mockTelegramSend.mockResolvedValue({});

    const result = await corporateCallsRouter.createCaller(ctxFor(['Admin'])).upsert({ managerUserId: OTHER_ID, date: '2026-11-18', duration: '00:30:00' });

    expect(mockDb.corporateCallDuration.upsert.mock.calls[0][0]).toMatchObject({
      where: { tenantId_managerUserId_callDate: { tenantId: TENANT_ID, managerUserId: OTHER_ID, callDate: new Date('2026-11-17T19:00:00.000Z') } },
      create: { durationSeconds: 1800 },
      update: { durationSeconds: { increment: 1800 } },
    });
    expect(result).toMatchObject({
      managerUserId: OTHER_ID,
      managerName: 'Bobur Aliyev',
      date: '2026-11-18',
      durationSeconds: 5400,
      duration: '01:30:00',
      telegram: { sent: true, sentCount: 1, failedCount: 0, errors: [] },
    });
    const [token, chatId, text] = mockTelegramSend.mock.calls[0];

    expect([token, chatId]).toEqual(['12345:bot', '-100777']);
    expect(text.split('\n')).toEqual(['2026-11-18', '#korporativ', expect.stringMatching(/^#/), "✅ Qo'shildi", '', '"01:30:00"']);
  });

  it('reports the Telegram outcome without failing the save', async () => {
    mockManagerLookup.mockResolvedValue({ id: ACTOR_ID, name: 'Ali', username: 'ali' });
    mockDb.corporateCallDuration.upsert.mockResolvedValue({ ...entry, managerUserId: ACTOR_ID });

    const noGroup = await corporateCallsRouter.createCaller(ctxFor(['Admin'])).upsert({ date: '2026-11-18', duration: '00:01:00' });

    expect(noGroup.telegram).toEqual({ sent: false, reason: 'group_missing' });

    process.env.KORPORATIV_GROUP_ID = '-100777';
    mockDb.integration.findUnique.mockResolvedValue(null);
    mockTelegramSend.mockRejectedValue(new Error('chat not found'));
    const failed = await corporateCallsRouter.createCaller(ctxFor(['Admin'])).upsert({ date: '2026-11-18', duration: '00:01:00' });

    expect(failed.telegram).toMatchObject({ sent: false, reason: 'send_failed' });

    delete process.env.TELEGRAM_BOT_TOKEN;
    const noToken = await corporateCallsRouter.createCaller(ctxFor(['Admin'])).upsert({ date: '2026-11-18', duration: '00:01:00' });

    expect(noToken.telegram).toEqual({ sent: false, reason: 'token_missing' });
  });

  it('limits agents to today or yesterday and validates input', async () => {
    expect(await rejection(corporateCallsRouter.createCaller(ctxFor(['Agent'])).upsert({ date: '2020-01-01', duration: '00:10:00' })))
      .toMatchObject({ code: 'FORBIDDEN', message: "Faqat bugun yoki kecha uchun qo'ng'iroq davomiyligini kiritish mumkin." });
    expect(await rejection(corporateCallsRouter.createCaller(ctxFor(['Admin'])).upsert({ date: '18.11.2026', duration: '00:10:00' })))
      .toMatchObject({ code: 'BAD_REQUEST', message: "Sana formati noto'g'ri. YYYY-MM-DD bo'lishi kerak." });

    mockManagerLookup.mockResolvedValue({ id: ACTOR_ID, name: 'Ali', username: 'ali' });
    expect(await rejection(corporateCallsRouter.createCaller(ctxFor(['Admin'])).upsert({ date: '2026-11-18', duration: '10 min' })))
      .toMatchObject({ code: 'BAD_REQUEST', message: 'Davomiylik HH:MM:SS formatida bo\'lishi kerak.' });
    expect(await rejection(corporateCallsRouter.createCaller(ctxFor(['Admin'])).upsert({ date: '2026-11-18', duration: '00:61:00' })))
      .toMatchObject({ code: 'BAD_REQUEST', message: "Daqiqa/soniya 60 dan kichik bo'lishi kerak." });

    mockManagerLookup.mockResolvedValue(null);
    expect(await rejection(corporateCallsRouter.createCaller(ctxFor(['Admin'])).upsert({ date: '2026-11-18', duration: '00:10:00' })))
      .toMatchObject({ code: 'NOT_FOUND', message: 'Menejer topilmadi.' });
  });

  it("lists an agent's own entries and lets only admins delete", async () => {
    mockDb.corporateCallDuration.findMany.mockResolvedValue([entry]);

    const listed = await corporateCallsRouter.createCaller(ctxFor(['Agent'])).list({ managerUserId: OTHER_ID, dateFrom: '2026-11-01', dateTo: '2026-11-18' });

    expect(mockDb.corporateCallDuration.findMany.mock.calls[0][0].where.managerUserId).toBe(ACTOR_ID);
    expect(listed.rows).toEqual([{
      id: 'e1', managerUserId: OTHER_ID, managerName: 'Bobur Aliyev', date: '2026-11-18', durationSeconds: 5400,
      duration: '01:30:00', createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    }]);
    expect(await rejection(corporateCallsRouter.createCaller(ctxFor(['Admin'])).list({ dateFrom: '2026-11-18', dateTo: '2026-11-01' })))
      .toMatchObject({ code: 'BAD_REQUEST', message: "Sana oralig'i noto'g'ri." });

    mockDb.corporateCallDuration.findFirst.mockResolvedValueOnce({ id: CALL_ID }).mockResolvedValueOnce(null);
    expect(await corporateCallsRouter.createCaller(ctxFor(['Admin'])).delete({ id: CALL_ID })).toEqual({ success: true, id: CALL_ID });
    expect(mockDb.corporateCallDuration.delete).toHaveBeenCalledWith({ where: { id: CALL_ID } });
    expect((await rejection(corporateCallsRouter.createCaller(ctxFor(['Admin'])).delete({ id: CALL_ID }))).code).toBe('NOT_FOUND');
    expect(await rejection(corporateCallsRouter.createCaller(ctxFor(['Manager'])).delete({ id: CALL_ID })))
      .toMatchObject({ code: 'FORBIDDEN', message: "Faqat admin o'chira oladi." });
  });
});
