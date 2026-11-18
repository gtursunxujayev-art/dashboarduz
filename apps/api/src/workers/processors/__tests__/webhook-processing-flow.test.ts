import { processNotification } from '../notification';
import { processWebhookEvent } from '../webhook-event';

// End-to-end tests of the webhook worker path: processWebhookEvent loads the stored event, resolves the tenant,
// dispatches by source (amoCRM, Telegram, Face ID), then marks the event processed exactly once. Also the
// notification processor with its retry bookkeeping. The database and outbound services are mocked.
const mockDb = {
  webhookEvent: { findUnique: jest.fn(), update: jest.fn() },
  integration: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn() },
  lead: { findMany: jest.fn(), updateMany: jest.fn(), createMany: jest.fn() },
  contact: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), upsert: jest.fn() },
  tenant: { findUnique: jest.fn() },
  notification: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  telegramRecipient: { upsert: jest.fn() },
  $transaction: jest.fn(),
};
const mockAddNotificationJob = jest.fn();
const mockIngestFaceId = jest.fn();
const mockReportError = jest.fn();
const mockIsAllowed = jest.fn();
const mockResolveBotToken = jest.fn();
const mockSendMessage = jest.fn();

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
}));
jest.mock('../../../services/queue', () => ({
  queueService: { addNotificationJob: (...args: unknown[]) => mockAddNotificationJob(...args) },
}));
jest.mock('../../../services/attendance/faceid', () => ({
  ingestFaceIdEvent: (...args: unknown[]) => mockIngestFaceId(...args),
}));
jest.mock('../../../services/observability', () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));
jest.mock('../../../services/security/rate-limiter', () => ({
  rateLimiter: { isAllowed: (...args: unknown[]) => mockIsAllowed(...args) },
}));
jest.mock('../../../lib/telegram', () => ({
  resolveTelegramBotTokenForTenant: (...args: unknown[]) => mockResolveBotToken(...args),
}));
jest.mock('../../../services/integrations/telegram', () => ({
  telegramService: { sendMessage: (...args: unknown[]) => mockSendMessage(...args) },
}));

const TENANT_ID = 'tenant-1';

function storedEvent(overrides: Record<string, unknown>) {
  return { id: 'event-1', tenantId: TENANT_ID, processed: false, eventType: 'leads', rawPayload: {}, ...overrides };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.webhookEvent.update.mockResolvedValue({});
  mockDb.auditLog.create.mockResolvedValue({});
  mockDb.integration.update.mockResolvedValue({});
  mockDb.lead.findMany.mockResolvedValue([]);
  mockDb.lead.createMany.mockResolvedValue({ count: 0 });
  mockDb.lead.updateMany.mockResolvedValue({ count: 0 });
  mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb));
  mockDb.tenant.findUnique.mockResolvedValue({ settings: {} });
  mockDb.contact.upsert.mockResolvedValue({});
  mockIsAllowed.mockResolvedValue({ allowed: true });
});

