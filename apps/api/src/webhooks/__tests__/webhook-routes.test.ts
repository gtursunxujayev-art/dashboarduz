import type { IncomingMessage, Server } from 'http';
import type { AddressInfo } from 'net';

import { systemPrisma } from '@dashboarduz/db';
import express, { json, urlencoded } from 'express';

import { hashFaceIdWebhookToken } from '../../services/attendance/faceid';
import { amocrmService } from '../../services/integrations/amocrm';
import * as recipientStore from '../../services/integrations/telegram-recipient-store';
import * as queues from '../../services/queue/queues';
import { rateLimiter } from '../../services/security/rate-limiter';
import webhookRouter from '../index';
import { buildWebhookIdempotencyKey } from '../shared';

type RawBodyRequest = IncomingMessage & { rawBody?: string };

// The body parsers as app.ts configures them (app.ts itself starts schedulers and validates env on import).
const app = express();

app.use(json({
  verify: (req: RawBodyRequest, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));
app.use(urlencoded({
  extended: true,
  verify: (req: RawBodyRequest, _res, buf) => {
    if (!req.rawBody) req.rawBody = buf.toString('utf8');
  },
}));
app.use('/webhooks', webhookRouter);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(path: string, body: string, headers: Record<string, string>) {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', body, headers });

  return { status: response.status, body: (await response.json()) as unknown };
}

const integration = { id: 'int-1', tenantId: 'tenant-1' };

let queueAdd: jest.Mock;
let createEvent: jest.SpyInstance;
let createAudit: jest.SpyInstance;
let findIntegration: jest.SpyInstance;
let isAllowed: jest.SpyInstance;

beforeEach(() => {
  queueAdd = jest.fn().mockResolvedValue(undefined);
  jest.spyOn(queues, 'getQueue').mockReturnValue({ add: queueAdd } as unknown as ReturnType<typeof queues.getQueue>);
  findIntegration = jest.spyOn(systemPrisma.integration, 'findFirst').mockResolvedValue(integration as never);
  isAllowed = jest.spyOn(rateLimiter, 'isAllowed').mockResolvedValue({ allowed: true } as never);
  createEvent = jest.spyOn(systemPrisma.webhookEvent, 'create').mockResolvedValue({ id: 'evt-1' } as never);
  createAudit = jest.spyOn(systemPrisma.auditLog, 'create').mockResolvedValue({} as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /webhooks/amocrm', () => {
  const form = 'account%5Bid%5D=29500000&leads%5Badd%5D%5B0%5D%5Bid%5D=101';
  const formHeaders = { 'content-type': 'application/x-www-form-urlencoded', 'x-signature': 'sig' };

  beforeEach(() => {
    jest.spyOn(amocrmService, 'verifyWebhookSignature').mockReturnValue(true);
  });

  it('checks the signature against the raw form body', async () => {
    const verify = jest.spyOn(amocrmService, 'verifyWebhookSignature').mockReturnValue(false);

    await expect(post('/webhooks/amocrm', form, formHeaders)).resolves.toEqual({
      status: 403,
      body: { error: 'Invalid signature' },
    });
    expect(verify).toHaveBeenCalledWith(form, 'sig');
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('accepts the x-amocrm-signature header too', async () => {
    const verify = jest.spyOn(amocrmService, 'verifyWebhookSignature').mockReturnValue(false);

    await post('/webhooks/amocrm', form, { 'content-type': 'application/x-www-form-urlencoded', 'x-amocrm-signature': 'alt' });
    expect(verify).toHaveBeenCalledWith(form, 'alt');
  });

  it('rejects a webhook without an account id', async () => {
    await expect(post('/webhooks/amocrm', 'leads%5Badd%5D%5B0%5D%5Bid%5D=1', formHeaders)).resolves.toEqual({
      status: 400,
      body: { error: 'Missing AmoCRM account id' },
    });
  });

  it('answers 404 when no active integration has the account id', async () => {
    findIntegration.mockResolvedValue(null);

    await expect(post('/webhooks/amocrm', form, formHeaders)).resolves.toEqual({
      status: 404,
      body: { error: 'Integration not found' },
    });
    expect(findIntegration).toHaveBeenCalledWith({
      where: { type: 'amocrm', status: 'active', config: { path: ['account_id'], equals: '29500000' } },
    });
  });

  it('answers 429 when the tenant is over its webhook rate limit', async () => {
    isAllowed.mockResolvedValue({ allowed: false });

    await expect(post('/webhooks/amocrm', form, formHeaders)).resolves.toEqual({
      status: 429,
      body: { error: 'Rate limit exceeded' },
    });
    expect(isAllowed).toHaveBeenCalledWith('tenant-1', 'webhook:amocrm', { maxRequests: 600, windowMs: 60000, keyPrefix: 'webhook' });
  });

  it('stores the event, enqueues it and audits it', async () => {
    const key = buildWebhookIdempotencyKey('amocrm', 'tenant-1', form);

    await expect(post('/webhooks/amocrm', form, formHeaders)).resolves.toEqual({ status: 200, body: { received: true } });
    expect(createEvent).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        source: 'amocrm',
        eventType: 'leads',
        idempotencyKey: key,
        rawPayload: { account: { id: '29500000' }, leads: { add: [{ id: '101' }] } },
        signature: 'sig',
        processed: false,
      },
    });
    expect(queueAdd).toHaveBeenCalledWith(
      'process-amocrm-webhook',
      { eventId: 'evt-1', tenantId: 'tenant-1', idempotencyKey: key },
      expect.objectContaining({ jobId: `process-amocrm-webhook:tenant-1:${key}` }),
    );
    expect(createAudit).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        action: 'webhook_received',
        resource: 'webhook',
        resourceId: 'evt-1',
        metadata: { source: 'amocrm', eventType: 'leads' },
      },
    });
  });

  it('processes the same delivery once: the second insert hits the unique key and is acknowledged as a duplicate', async () => {
    const stored = new Set<string>();

    createEvent.mockImplementation(({ data }: { data: { idempotencyKey: string } }) => {
      if (stored.has(data.idempotencyKey)) {
        return Promise.reject(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));
      }
      stored.add(data.idempotencyKey);

      return Promise.resolve({ id: 'evt-1' });
    });

    await expect(post('/webhooks/amocrm', form, formHeaders)).resolves.toEqual({ status: 200, body: { received: true } });
    await expect(post('/webhooks/amocrm', form, formHeaders)).resolves.toEqual({
      status: 200,
      body: { received: true, duplicate: true },
    });
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(createAudit).toHaveBeenCalledTimes(1);
  });

  it('answers 500 when storing the event fails for another reason', async () => {
    createEvent.mockRejectedValue(new Error('db down'));

    await expect(post('/webhooks/amocrm', form, formHeaders)).resolves.toEqual({
      status: 500,
      body: { error: 'Internal server error' },
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('answers 500 for an event_type that is not text (the event row could not be stored)', async () => {
    const body = JSON.stringify({ account_id: 1, event_type: 5 });

    await expect(post('/webhooks/amocrm', body, { 'content-type': 'application/json' })).resolves.toEqual({
      status: 500,
      body: { error: 'Internal server error' },
    });
    expect(createEvent).not.toHaveBeenCalled();
  });
});

describe('/webhooks/telegram', () => {
  const update = { update_id: 912, message: { chat: { id: 42, type: 'private' }, from: { username: 'ali' }, text: '/start' } };
  const raw = JSON.stringify(update);
  const headers = { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'secret' };

  it('describes itself on GET', async () => {
    const response = await fetch(`${baseUrl}/webhooks/telegram`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      endpoint: '/webhooks/telegram',
      method: 'POST',
      message: 'Telegram webhook endpoint is alive. Telegram will send POST requests here.',
      requiredHeader: 'x-telegram-bot-api-secret-token',
    });
  });

  it('requires the secret token header', async () => {
    await expect(post('/webhooks/telegram', raw, { 'content-type': 'application/json' })).resolves.toEqual({
      status: 403,
      body: { error: 'Missing Telegram secret token' },
    });
  });

  it('answers 404 for an unknown secret', async () => {
    findIntegration.mockResolvedValue(null);

    await expect(post('/webhooks/telegram', raw, headers)).resolves.toEqual({
      status: 404,
      body: { error: 'Integration not found' },
    });
    expect(findIntegration).toHaveBeenCalledWith({
      where: { type: 'telegram', status: 'active', config: { path: ['webhookSecret'], equals: 'secret' } },
    });
  });

  it('records the recipient, stores and enqueues the update', async () => {
    const upsert = jest.spyOn(recipientStore, 'upsertTelegramRecipientRecord').mockResolvedValue(undefined as never);
    const updateIntegration = jest.spyOn(systemPrisma.integration, 'update').mockResolvedValue({} as never);

    await expect(post('/webhooks/telegram', raw, headers)).resolves.toEqual({ status: 200, body: { received: true } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      integrationId: 'int-1',
      chatId: '42',
      username: 'ali',
      started: true,
      lastUpdateId: '912',
    }), systemPrisma);
    expect(updateIntegration).toHaveBeenCalledWith({ where: { id: 'int-1' }, data: { lastSyncAt: expect.any(Date) } });
    expect(createEvent).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        source: 'telegram',
        eventType: 'message',
        idempotencyKey: buildWebhookIdempotencyKey('telegram', 'tenant-1', raw),
        rawPayload: update,
        processed: false,
      },
    });
    expect(queueAdd).toHaveBeenCalledWith('process-telegram-webhook', expect.anything(), expect.anything());
  });

  it('still stores the update when the recipient upsert fails', async () => {
    jest.spyOn(recipientStore, 'upsertTelegramRecipientRecord').mockRejectedValue(new Error('boom'));

    await expect(post('/webhooks/telegram', raw, headers)).resolves.toEqual({ status: 200, body: { received: true } });
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a duplicate update without enqueueing it again', async () => {
    jest.spyOn(recipientStore, 'upsertTelegramRecipientRecord').mockResolvedValue(undefined as never);
    jest.spyOn(systemPrisma.integration, 'update').mockResolvedValue({} as never);
    createEvent.mockRejectedValue({ code: 'P2002' });

    await expect(post('/webhooks/telegram', raw, headers)).resolves.toEqual({
      status: 200,
      body: { received: true, duplicate: true },
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe('/webhooks/faceid', () => {
  const event = { event_type: 'check_in', employee_id: '7' };
  const raw = JSON.stringify(event);

  it('describes itself on GET', async () => {
    const response = await fetch(`${baseUrl}/webhooks/faceid`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ ok: true, endpoint: '/webhooks/faceid' }));
  });

  it('requires a token', async () => {
    await expect(post('/webhooks/faceid', raw, { 'content-type': 'application/json' })).resolves.toEqual({
      status: 401,
      body: {
        error: 'Missing Face ID token',
        acceptedAuth: ['Authorization: Bearer <token>', '?token=<token>', '?webhook_token=<token>', 'body.token'],
      },
    });
  });

  it('looks the integration up by the token hash (bearer, query or body)', async () => {
    findIntegration.mockResolvedValue(null);

    await expect(post('/webhooks/faceid', raw, { 'content-type': 'application/json', authorization: 'Bearer tok-1' })).resolves.toEqual({
      status: 403,
      body: { error: 'Invalid Face ID webhook token' },
    });
    await post('/webhooks/faceid?webhook_token=%20tok-2%20', raw, { 'content-type': 'application/json' });
    await post('/webhooks/faceid', JSON.stringify({ ...event, access_token: 'tok-3' }), { 'content-type': 'application/json' });

    const hashes = findIntegration.mock.calls.map(([args]: [{ where: { config: { equals: string } } }]) => args.where.config.equals);

    expect(hashes).toEqual([hashFaceIdWebhookToken('tok-1'), hashFaceIdWebhookToken('tok-2'), hashFaceIdWebhookToken('tok-3')]);
  });

  it('stores and enqueues the device event', async () => {
    await expect(post('/webhooks/faceid?token=tok', raw, { 'content-type': 'application/json' })).resolves.toEqual({
      status: 200,
      body: { received: true },
    });
    expect(createEvent).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        source: 'faceid',
        eventType: 'check_in',
        idempotencyKey: buildWebhookIdempotencyKey('faceid', 'tenant-1', raw),
        rawPayload: event,
        processed: false,
      },
    });
    expect(queueAdd).toHaveBeenCalledWith('process-faceid-webhook', expect.anything(), expect.anything());
  });

  it('acknowledges a duplicate device event without enqueueing it again', async () => {
    createEvent.mockRejectedValue({ code: 'P2002' });

    await expect(post('/webhooks/faceid?token=tok', raw, { 'content-type': 'application/json' })).resolves.toEqual({
      status: 200,
      body: { received: true, duplicate: true },
    });
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
