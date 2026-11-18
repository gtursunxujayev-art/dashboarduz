import type { Server } from 'http';

import express, { json, request } from 'express';

import webhookRouter from '..';
import { hashFaceIdWebhookToken } from '../../services/attendance/faceid';
import { buildWebhookIdempotencyKey, getRawBody, writeWebhookRejectionAudit } from '../shared';

// HTTP-level tests of the three webhook routes: authentication, tenant lookup, rate limiting, and idempotency
// (a redelivered payload is stored once and enqueued once). Database, queue and rate limiter are mocked.
const mockDb = {
  integration: { findFirst: jest.fn(), update: jest.fn() },
  webhookEvent: { create: jest.fn(), findFirst: jest.fn() },
  auditLog: { create: jest.fn() },
  telegramRecipient: { upsert: jest.fn() },
};
const mockQueueAdd = jest.fn();
const mockIsAllowed = jest.fn();
const mockVerifySignature = jest.fn();

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
}));
jest.mock('../../services/queue/queues', () => ({
  QueueName: { WEBHOOK_PROCESSING: 'webhook-processing' },
  getQueue: () => ({ add: (...args: unknown[]) => mockQueueAdd(...args) }),
}));
jest.mock('../../services/security/rate-limiter', () => ({
  rateLimiter: { isAllowed: (...args: unknown[]) => mockIsAllowed(...args) },
}));
jest.mock('../../services/integrations/amocrm', () => ({
  amocrmService: { verifyWebhookSignature: (...args: unknown[]) => mockVerifySignature(...args) },
}));

const TENANT_ID = 'tenant-1';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  const app = express();

  // Same raw-body capture as app.ts, so idempotency keys hash the exact bytes received.
  app.use(json({
    verify: (req, _res, buf) => {
      Object.assign(req, { rawBody: buf.toString('utf8') });
    },
  }));
  app.use('/webhooks', webhookRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();

  if (!address || typeof address === 'string') throw new Error('Test server has no TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  jest.resetAllMocks();
  mockIsAllowed.mockResolvedValue({ allowed: true });
  mockVerifySignature.mockReturnValue(true);
  mockQueueAdd.mockResolvedValue({});
  mockDb.auditLog.create.mockResolvedValue({});
  // A redelivery of an event that was already processed: acknowledged, not queued again.
  mockDb.webhookEvent.findFirst.mockResolvedValue({ id: 'evt-stored', processed: true });
  mockDb.integration.update.mockResolvedValue({});
  mockDb.telegramRecipient.upsert.mockResolvedValue({});
});

async function post(path: string, body: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

  return { status: response.status, body: await response.json() };
}

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