describe('processWebhookEvent', () => {
  it('skips an event that was already processed', async () => {
    mockDb.webhookEvent.findUnique.mockResolvedValue(storedEvent({ processed: true, source: 'amocrm' }));

    await processWebhookEvent('event-1');

    expect(mockDb.webhookEvent.update).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('marks an event without a resolvable tenant processed with an error message', async () => {
    mockDb.webhookEvent.findUnique.mockResolvedValue(storedEvent({ tenantId: null, source: 'amocrm', rawPayload: { account_id: 9 } }));
    mockDb.integration.findFirst.mockResolvedValue(null);

    await processWebhookEvent('event-1');

    expect(mockDb.integration.findFirst).toHaveBeenCalledWith({
      where: { type: 'amocrm', config: { path: ['account_id'], equals: '9' } },
    });
    expect(mockDb.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { processed: true, errorMessage: 'Cannot determine tenant' },
    });
  });

  it('stores amoCRM leads of the selected pipelines and contacts, then marks the event processed', async () => {
    mockDb.webhookEvent.findUnique.mockResolvedValue(storedEvent({
      tenantId: null,
      source: 'amocrm',
      rawPayload: {
        account: { id: 3141 },
        leads: {
          add: [
            { id: 10, name: 'Deal', pipeline_id: 100, status_id: 5, responsible_user_id: 501, created_at: 1_762_500_000, updated_at: 1_762_500_100 },
            { id: 11, pipeline_id: 999 },
            { pipeline_id: 100 },
          ],
        },
        contacts: [
          { id: 20, name: 'Ali', custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '+998901112233' }] }] },
          { name: 'no id' },
        ],
      },
    }));
    mockDb.integration.findFirst.mockResolvedValueOnce({ tenantId: TENANT_ID }).mockResolvedValueOnce(null);
    mockDb.integration.findUnique.mockResolvedValue({ config: { selectedPipelineIds: ['100'] } });
    mockDb.contact.findUnique.mockResolvedValue(null);
    mockDb.contact.findFirst.mockResolvedValue(null);

    await processWebhookEvent('event-1');

    expect(mockDb.lead.createMany).toHaveBeenCalledTimes(1);
    const [created] = mockDb.lead.createMany.mock.calls[0][0].data;

    expect(created).toMatchObject({
      tenantId: TENANT_ID,
      amocrmId: '10',
      title: 'Deal',
      status: '5',
      pipelineId: '100',
      responsibleUserId: '501',
      source: 'amocrm',
      externalCreatedAt: new Date(1_762_500_000_000),
      externalUpdatedAt: new Date(1_762_500_100_000),
    });
    expect(mockDb.lead.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(mockDb.contact.upsert).toHaveBeenCalledTimes(1);
    expect(mockDb.contact.upsert.mock.calls[0][0]).toMatchObject({
      where: { tenantId_amocrmId: { tenantId: TENANT_ID, amocrmId: '20' } },
      create: { tenantId: TENANT_ID, amocrmId: '20', name: 'Ali', phone: '+998901112233', email: null, externalIds: { amocrm_id: '20' } },
    });
    expect(mockDb.webhookEvent.update).toHaveBeenLastCalledWith({
      where: { id: 'event-1' },
      data: { processed: true, processedAt: expect.any(Date), errorMessage: null },
    });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        action: 'webhook_processed',
        resource: 'webhook',
        resourceId: 'event-1',
        metadata: { source: 'amocrm', eventType: 'leads' },
      },
    });
    expect(mockAddNotificationJob).not.toHaveBeenCalled();
  });

  it('updates an already stored lead and adopts a legacy contact matched by email', async () => {
    mockDb.webhookEvent.findUnique.mockResolvedValue(storedEvent({
      source: 'amocrm',
      rawPayload: {
        _embedded: { leads: [{ id: 10, status_id: 6 }], contacts: [{ id: 20, email: [{ value: 'a@b.uz' }] }] },
      },
    }));
    mockDb.integration.findUnique.mockResolvedValue({ config: {} });
    mockDb.integration.findFirst.mockResolvedValue(null);
    mockDb.lead.findMany.mockResolvedValue([{ amocrmId: '10' }]);
    mockDb.contact.findUnique.mockResolvedValue(null);
    mockDb.contact.findFirst.mockResolvedValue({ id: 'legacy', name: 'Old', phone: '+1', email: 'a@b.uz', externalIds: { other: 1 } });
    mockDb.contact.update.mockResolvedValue({});

    await processWebhookEvent('event-1');

    expect(mockDb.lead.updateMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, amocrmId: '10' },
      data: expect.objectContaining({ title: 'Untitled Lead', status: '6', pipelineId: null, updatedAt: expect.any(Date) }),
    });
    expect(mockDb.lead.createMany).not.toHaveBeenCalled();
    expect(mockDb.contact.findFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, amocrmId: null, OR: [{ email: 'a@b.uz' }] },
      orderBy: { updatedAt: 'desc' },
    });
    expect(mockDb.contact.update).toHaveBeenCalledWith({
      where: { id: 'legacy' },
      data: expect.objectContaining({ amocrmId: '20', name: 'Old', phone: '+1', email: 'a@b.uz', externalIds: { other: 1, amocrm_id: '20' } }),
    });
    expect(mockDb.contact.upsert).not.toHaveBeenCalled();
  });

  it('falls back to the keyed upsert when a concurrent delivery adopted the legacy contact first', async () => {
    mockDb.webhookEvent.findUnique.mockResolvedValue(storedEvent({
      source: 'amocrm',
      rawPayload: { contacts: [{ id: 20, phone: [{ value: '+998' }] }] },
    }));
    mockDb.integration.findUnique.mockResolvedValue(null);
    mockDb.integration.findFirst.mockResolvedValue(null);
    mockDb.contact.findUnique.mockResolvedValue(null);
    mockDb.contact.findFirst.mockResolvedValue({ id: 'legacy', name: null, phone: '+998', email: null, externalIds: null });
    mockDb.contact.update.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await processWebhookEvent('event-1');

    expect(mockDb.contact.upsert).toHaveBeenCalledTimes(1);
    expect(mockDb.contact.upsert.mock.calls[0][0].update).toEqual({ phone: '+998', metadata: { id: 20, phone: [{ value: '+998' }] } });
  });

  it('queues a Telegram notification for lead updates when the tenant has a notification chat', async () => {
    mockDb.webhookEvent.findUnique.mockResolvedValue(storedEvent({
      source: 'amocrm',
      rawPayload: { leads: [{ id: 10 }, { id: 11 }], contacts: [] },
    }));
    mockDb.integration.findUnique.mockResolvedValue({ config: {} });
    mockDb.integration.findFirst.mockResolvedValue({ id: 'tg-1' });
    mockDb.tenant.findUnique.mockResolvedValue({ settings: { notificationChatId: ' 12345 ' } });
    mockDb.notification.create.mockResolvedValue({ id: 'notif-1' });

    await processWebhookEvent('event-1');

    expect(mockDb.notification.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        type: 'telegram',
        payload: { chatId: '12345', text: 'AmoCRM update received: 2 lead(s), 0 contact(s).' },
        status: 'pending',
      },
    });
    expect(mockAddNotificationJob).toHaveBeenCalledWith('notif-1', { priority: 2 });
  });

  it('stores the Telegram recipient of an update and touches the integration', async () => {
    mockDb.webhookEvent.findUnique.mockResolvedValue(storedEvent({
      source: 'telegram',
      eventType: 'message',
      rawPayload: { update_id: 77, message: { text: 'hi', chat: { id: 42 }, from: { first_name: 'Vali' } } },
    }));
    mockDb.integration.findFirst.mockResolvedValue({ id: 'tg-1' });
    mockDb.telegramRecipient.upsert.mockResolvedValue({});

    await processWebhookEvent('event-1');

    expect(mockDb.integration.findFirst).toHaveBeenCalledWith({ where: { tenantId: TENANT_ID, type: 'telegram' } });
    expect(mockDb.telegramRecipient.upsert.mock.calls[0][0].create).toMatchObject({
      tenantId: TENANT_ID, integrationId: 'tg-1', chatId: '42', firstName: 'Vali', lastUpdateId: '77', started: true,
    });
    expect(mockDb.integration.update).toHaveBeenCalledWith({ where: { id: 'tg-1' }, data: { lastSyncAt: expect.any(Date) } });
    expect(mockDb.webhookEvent.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ processed: true }) }));
  });

  it('does nothing for a Telegram update when the tenant has no Telegram integration', async () => {
    mockDb.webhookEvent.findUnique.mockResolvedValue(storedEvent({ source: 'telegram', rawPayload: { message: { chat: { id: 1 } } } }));
    mockDb.integration.findFirst.mockResolvedValue(null);

    await processWebhookEvent('event-1');

    expect(mockDb.telegramRecipient.upsert).not.toHaveBeenCalled();
    expect(mockDb.integration.update).not.toHaveBeenCalled();
  });

  it('hands Face ID events to attendance ingestion with the integration config', async () => {
    const rawPayload = { person_id: 'p1' };

    mockDb.webhookEvent.findUnique.mockResolvedValue(storedEvent({ source: 'faceid', eventType: 'check_in', rawPayload }));
    mockDb.integration.findFirst.mockResolvedValue({ config: { branchWhitelist: ['a'] } });
    mockIngestFaceId.mockResolvedValue({ ignored: false });

    await processWebhookEvent('event-1');

    expect(mockIngestFaceId).toHaveBeenCalledWith({ tenantId: TENANT_ID, integrationConfig: { branchWhitelist: ['a'] }, payload: rawPayload });
  });

  it('records a failure, counts the retry, audits it and rethrows', async () => {
    mockDb.webhookEvent.findUnique.mockResolvedValue(storedEvent({ source: 'faceid' }));
    mockDb.integration.findFirst.mockResolvedValue(null);

    await expect(processWebhookEvent('event-1')).rejects.toThrow('No active Face ID integration found');

    expect(mockDb.webhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: { errorMessage: 'No active Face ID integration found', retryCount: { increment: 1 } },
    });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        action: 'webhook_failed',
        resource: 'webhook',
        resourceId: 'event-1',
        metadata: { error: 'No active Face ID integration found' },
      },
    });
    expect(mockReportError).toHaveBeenCalledWith('Webhook processing failed', expect.objectContaining({ eventId: 'event-1' }));
  });

  it('fails a missing event without an audit row (no tenant known yet)', async () => {
    mockDb.webhookEvent.findUnique.mockResolvedValue(null);

    await expect(processWebhookEvent('missing')).rejects.toThrow('Webhook event missing not found');
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
    expect(mockDb.webhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'missing' } }));
  });

  it('marks an event of an unknown source processed', async () => {
    mockDb.webhookEvent.findUnique.mockResolvedValue(storedEvent({ source: 'other' }));

    await processWebhookEvent('event-1');

    expect(mockDb.webhookEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processed: true, errorMessage: null }) }));
  });
});

