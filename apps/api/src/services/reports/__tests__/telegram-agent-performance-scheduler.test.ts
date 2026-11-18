import { startTelegramAgentPerformanceScheduler, stopTelegramAgentPerformanceScheduler } from '../telegram-agent-performance-scheduler';

// The noon agent-performance push: per agent today's income, counted calls and their duration (amoCRM calls by
// managerUserId plus corporate calls), completed amoCRM lead tasks, the rank by call duration and a motivation
// line. Driven through the scheduler's first run with a fixed clock; database and outbound calls are mocked.
const mockDb = {
  integration: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  income: { findMany: jest.fn() },
  call: { findMany: jest.fn() },
  auditLog: { create: jest.fn() },
};
const mockRedis = { set: jest.fn(), del: jest.fn() };
const mockSend = jest.fn();
const mockBotToken = jest.fn();
const mockCorporate = jest.fn();
const mockAmoContext = jest.fn();
const mockAmoTasks = jest.fn();
const mockReportError = jest.fn();

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
}));
jest.mock('../../queue/redis-client', () => ({ getRedisClient: () => mockRedis }));
jest.mock('../../../lib/telegram', () => ({
  buildLooseTelegramChatIdCandidates: jest.fn(),
  resolveTelegramBotToken: (...args: unknown[]) => mockBotToken(...args),
  sendMessageToTelegramChat: (...args: unknown[]) => mockSend(...args),
}));
jest.mock('../../corporate-call-durations', () => ({
  getCorporateCallDurationByManager: (...args: unknown[]) => mockCorporate(...args),
}));
jest.mock('../../income-facts', () => ({
  ...jest.requireActual('../../income-facts'),
  loadTechnicalSaleIdsForRows: () => Promise.resolve(new Set<string>()),
}));
jest.mock('../../integrations/amocrm-live', () => ({
  getTenantAmoCRMContext: (...args: unknown[]) => mockAmoContext(...args),
}));
jest.mock('../../integrations/amocrm-activity-snapshot-read', () => ({
  getAmoTasks: (...args: unknown[]) => mockAmoTasks(...args),
}));
jest.mock('../../observability', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

const ABOVE = "Harakatlaringiz juda yaxshi, qo'ng'iroqlarni kamaytirmang va albatta natija siz kutganingizdek bo'ladi!";
const BELOW = "Bugun boshqalardan ortda qolyapsiz, ko'proq qo'ng'iroqlar qiling, natija harakatlarga bog'liq!";
// 13:00 in Tashkent (UTC+5), after the noon dispatch time.
const AFTER_NOON = new Date('2026-11-18T08:00:00.000Z');
const TASHKENT_DAY_START = new Date('2026-11-17T19:00:00.000Z');

async function settle(): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function runAt(now: Date): Promise<void> {
  jest.setSystemTime(now);
  startTelegramAgentPerformanceScheduler();
  stopTelegramAgentPerformanceScheduler();
  await settle();
}

beforeAll(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.integration.findMany.mockResolvedValue([{ id: 'tg-1', tenantId: 'tenant-1', status: 'active', tokensEncrypted: 'enc' }]);
  mockDb.user.findMany.mockResolvedValue([
    { id: 'agent-a', name: 'Aziz', username: 'aziz', telegramId: ' 1001 ', amocrmResponsibleUserId: '501' },
    { id: 'agent-b', name: null, username: 'bobur', telegramId: '1002', amocrmResponsibleUserId: '502' },
    { id: 'agent-c', name: '  ', username: null, telegramId: null, amocrmResponsibleUserId: null },
  ]);
  mockDb.income.findMany.mockResolvedValue([
    { id: 'i1', type: 'new_sale', relatedDebtIncomeId: null, managerUserId: 'agent-a', paymentAmount: 1_000_000 },
    { id: 'i2', type: 'repayment', relatedDebtIncomeId: 'old', managerUserId: 'agent-a', paymentAmount: 500_000 },
  ]);
  mockDb.call.findMany.mockResolvedValue([
    { managerUserId: 'agent-a', duration: 300 },
    { managerUserId: 'agent-a', duration: 300 },
    { managerUserId: 'agent-b', duration: 300 },
    { managerUserId: null, duration: 999 },
    { managerUserId: 'agent-b', duration: -5 },
  ]);
  mockDb.auditLog.create.mockResolvedValue({});
  mockCorporate.mockResolvedValue(new Map([['agent-b', 400]]));
  mockAmoContext.mockResolvedValue({ integrationId: 'amo-1', accessToken: 't', config: {}, selectedPipelineIds: null });
  mockAmoTasks.mockResolvedValue([
    { id: 1, responsible_user_id: 501, is_completed: true, entity_type: 'leads' },
    { id: 2, responsible_user_id: 501, is_completed: true },
    { id: 3, responsible_user_id: 501, is_completed: false },
    { id: 4, responsible_user_id: 501, is_completed: true, entity_type: 'contacts' },
    { id: 5, responsible_user_id: 502, is_completed: true, entity_type: 'lead' },
  ]);
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.del.mockResolvedValue(1);
  mockBotToken.mockReturnValue('bot-token');
  mockSend.mockResolvedValue(undefined);
});

