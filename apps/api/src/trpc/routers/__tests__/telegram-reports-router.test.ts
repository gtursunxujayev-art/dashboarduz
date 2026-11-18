import { TRPCError } from '@trpc/server';
import { request, response } from 'express';

import type { Context } from '../../context';
import { router } from '../../trpc';
import { telegramReportProcedures } from '../integrations/telegram-reports';

// Admin procedures behind the Telegram report settings: recipients and course selection, and the manual
// "send now" buttons (today / week / month PDF reports and the online/offline group summaries). The PDF
// building itself (telegram-report/dispatch) is mocked; the group summary is built and sent for real.
const mockDb = {
  user: { findFirst: jest.fn() },
  integration: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  course: { findMany: jest.fn() },
  telegramRecipient: { findMany: jest.fn(), updateMany: jest.fn() },
  income: { findMany: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};
const mockRedis = { set: jest.fn(), del: jest.fn() };
const mockSendWindow = jest.fn();
const mockTelegramSend = jest.fn();

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
  forTenant: () => mockDb,
}));
jest.mock('../../../services/queue/redis-client', () => ({ getRedisClient: () => mockRedis }));
jest.mock('../../../services/reports/telegram-report/dispatch', () => ({
  dispatchWindow: jest.fn(),
  sendWindowToIntegration: (...args: unknown[]) => mockSendWindow(...args),
}));
jest.mock('../../../services/integrations/telegram', () => ({
  telegramService: { sendMessage: (...args: unknown[]) => mockTelegramSend(...args) },
}));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const COURSE_A = '33333333-3333-4333-8333-333333333333';
const COURSE_B = '44444444-4444-4444-8444-444444444444';

const testRouter = router(telegramReportProcedures);

function adminCaller() {
  const ctx: Context = {
    req: request,
    res: response,
    user: { userId: USER_ID, tenantId: TENANT_ID, roles: ['Admin'] },
    tenantId: TENANT_ID,
  };

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

function recipientRow(chatId: string, selectedForReports: boolean) {
  return {
    chatId,
    username: null,
    firstName: `User ${chatId}`,
    lastName: null,
    displayName: `User ${chatId}`,
    started: true,
    selectedForReports,
    startedAt: new Date('2026-11-01T10:00:00.000Z'),
    lastSeenAt: null,
  };
}

const savedEnv = { ...process.env };

beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...savedEnv, TELEGRAM_BOT_TOKEN: '12345:bot-token', ONLINE_GROUP_ID: '-1001', OFFLINE_GROUP_IDS: '' };
  delete process.env.ONLINE_GROUP_IDS;
  delete process.env.OFLINE_GROUP_ID;
  mockDb.user.findFirst.mockResolvedValue({ id: USER_ID });
  mockDb.auditLog.create.mockResolvedValue({});
  mockDb.integration.update.mockResolvedValue({});
  mockDb.telegramRecipient.updateMany.mockResolvedValue({ count: 1 });
  mockDb.$transaction.mockImplementation((ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : Promise.resolve(ops)));
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.del.mockResolvedValue(1);
});

afterAll(() => {
  process.env = savedEnv;
});

describe('getTelegramReportRecipients', () => {
  it('lists started recipients, course options and the selected courses that still exist', async () => {
    mockDb.integration.findUnique.mockResolvedValue({ id: 'tg-1', status: 'active', config: { telegramDailyReportCourseIds: [COURSE_A, 'gone'] } });
    mockDb.course.findMany.mockResolvedValue([{ id: COURSE_A, name: 'Online', category: 'online', isActive: true }]);
    mockDb.telegramRecipient.findMany.mockResolvedValue([recipientRow('42', true)]);

    const result = await adminCaller().getTelegramReportRecipients();

    expect(result).toEqual({
      connected: true,
      recipientStorageReady: true,
      recipientError: null,
      recipients: [{
        chatId: '42',
        displayName: 'User 42',
        username: null,
        firstName: 'User 42',
        lastName: null,
        selectedForReports: true,
        startedAt: '2026-11-01T10:00:00.000Z',
        lastSeenAt: null,
      }],
      courseOptions: [{ id: COURSE_A, name: 'Online', category: 'online', isActive: true }],
      selectedDailyReportCourseIds: [COURSE_A],
    });
    expect(mockDb.telegramRecipient.findMany.mock.calls[0][0].where).toEqual({ tenantId: TENANT_ID, integrationId: 'tg-1', started: true });
  });

  it('reports a missing recipient table instead of failing', async () => {
    mockDb.integration.findUnique.mockResolvedValue({ id: 'tg-1', status: 'active', config: {} });
    mockDb.course.findMany.mockResolvedValue([]);
    mockDb.telegramRecipient.findMany.mockRejectedValue(new Error('relation does not exist'));

    const result = await adminCaller().getTelegramReportRecipients();

    expect(result.recipientStorageReady).toBe(false);
    expect(result.recipientError).toContain('Telegram foydalanuvchilari jadvali tayyor emas');
    expect(result.recipients).toEqual([]);
  });

  it('returns an empty, disconnected state without an active integration', async () => {
    mockDb.integration.findUnique.mockResolvedValue({ id: 'tg-1', status: 'disabled', config: {} });

    expect(await adminCaller().getTelegramReportRecipients()).toEqual({
      connected: false,
      recipientStorageReady: true,
      recipientError: null,
      recipients: [],
      courseOptions: [],
      selectedDailyReportCourseIds: [],
    });
  });
});