describe('POST /webhooks/amocrm', () => {
  const payload = JSON.stringify({ account: { id: 3141 }, leads: { add: [{ id: 1 }] } });

  it('stores the event, enqueues it under an idempotent job id and audits the receipt', async () => {
    mockDb.integration.findFirst.mockResolvedValue({ id: 'int-1', tenantId: TENANT_ID });
    mockDb.webhookEvent.create.mockResolvedValue({ id: 'event-1' });

    const response = await post('/webhooks/amocrm', payload, { 'x-signature': 'sig' });
    const key = buildWebhookIdempotencyKey('amocrm', TENANT_ID, payload);

    expect(response).toEqual({ status: 200, body: { received: true } });
    expect(mockVerifySignature).toHaveBeenCalledWith(payload, 'sig');
    expect(mockDb.integration.findFirst).toHaveBeenCalledWith({
      where: { type: 'amocrm', status: 'active', config: { path: ['account_id'], equals: '3141' } },
    });
    expect(mockDb.webhookEvent.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        source: 'amocrm',
        eventType: 'leads',
        idempotencyKey: key,
        rawPayload: JSON.parse(payload),
        signature: 'sig',
        processed: false,
      },
    });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'process-amocrm-webhook',
      { eventId: 'event-1', tenantId: TENANT_ID, idempotencyKey: key },
      {
        jobId: `process-amocrm-webhook:${TENANT_ID}:${key}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
      },
    );
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        action: 'webhook_received',
        resource: 'webhook',
        resourceId: 'event-1',
        metadata: { source: 'amocrm', eventType: 'leads' },
      },
    });
  });

  it('acknowledges a redelivered payload as a duplicate without enqueueing it again', async () => {
    mockDb.integration.findFirst.mockResolvedValue({ id: 'int-1', tenantId: TENANT_ID });
    mockDb.webhookEvent.create.mockResolvedValueOnce({ id: 'event-1' }).mockRejectedValueOnce(uniqueViolation());

    const first = await post('/webhooks/amocrm', payload, { 'x-amocrm-signature': 'sig' });
    const second = await post('/webhooks/amocrm', payload, { 'x-amocrm-signature': 'sig' });

    expect(first.body).toEqual({ received: true });
    expect(second).toEqual({ status: 200, body: { received: true, duplicate: true } });
    // Both deliveries hash to the same key.
    const keys = mockDb.webhookEvent.create.mock.calls.map((call) => call[0].data.idempotencyKey);

    expect(new Set(keys).size).toBe(1);
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockDb.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('takes the event type from event_type, then contacts, then unknown; reads account_id too', async () => {
    mockDb.integration.findFirst.mockResolvedValue({ id: 'int-1', tenantId: TENANT_ID });
    mockDb.webhookEvent.create.mockResolvedValue({ id: 'event-2' });

    await post('/webhooks/amocrm', JSON.stringify({ account_id: 7, event_type: 'note_added' }));
    await post('/webhooks/amocrm', JSON.stringify({ account_id: 7, contacts: [] }));
    await post('/webhooks/amocrm', JSON.stringify({ account_id: 7 }));

    expect(mockDb.webhookEvent.create.mock.calls.map((call) => call[0].data.eventType)).toEqual(['note_added', 'contacts', 'unknown']);
    expect(mockDb.webhookEvent.create.mock.calls[0][0].data.signature).toBeNull();
  });

  it('rejects a bad signature, a missing account, an unknown account and a rate-limited tenant', async () => {
    mockVerifySignature.mockReturnValueOnce(false);
    expect(await post('/webhooks/amocrm', payload)).toEqual({ status: 403, body: { error: 'Invalid signature' } });

    expect(await post('/webhooks/amocrm', JSON.stringify({ leads: [] })))
      .toEqual({ status: 400, body: { error: 'Missing AmoCRM account id' } });

    mockDb.integration.findFirst.mockResolvedValueOnce(null);
    expect(await post('/webhooks/amocrm', payload)).toEqual({ status: 404, body: { error: 'Integration not found' } });

    mockDb.integration.findFirst.mockResolvedValueOnce({ id: 'int-1', tenantId: TENANT_ID });
    mockIsAllowed.mockResolvedValueOnce({ allowed: false });
    expect(await post('/webhooks/amocrm', payload)).toEqual({ status: 429, body: { error: 'Rate limit exceeded' } });
    expect(mockIsAllowed).toHaveBeenCalledWith(TENANT_ID, 'webhook:amocrm', { maxRequests: 600, windowMs: 60_000, keyPrefix: 'webhook' });
    expect(mockDb.webhookEvent.create).not.toHaveBeenCalled();
  });

  it('answers 500 when storing the event fails for another reason', async () => {
    mockDb.integration.findFirst.mockResolvedValue({ id: 'int-1', tenantId: TENANT_ID });
    mockDb.webhookEvent.create.mockRejectedValue(new Error('db down'));

    expect(await post('/webhooks/amocrm', payload)).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

describe('/webhooks/telegram', () => {
  const update = JSON.stringify({
    update_id: 555,
    message: { text: '/start', chat: { id: 42, type: 'private' }, from: { username: 'ali', first_name: 'Ali' } },
  });

  it('answers the liveness GET', async () => {
    const response = await fetch(`${baseUrl}/webhooks/telegram`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, endpoint: '/webhooks/telegram', requiredHeader: 'x-telegram-bot-api-secret-token' });
  });

  it('stores the private-chat recipient right away, then stores and enqueues the update', async () => {
    mockDb.integration.findFirst.mockResolvedValue({ id: 'tg-1', tenantId: TENANT_ID });
    mockDb.webhookEvent.create.mockResolvedValue({ id: 'event-tg' });

    const response = await post('/webhooks/telegram', update, { 'x-telegram-bot-api-secret-token': 'secret' });

    expect(response).toEqual({ status: 200, body: { received: true } });
    expect(mockDb.integration.findFirst).toHaveBeenCalledWith({
      where: { type: 'telegram', status: 'active', config: { path: ['webhookSecret'], equals: 'secret' } },
    });
    expect(mockDb.telegramRecipient.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { integrationId_chatId: { integrationId: 'tg-1', chatId: '42' } },
      create: expect.objectContaining({ tenantId: TENANT_ID, chatId: '42', username: 'ali', firstName: 'Ali', started: true, lastUpdateId: '555' }),
    }));
    expect(mockDb.integration.update).toHaveBeenCalledWith({ where: { id: 'tg-1' }, data: { lastSyncAt: expect.any(Date) } });
    expect(mockDb.webhookEvent.create.mock.calls[0][0].data).toMatchObject({ source: 'telegram', eventType: 'message', processed: false });
    expect(mockQueueAdd.mock.calls[0][0]).toBe('process-telegram-webhook');
  });

  it('still stores the update when the recipient upsert fails, and ignores a duplicate', async () => {
    mockDb.integration.findFirst.mockResolvedValue({ id: 'tg-1', tenantId: TENANT_ID });
    mockDb.telegramRecipient.upsert.mockRejectedValue(new Error('upsert failed'));
    mockDb.webhookEvent.create.mockResolvedValueOnce({ id: 'event-tg' }).mockRejectedValueOnce(uniqueViolation());

    expect((await post('/webhooks/telegram', update, { 'x-telegram-bot-api-secret-token': 'secret' })).body).toEqual({ received: true });
    expect((await post('/webhooks/telegram', update, { 'x-telegram-bot-api-secret-token': 'secret' })).body)
      .toEqual({ received: true, duplicate: true });
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  it('classifies callback queries and other updates, and skips group chats as recipients', async () => {
    mockDb.integration.findFirst.mockResolvedValue({ id: 'tg-1', tenantId: TENANT_ID });
    mockDb.webhookEvent.create.mockResolvedValue({ id: 'event-tg' });
    const headers = { 'x-telegram-bot-api-secret-token': 'secret' };

    await post('/webhooks/telegram', JSON.stringify({ callback_query: { data: 'x', message: { chat: { id: 1, type: 'group' } } } }), headers);
    await post('/webhooks/telegram', JSON.stringify({ my_chat_member: {} }), headers);

    expect(mockDb.webhookEvent.create.mock.calls.map((call) => call[0].data.eventType)).toEqual(['callback_query', 'update']);
    expect(mockDb.telegramRecipient.upsert).not.toHaveBeenCalled();
  });

  it('rejects a missing secret, an unknown secret and a rate-limited tenant', async () => {
    expect(await post('/webhooks/telegram', update)).toEqual({ status: 403, body: { error: 'Missing Telegram secret token' } });

    mockDb.integration.findFirst.mockResolvedValueOnce(null);
    expect(await post('/webhooks/telegram', update, { 'x-telegram-bot-api-secret-token': 'nope' }))
      .toEqual({ status: 404, body: { error: 'Integration not found' } });

    mockDb.integration.findFirst.mockResolvedValueOnce({ id: 'tg-1', tenantId: TENANT_ID });
    mockIsAllowed.mockResolvedValueOnce({ allowed: false });
    expect(await post('/webhooks/telegram', update, { 'x-telegram-bot-api-secret-token': 'secret' }))
      .toEqual({ status: 429, body: { error: 'Rate limit exceeded' } });
    expect(mockIsAllowed).toHaveBeenCalledWith(TENANT_ID, 'webhook:telegram', { maxRequests: 300, windowMs: 60_000, keyPrefix: 'webhook' });
  });

  it('answers 500 when the database fails', async () => {
    mockDb.integration.findFirst.mockRejectedValue(new Error('db down'));

    expect(await post('/webhooks/telegram', update, { 'x-telegram-bot-api-secret-token': 'secret' }))
      .toEqual({ status: 500, body: { error: 'Internal server error' } });
  });
});

describe('/webhooks/faceid', () => {
  const event = JSON.stringify({ event_type: 'check_in', person_id: 'p1' });

  it('answers the liveness GET', async () => {
    const response = await fetch(`${baseUrl}/webhooks/faceid`);

    expect(await response.json()).toMatchObject({ ok: true, endpoint: '/webhooks/faceid', method: 'POST' });
  });

  it('looks the integration up by the SHA-256 of the bearer token and enqueues the event', async () => {
    mockDb.integration.findFirst.mockResolvedValue({ id: 'fid-1', tenantId: TENANT_ID });
    mockDb.webhookEvent.create.mockResolvedValue({ id: 'event-fid' });

    const response = await post('/webhooks/faceid', event, { authorization: 'Bearer  tok-1 ' });

    expect(response).toEqual({ status: 200, body: { received: true } });
    expect(mockDb.integration.findFirst).toHaveBeenCalledWith({
      where: { type: 'faceid_attendance', status: 'active', config: { path: ['webhookTokenHash'], equals: hashFaceIdWebhookToken('tok-1') } },
    });
    expect(mockDb.webhookEvent.create.mock.calls[0][0].data).toMatchObject({ source: 'faceid', eventType: 'check_in' });
    expect(mockQueueAdd.mock.calls[0][0]).toBe('process-faceid-webhook');
  });

  it('accepts the token from the query string or the body', async () => {
    mockDb.integration.findFirst.mockResolvedValue({ id: 'fid-1', tenantId: TENANT_ID });
    mockDb.webhookEvent.create.mockResolvedValue({ id: 'event-fid' });

    await post('/webhooks/faceid?token=q1', event);
    await post('/webhooks/faceid?webhook_token=q2', event);
    await post('/webhooks/faceid?access_token=q3', event);
    await post('/webhooks/faceid', JSON.stringify({ token: 'b1', request: { event_type: 'nested' } }));
    await post('/webhooks/faceid', JSON.stringify({ webhook_token: 'b2' }));
    await post('/webhooks/faceid', JSON.stringify({ access_token: 'b3' }));

    const hashes = mockDb.integration.findFirst.mock.calls.map((call) => call[0].where.config.equals);

    expect(hashes).toEqual(['q1', 'q2', 'q3', 'b1', 'b2', 'b3'].map(hashFaceIdWebhookToken));
    expect(mockDb.webhookEvent.create.mock.calls.map((call) => call[0].data.eventType))
      .toEqual(['check_in', 'check_in', 'check_in', 'nested', 'check_in_out', 'check_in_out']);
  });

  it('rejects a missing or unknown token, a non-bearer header and a rate-limited tenant', async () => {
    const missing = await post('/webhooks/faceid', event);

    expect(missing.status).toBe(401);
    expect(missing.body.error).toBe('Missing Face ID token');
    expect((await post('/webhooks/faceid', event, { authorization: 'Basic abc' })).status).toBe(401);

    mockDb.integration.findFirst.mockResolvedValueOnce(null);
    expect(await post('/webhooks/faceid?token=bad', event)).toEqual({ status: 403, body: { error: 'Invalid Face ID webhook token' } });

    mockDb.integration.findFirst.mockResolvedValueOnce({ id: 'fid-1', tenantId: TENANT_ID });
    mockIsAllowed.mockResolvedValueOnce({ allowed: false });
    expect(await post('/webhooks/faceid?token=ok', event)).toEqual({ status: 429, body: { error: 'Rate limit exceeded' } });
  });

  it('acknowledges a duplicate and answers 500 on other storage errors', async () => {
    mockDb.integration.findFirst.mockResolvedValue({ id: 'fid-1', tenantId: TENANT_ID });
    mockDb.webhookEvent.create.mockRejectedValueOnce(uniqueViolation()).mockRejectedValueOnce(new Error('db down'));

    expect((await post('/webhooks/faceid?token=ok', event)).body).toEqual({ received: true, duplicate: true });
    expect(await post('/webhooks/faceid?token=ok', event)).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

describe('webhook shared helpers', () => {
  it('hashes source, tenant and payload into the idempotency key', () => {
    const key = buildWebhookIdempotencyKey('amocrm', 't1', '{"a":1}');

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(buildWebhookIdempotencyKey('amocrm', 't1', '{"a":1}')).toBe(key);
    expect(buildWebhookIdempotencyKey('amocrm', 't2', '{"a":1}')).not.toBe(key);
    expect(buildWebhookIdempotencyKey('telegram', 't1', '{"a":1}')).not.toBe(key);
  });

  it('prefers the captured raw body and falls back to the serialized JSON body', () => {
    const withRaw = Object.assign(Object.create(request), { rawBody: ' {"a": 1}', body: { a: 1 } });
    const withoutRaw = Object.assign(Object.create(request), { body: { a: 1 } });
    const empty = Object.create(request);

    expect(getRawBody(withRaw)).toBe(' {"a": 1}');
    expect(getRawBody(withoutRaw)).toBe('{"a":1}');
    expect(getRawBody(empty)).toBe('{}');
  });

  it('writes a rejection audit and swallows a failing audit write', async () => {
    mockDb.auditLog.create.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('audit down'));

    await writeWebhookRejectionAudit({ tenantId: 't1', reason: 'bad_signature', metadata: { ip: '1.2.3.4' } });
    await expect(writeWebhookRejectionAudit({ tenantId: 't1', reason: 'other' })).resolves.toBeUndefined();
    expect(mockDb.auditLog.create).toHaveBeenNthCalledWith(1, {
      data: { tenantId: 't1', action: 'webhook_rejected', resource: 'webhook', metadata: { reason: 'bad_signature', ip: '1.2.3.4' } },
    });
    expect(mockDb.auditLog.create.mock.calls[1][0].data.metadata).toEqual({ reason: 'other' });
  });
});