describe('noon agent performance messages', () => {
  it('sends each agent with a Telegram id their numbers, rank and motivation', async () => {
    await runAt(AFTER_NOON);

    expect(mockRedis.set).toHaveBeenCalledWith('telegram-agent-performance:tenant-1:2026-11-18', AFTER_NOON.toISOString(), 'EX', 172_800, 'NX');
    expect(mockDb.call.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 'tenant-1',
      provider: 'amocrm',
      managerUserId: { in: ['agent-a', 'agent-b', 'agent-c'] },
      startedAt: { gte: TASHKENT_DAY_START, lte: AFTER_NOON },
    });
    expect(mockAmoTasks).toHaveBeenCalledWith('tenant-1', {
      responsibleUserIds: ['501', '502'],
      completed: true,
      dateFrom: TASHKENT_DAY_START,
      dateTo: AFTER_NOON,
      entityType: 'leads',
    }, expect.objectContaining({ integrationId: 'amo-1' }), mockDb);

    const messages = new Map(mockSend.mock.calls.map((call) => [call[1], call[2]]));

    expect(Array.from(messages.keys())).toEqual(['1002', '1001']);
    // bobur: 300 s of amoCRM calls (a negative duration counts as 0) + 400 s corporate = 700 s, the longest.
    expect(messages.get('1002')).toBe([
      "Bugungi tushum - 0 so'm",
      "Qo'ng'iroqlar soni - 2",
      "Qo'ng'iroqlar davomiyligi - 00:11:40",
      'Bajarilgan topshiriqlar - 1',
      '',
      "Bugun qo'ng'iroqlar bo'yicha 1-o'rindasiz",
      '',
      ABOVE,
    ].join('\n'));
    expect(messages.get('1001')).toBe([
      "Bugungi tushum - 1 500 000 so'm",
      "Qo'ng'iroqlar soni - 2",
      "Qo'ng'iroqlar davomiyligi - 00:10:00",
      'Bajarilgan topshiriqlar - 2',
      '',
      "Bugun qo'ng'iroqlar bo'yicha 2-o'rindasiz",
      '',
      ABOVE,
    ].join('\n'));
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        action: 'telegram_agent_noon_performance_sent',
        resource: 'integration',
        resourceId: 'tg-1',
        metadata: {
          schedule: 'daily_noon',
          timezone: expect.any(String),
          periodStart: TASHKENT_DAY_START.toISOString(),
          periodEnd: AFTER_NOON.toISOString(),
          sentCount: 2,
          agentCount: 3,
        },
      },
    });
  });

  it('tells a below-average agent to call more and counts only delivered messages', async () => {
    mockDb.user.findMany.mockResolvedValue([
      { id: 'agent-a', name: 'Aziz', telegramId: '1001', amocrmResponsibleUserId: null },
      { id: 'agent-b', name: 'Bobur', telegramId: '1002', amocrmResponsibleUserId: null },
    ]);
    mockDb.call.findMany.mockResolvedValue([{ managerUserId: 'agent-a', duration: 900 }]);
    mockCorporate.mockResolvedValue(new Map());
    mockSend.mockImplementation((_token: string, chatId: string) => (chatId === '1001' ? Promise.reject(new Error('blocked')) : Promise.resolve()));

    await runAt(AFTER_NOON);

    const bobur = mockSend.mock.calls.find((call) => call[1] === '1002')?.[2];

    expect(bobur).toContain("Bugun qo'ng'iroqlar bo'yicha 2-o'rindasiz");
    expect(bobur).toContain(BELOW);
    expect(bobur).toContain('Bajarilgan topshiriqlar - 0');
    expect(mockAmoTasks).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create.mock.calls[0][0].data.metadata).toMatchObject({ sentCount: 1, agentCount: 2 });
  });

  it('does nothing before noon and when another worker holds the day lock', async () => {
    await runAt(new Date('2026-11-18T06:59:00.000Z'));
    expect(mockDb.integration.findMany).not.toHaveBeenCalled();

    mockRedis.set.mockResolvedValue(null);
    await runAt(AFTER_NOON);
    expect(mockDb.user.findMany).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('releases the lock and audits the failure when the bot token is missing', async () => {
    mockBotToken.mockReturnValue(null);

    await runAt(AFTER_NOON);

    expect(mockRedis.del).toHaveBeenCalledWith('telegram-agent-performance:tenant-1:2026-11-18');
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'telegram_agent_noon_performance_failed',
        metadata: expect.objectContaining({ error: 'Telegram bot token is missing' }),
      }),
    });
    expect(mockReportError).toHaveBeenCalledWith('Noon agent performance scheduler failed for tenant', {
      tenantId: 'tenant-1',
      error: 'Telegram bot token is missing',
    });
  });

  it('still sends when amoCRM is unavailable, with zero completed tasks', async () => {
    mockAmoContext.mockRejectedValue(new Error('amo down'));

    await runAt(AFTER_NOON);

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls.every((call) => String(call[2]).includes('Bajarilgan topshiriqlar - 0'))).toBe(true);
  });

  it('keeps going when fetching tasks fails, and skips a tenant without agents', async () => {
    mockAmoTasks.mockRejectedValue(new Error('tasks down'));

    await runAt(AFTER_NOON);
    expect(mockSend).toHaveBeenCalledTimes(2);

    mockSend.mockClear();
    mockDb.auditLog.create.mockClear();
    mockDb.user.findMany.mockResolvedValue([]);
    await runAt(AFTER_NOON);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });
});