describe('processNotification', () => {
  const pending = { id: 'n1', tenantId: TENANT_ID, type: 'telegram', status: 'pending', attempts: 0, maxAttempts: 3, payload: { chatId: 42, text: 'Hi' } };

  it('sends a Telegram notification and marks it sent', async () => {
    mockDb.notification.findUnique.mockResolvedValue(pending);
    mockResolveBotToken.mockResolvedValue('bot-token');
    mockSendMessage.mockResolvedValue({});
    mockDb.notification.update.mockResolvedValue({});

    await processNotification('n1');

    expect(mockIsAllowed).toHaveBeenCalledWith(TENANT_ID, 'notifications:fanout', { maxRequests: 120, windowMs: 60_000, keyPrefix: 'notifications' });
    expect(mockSendMessage).toHaveBeenCalledWith('bot-token', '42', 'Hi', undefined);
    expect(mockDb.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { status: 'sent', sentAt: expect.any(Date), attempts: { increment: 1 }, errorMessage: null },
    });
  });

  it('does not resend a notification that was already sent', async () => {
    mockDb.notification.findUnique.mockResolvedValue({ ...pending, status: 'sent' });

    await processNotification('n1');

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockDb.notification.update).not.toHaveBeenCalled();
  });

  it('schedules a retry with exponential delay while attempts remain', async () => {
    mockDb.notification.findUnique.mockResolvedValue({ ...pending, attempts: 1 });
    mockResolveBotToken.mockResolvedValue(null);
    mockDb.notification.update.mockResolvedValue({});

    await expect(processNotification('n1')).rejects.toThrow('Telegram bot token is missing');

    const data = mockDb.notification.update.mock.calls[0][0].data;

    expect(data).toMatchObject({ attempts: { increment: 1 }, errorMessage: 'Telegram bot token is missing', status: 'retrying' });
    expect(data.nextRetryAt).toBeInstanceOf(Date);
    const [, options] = mockAddNotificationJob.mock.calls[0];

    // 2^attempts seconds
    expect(options.delay).toBeGreaterThan(1500);
    expect(options.delay).toBeLessThanOrEqual(2000);
  });

  it('fails for good on the last attempt, and for unsupported types and bad payloads', async () => {
    mockDb.notification.update.mockResolvedValue({});

    mockDb.notification.findUnique.mockResolvedValue({ ...pending, type: 'email', attempts: 2 });
    await expect(processNotification('n1')).rejects.toThrow('Email notification not implemented');
    expect(mockDb.notification.update.mock.calls[0][0].data).toMatchObject({ status: 'failed', nextRetryAt: null });

    mockDb.notification.findUnique.mockResolvedValue({ ...pending, type: 'sms', attempts: 2 });
    await expect(processNotification('n1')).rejects.toThrow('SMS notification not implemented');

    mockDb.notification.findUnique.mockResolvedValue({ ...pending, type: 'push', attempts: 2 });
    await expect(processNotification('n1')).rejects.toThrow('Unsupported notification type: push');

    mockResolveBotToken.mockResolvedValue('bot-token');
    mockDb.notification.findUnique.mockResolvedValue({ ...pending, payload: { chatId: 42 }, attempts: 2 });
    await expect(processNotification('n1')).rejects.toThrow('Telegram payload must include chatId and text');
    expect(mockAddNotificationJob).not.toHaveBeenCalled();
  });

  it('enforces the per-tenant rate limit and rethrows when the notification is gone', async () => {
    mockDb.notification.findUnique.mockResolvedValueOnce(pending).mockResolvedValueOnce(pending);
    mockIsAllowed.mockResolvedValue({ allowed: false });
    mockDb.notification.update.mockResolvedValue({});
    await expect(processNotification('n1')).rejects.toThrow('Per-tenant notification rate limit exceeded');

    mockDb.notification.findUnique.mockResolvedValue(null);
    await expect(processNotification('gone')).rejects.toThrow('Notification gone not found');
  });
});