describe('updateTelegramReportRecipients', () => {
  beforeEach(() => {
    mockDb.integration.findUnique.mockResolvedValue({ id: 'tg-1', status: 'active', config: { other: 'kept' } });
  });

  it('selects the given recipients and courses, writes them to the config and audits the change', async () => {
    mockDb.telegramRecipient.findMany
      .mockResolvedValueOnce([{ chatId: '42' }, { chatId: '43' }])
      .mockResolvedValueOnce([recipientRow('42', true), recipientRow('43', false)]);
    mockDb.course.findMany.mockResolvedValue([{ id: COURSE_A }, { id: COURSE_B }]);

    const result = await adminCaller().updateTelegramReportRecipients({ chatIds: [' 42 ', '42'], dailyReportCourseIds: [COURSE_A, COURSE_B, COURSE_A] });

    expect(result).toEqual({ success: true, selectedChatIds: ['42'], selectedDailyReportCourseIds: [COURSE_A, COURSE_B] });
    expect(mockDb.telegramRecipient.updateMany).toHaveBeenNthCalledWith(1, {
      where: { tenantId: TENANT_ID, integrationId: 'tg-1', selectedForReports: true },
      data: { selectedForReports: false },
    });
    expect(mockDb.telegramRecipient.updateMany).toHaveBeenNthCalledWith(2, {
      where: { tenantId: TENANT_ID, integrationId: 'tg-1', started: true, chatId: { in: ['42'] } },
      data: { selectedForReports: true },
    });
    const config = mockDb.integration.update.mock.calls[0][0].data.config;

    expect(config).toMatchObject({ other: 'kept', telegramDailyReportCourseIds: [COURSE_A, COURSE_B] });
    expect(mockDb.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'integration_update',
      userId: USER_ID,
      metadata: { type: 'telegram', reportRecipientChatIds: ['42'], telegramDailyReportCourseIds: [COURSE_A, COURSE_B] },
    });
  });

  it('rejects an unknown recipient and an unknown course', async () => {
    mockDb.telegramRecipient.findMany.mockResolvedValue([{ chatId: '42' }]);

    expect(await rejection(adminCaller().updateTelegramReportRecipients({ chatIds: ['99'] })))
      .toMatchObject({ code: 'BAD_REQUEST', message: 'Unknown Telegram recipient chat id: 99' });

    mockDb.course.findMany.mockResolvedValue([{ id: COURSE_A }]);
    expect(await rejection(adminCaller().updateTelegramReportRecipients({ chatIds: ['42'], dailyReportCourseIds: [COURSE_A, COURSE_B] })))
      .toMatchObject({ code: 'BAD_REQUEST', message: `Unknown report course id: ${COURSE_B}` });
    expect(mockDb.integration.update).not.toHaveBeenCalled();
  });

  it('needs a connected integration', async () => {
    mockDb.integration.findUnique.mockResolvedValue(null);

    expect(await rejection(adminCaller().updateTelegramReportRecipients({ chatIds: [] })))
      .toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Telegram integration is not connected.' });
  });
});

