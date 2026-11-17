const sendDocument = jest.fn();
const auditLogCreate = jest.fn();
const redisStore = new Map<string, { value: string | Set<string>; ttl: number | null }>();

const fakeRedis = {
  set: jest.fn((key: string, value: string, _ex: string, ttl: number, nx: string) => {
    if (nx === 'NX' && redisStore.has(key)) return Promise.resolve(null);
    redisStore.set(key, { value, ttl });

    return Promise.resolve('OK');
  }),
  expire: jest.fn((key: string, ttl: number) => {
    const entry = redisStore.get(key);

    if (entry) entry.ttl = ttl;

    return Promise.resolve(entry ? 1 : 0);
  }),
  del: jest.fn((key: string) => Promise.resolve(redisStore.delete(key) ? 1 : 0)),
  incr: jest.fn((key: string) => {
    const next = Number(redisStore.get(key)?.value || 0) + 1;

    redisStore.set(key, { value: String(next), ttl: redisStore.get(key)?.ttl ?? null });

    return Promise.resolve(next);
  }),
  sadd: jest.fn((key: string, member: string) => {
    const entry = redisStore.get(key) || { value: new Set<string>(), ttl: null };

    (entry.value as Set<string>).add(member);
    redisStore.set(key, entry);

    return Promise.resolve(1);
  }),
  smembers: jest.fn((key: string) => Promise.resolve(Array.from((redisStore.get(key)?.value as Set<string> | undefined) || []))),
};

jest.mock('@dashboarduz/db', () => ({
  systemPrisma: {
    integration: {
      findMany: jest.fn(() => Promise.resolve([{
        id: 'integration-1',
        tenantId: 'tenant-1',
        status: 'active',
        tokensEncrypted: 'encrypted',
        config: {},
        tenant: { name: 'Najot Nur', settings: {} },
      }])),
    },
    telegramRecipient: { count: jest.fn(() => Promise.resolve(3)) },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
  },
}));
jest.mock('../../integrations/telegram', () => ({ telegramService: { sendDocument: (...args: unknown[]) => sendDocument(...args) } }));
jest.mock('../../integrations/telegram-recipient-store', () => ({
  listTelegramRecipients: jest.fn(() => Promise.resolve(
    ['chat-a', 'chat-b', 'chat-c'].map((chatId) => ({ chatId, selectedForReports: true })),
  )),
}));
jest.mock('../../queue/redis-client', () => ({ getRedisClient: () => fakeRedis }));
jest.mock('../../security/encryption', () => ({ decryptIntegrationTokens: () => ({ botToken: 'bot-token' }) }));
jest.mock('../../../lib/async', () => ({ sleep: jest.fn(() => Promise.resolve()) }));
jest.mock('../../observability', () => ({ reportError: jest.fn() }));
jest.mock('../telegram-report/metrics', () => ({
  getSelectedPipelineIdsForTenant: jest.fn(() => Promise.resolve([])),
  collectMetrics: jest.fn(() => Promise.resolve({
    newLeads: 0, qualifiedLeads: 0, nonQualifiedLeads: 0, qualifiedShare: 0, nonQualifiedShare: 0,
    newSalesCount: 0, conversionPercent: 0, agreementTotal: 0, incomeTotal: 0, newSalesIncomeTotal: 0,
    debtRepaymentIncomeTotal: 0, onlineSalesCount: 0, onlineAgreementTotal: 0, offlineSalesCount: 0,
    offlineAgreementTotal: 0, intensiveSalesCount: 0, intensiveAgreementTotal: 0, totalCalls: 0,
    talkDurationSeconds: 0, reasonBreakdown: [], sourceBreakdown: [], selectedCourseRows: [], managerRows: [],
  })),
}));

import { dispatchWindow, MAX_SEND_ATTEMPTS, RETRY_DELAY_SECONDS } from '../telegram-report/dispatch';
import type { ReportWindow } from '../telegram-report/types';

const window: ReportWindow = {
  kind: 'daily',
  title: 'Kunlik hisobot (Kecha)',
  periodStart: new Date('2026-11-15T19:00:00.000Z'),
  periodEnd: new Date('2026-11-16T18:59:59.999Z'),
  periodKey: '2026-11-16',
};
const lockKey = 'telegram-report:daily:tenant-1:2026-11-16';
const now = new Date('2026-11-17T03:30:00.000Z');

function sentChats(): string[] {
  return sendDocument.mock.calls.map((call: unknown[]) => call[1] as string);
}

describe('scheduled Telegram report dispatch', () => {
  beforeEach(() => {
    redisStore.clear();
    sendDocument.mockReset();
    auditLogCreate.mockReset();
  });

  it('keeps sending to the other recipients when one fails, and backs off instead of retrying every tick', async () => {
    sendDocument.mockImplementation((_token: string, chatId: string) => (
      chatId === 'chat-b'
        ? Promise.reject(new Error('Telegram API error: Forbidden: bot was blocked by the user'))
        : Promise.resolve()
    ));

    await dispatchWindow(window, now);

    expect(sentChats()).toEqual(['chat-a', 'chat-b', 'chat-c']);
    expect(redisStore.get(lockKey)?.ttl).toBe(RETRY_DELAY_SECONDS);
    expect(auditLogCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'telegram_report_failed' }),
    }));

    // The lock still exists, so the next scheduler tick does not resend.
    sendDocument.mockClear();
    await dispatchWindow(window, now);
    expect(sendDocument).not.toHaveBeenCalled();
  });

  it('retries only the recipients that did not get the report', async () => {
    sendDocument.mockResolvedValueOnce(undefined) // chat-a
      .mockRejectedValueOnce(new Error('timeout')) // chat-b
      .mockResolvedValue(undefined);

    await dispatchWindow(window, now);
    redisStore.delete(lockKey); // the retry delay has passed
    sendDocument.mockClear();
    await dispatchWindow(window, now);

    expect(sentChats()).toEqual(['chat-b']);
    expect(auditLogCreate).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'telegram_report_sent' }),
    }));
  });

  it('gives up on the window after the maximum number of attempts', async () => {
    sendDocument.mockRejectedValue(new Error('Telegram API error: Bad Request: chat not found'));

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
      redisStore.delete(lockKey);
      await dispatchWindow(window, now);
    }

    expect(redisStore.get(lockKey)?.ttl).not.toBe(RETRY_DELAY_SECONDS);
    sendDocument.mockClear();
    await dispatchWindow(window, now);
    expect(sendDocument).not.toHaveBeenCalled();
  });
});
