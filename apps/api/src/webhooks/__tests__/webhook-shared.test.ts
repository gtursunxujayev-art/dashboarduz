import { systemPrisma } from '@dashboarduz/db';
import type { Request } from 'express';

import * as queues from '../../services/queue/queues';
import {
  buildWebhookIdempotencyKey,
  enqueueWebhookJob,
  getRawBody,
  isUniqueViolation,
  writeWebhookRejectionAudit,
} from '../shared';

function fakeRequest(fields: Record<string, unknown>): Request {
  return fields as unknown as Request;
}

describe('getRawBody', () => {
  it('returns the captured raw body when the parser stored one', () => {
    expect(getRawBody(fakeRequest({ rawBody: 'a=1&b=2', body: { a: '1' } }))).toBe('a=1&b=2');
  });

  it('re-serializes the parsed body otherwise', () => {
    expect(getRawBody(fakeRequest({ body: { update_id: 5 } }))).toBe('{"update_id":5}');
    expect(getRawBody(fakeRequest({ rawBody: Buffer.from('x'), body: { a: 1 } }))).toBe('{"a":1}');
    expect(getRawBody(fakeRequest({}))).toBe('{}');
  });
});

describe('buildWebhookIdempotencyKey', () => {
  it('is the sha256 of source:tenant:payload, so the same delivery always gives the same key', () => {
    const key = buildWebhookIdempotencyKey('amocrm', 'tenant-1', '{"a":1}');

    expect(key).toBe('9849534fbfab61c5384fdfafb1b8a0c2ecca06813a2b362f211cc80ba8802cf0');
    expect(buildWebhookIdempotencyKey('amocrm', 'tenant-1', '{"a":1}')).toBe(key);
    expect(buildWebhookIdempotencyKey('telegram', 'tenant-1', '{"a":1}')).not.toBe(key);
    expect(buildWebhookIdempotencyKey('amocrm', 'tenant-2', '{"a":1}')).not.toBe(key);
    expect(buildWebhookIdempotencyKey('amocrm', 'tenant-1', '{"a":2}')).not.toBe(key);
  });
});

describe('isUniqueViolation', () => {
  it('recognises Prisma P2002 only', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
    expect(isUniqueViolation(new Error('P2002'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('enqueueWebhookJob', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds one job per delivery with a job id derived from the idempotency key', async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const getQueue = jest.spyOn(queues, 'getQueue').mockReturnValue({ add } as unknown as ReturnType<typeof queues.getQueue>);

    const params = { jobName: 'process-amocrm-webhook', eventId: 'evt-1', tenantId: 't-1', idempotencyKey: 'abc' };

    await enqueueWebhookJob(params);
    await enqueueWebhookJob(params);

    expect(getQueue).toHaveBeenCalledWith(queues.QueueName.WEBHOOK_PROCESSING);
    expect(add).toHaveBeenNthCalledWith(
      1,
      'process-amocrm-webhook',
      { eventId: 'evt-1', tenantId: 't-1', idempotencyKey: 'abc' },
      {
        jobId: 'process-amocrm-webhook:t-1:abc',
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
      },
    );
    // A redelivery reuses the job id, which BullMQ deduplicates.
    expect(add.mock.calls[1]).toEqual(add.mock.calls[0]);
  });
});

describe('writeWebhookRejectionAudit', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes a webhook_rejected audit row with the reason and metadata', async () => {
    const create = jest.spyOn(systemPrisma.auditLog, 'create').mockResolvedValue({} as never);

    await writeWebhookRejectionAudit({ tenantId: 't-1', reason: 'bad_signature', metadata: { ip: '1.2.3.4' } });

    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: 't-1',
        action: 'webhook_rejected',
        resource: 'webhook',
        metadata: { reason: 'bad_signature', ip: '1.2.3.4' },
      },
    });
  });

  it('swallows audit write failures', async () => {
    jest.spyOn(systemPrisma.auditLog, 'create').mockRejectedValue(new Error('db down'));

    await expect(writeWebhookRejectionAudit({ tenantId: 't-1', reason: 'x' })).resolves.toBeUndefined();
  });
});