describe('manual PDF reports', () => {
  const integration = { id: 'tg-1', tenantId: TENANT_ID, tokensEncrypted: 'enc', config: {}, tenant: { name: 'Acme', settings: {} } };

  it('sends today, this week and this month to the selected recipients, under a per-minute lock', async () => {
    mockDb.integration.findFirst.mockResolvedValue(integration);
    mockDb.telegramRecipient.findMany.mockResolvedValue([recipientRow('42', true), recipientRow('43', false)]);
    mockSendWindow.mockResolvedValue({ recipientCount: 1, fileName: 'report.pdf' });

    const today = await adminCaller().sendTelegramTodayReportNow();
    const weekly = await adminCaller().sendTelegramWeeklyReportNow();
    const monthly = await adminCaller().sendTelegramMonthlyReportNow();

    expect([today.schedule, weekly.schedule, monthly.schedule]).toEqual(['manual_today', 'manual_weekly', 'manual_monthly']);
    expect(today).toMatchObject({ sent: true, recipientCount: 1 });
    expect(mockSendWindow.mock.calls.map((call) => call[1].kind)).toEqual(['daily', 'weekly', 'monthly']);
    expect(mockRedis.set.mock.calls[0][0]).toMatch(new RegExp(`^telegram-report:manual_today:${TENANT_ID}:\\d{4}-\\d{2}-\\d{2}:\\d+$`));
    expect(mockDb.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'telegram_report_sent',
      resourceId: 'tg-1',
      metadata: { schedule: 'manual_today', recipientCount: 1, fileName: 'report.pdf' },
    });
  });

  it('refuses a second send within the minute, no selected recipients and no integration', async () => {
    mockDb.integration.findFirst.mockResolvedValue(integration);
    mockDb.telegramRecipient.findMany.mockResolvedValue([recipientRow('42', true)]);
    mockRedis.set.mockResolvedValue(null);
    expect(await rejection(adminCaller().sendTelegramTodayReportNow()))
      .toMatchObject({ code: 'BAD_REQUEST', message: 'A report was already sent in the last minute. Please wait and try again.' });

    mockDb.telegramRecipient.findMany.mockResolvedValue([recipientRow('42', false)]);
    expect((await rejection(adminCaller().sendTelegramWeeklyReportNow())).message).toBe('No Telegram recipients selected for scheduled reports');

    mockDb.integration.findFirst.mockResolvedValue(null);
    expect((await rejection(adminCaller().sendTelegramMonthlyReportNow())).message).toBe('Telegram integration is not connected');
  });

  it('releases the lock when sending fails', async () => {
    mockDb.integration.findFirst.mockResolvedValue(integration);
    mockDb.telegramRecipient.findMany.mockResolvedValue([recipientRow('42', true)]);
    mockSendWindow.mockRejectedValue(new Error('Telegram 400'));

    expect(await rejection(adminCaller().sendTelegramTodayReportNow())).toMatchObject({ code: 'BAD_REQUEST', message: 'Telegram 400' });
    expect(mockRedis.del).toHaveBeenCalledWith(mockRedis.set.mock.calls[0][0]);
  });
});

describe('sendTelegramGroupSummaryNow', () => {
  it('sends the online summary to its group and skips offline without a group id', async () => {
    mockDb.integration.findFirst.mockResolvedValue({ id: 'tg-1', tenantId: TENANT_ID, status: 'active', tokensEncrypted: null, config: {} });
    mockDb.income.findMany.mockResolvedValue([{
      id: 'sale-1',
      type: 'new_sale',
      relatedDebtIncomeId: null,
      paymentAmount: 1_000_000,
      coursePriceAmount: 3_000_000,
      debtAmount: 3_000_000,
      courseId: 'c1',
      course: { id: 'c1', name: 'Online kurs', category: 'online' },
    }]);
    mockTelegramSend.mockResolvedValue({});

    const result = await adminCaller().sendTelegramGroupSummaryNow();

    expect(result.schedule).toBe('manual');
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.results).toEqual([
      { group: 'online', status: 'sent', destinationCount: 1, sentCount: 1, error: null },
      { group: 'offline', status: 'skipped', destinationCount: 0, sentCount: 0, error: 'offline Telegram guruh ID si sozlanmagan.' },
    ]);
    const [token, chatId, text, options] = mockTelegramSend.mock.calls[0];

    expect([token, chatId, options]).toEqual(['12345:bot-token', '-1001', { disable_web_page_preview: true }]);
    expect(text).toContain('🆕 Yangi sotuvlar: 1');
    expect(text).toContain("💰 Umumiy tushum: 1 000 000 so'm");
    expect(mockDb.auditLog.create.mock.calls.map((call) => call[0].data.action))
      .toEqual(['telegram_group_summary_sent', 'telegram_group_summary_failed']);
  });

  it('reports partial delivery as failed and survives a failing audit write', async () => {
    process.env.ONLINE_GROUP_ID = '-1001,-1002';
    mockDb.integration.findFirst.mockResolvedValue({ id: 'tg-1', tenantId: TENANT_ID, status: 'active', tokensEncrypted: null, config: {} });
    mockDb.income.findMany.mockResolvedValue([]);
    mockTelegramSend.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('chat not found'));
    mockDb.auditLog.create.mockRejectedValue(new Error('audit down'));

    const result = await adminCaller().sendTelegramGroupSummaryNow();

    expect(result.results[0]).toEqual({ group: 'online', status: 'failed', destinationCount: 2, sentCount: 1, error: 'chat not found' });
  });

  it('fails clearly without a Telegram integration', async () => {
    mockDb.integration.findFirst.mockResolvedValue(null);

    expect(await rejection(adminCaller().sendTelegramGroupSummaryNow()))
      .toMatchObject({ code: 'BAD_REQUEST', message: 'Telegram integration is not connected.' });
  });
});
