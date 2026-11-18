import { systemPrisma } from '@dashboarduz/db';

import * as observability from '../../../services/observability';
import { processAmoCRMWebhook } from '../amocrm-webhook';
import { processFaceIdWebhook } from '../faceid-webhook';
import { processTelegramWebhook } from '../telegram-webhook';
import { processWebhookEvent } from '../webhook-event';

jest.mock('../amocrm-webhook', () => ({ processAmoCRMWebhook: jest.fn() }));
jest.mock('../telegram-webhook', () => ({ processTelegramWebhook: jest.fn() }));
jest.mock('../faceid-webhook', () => ({ processFaceIdWebhook: jest.fn() }));

const amo = jest.mocked(processAmoCRMWebhook);
const telegram = jest.mocked(processTelegramWebhook);
const faceId = jest.mocked(processFaceIdWebhook);

type StoredEvent = {
  id: string;
  tenantId: string | null;
  source: string;
  eventType: string;
  rawPayload: unknown;
  processed: boolean;
};

function storedEvent(fields: Partial<StoredEvent> = {}): StoredEvent {
  return { id: 'evt-1', tenantId: 'tenant-1', source: 'amocrm', eventType: 'leads', rawPayload: {}, processed: false, ...fields };
}

let findEvent: jest.SpyInstance;
let updateEvent: jest.SpyInstance;
let createAudit: jest.SpyInstance;
let reportError: jest.SpyInstance;

beforeEach(() => {
  findEvent = jest.spyOn(systemPrisma.webhookEvent, 'findUnique');
  updateEvent = jest.spyOn(systemPrisma.webhookEvent, 'update').mockResolvedValue({} as never);
  createAudit = jest.spyOn(systemPrisma.auditLog, 'create').mockResolvedValue({} as never);
  reportError = jest.spyOn(observability, 'reportError').mockImplementation(() => undefined);
  amo.mockResolvedValue(undefined);
  telegram.mockResolvedValue(undefined);
  faceId.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('processWebhookEvent', () => {
  it('runs the processor for the source, marks the event processed and audits it', async () => {
    const event = storedEvent();

    findEvent.mockResolvedValue(event as never);

    await processWebhookEvent('evt-1');

    expect(amo).toHaveBeenCalledWith(event, 'tenant-1');
    expect(updateEvent).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { processed: true, processedAt: expect.any(Date), errorMessage: null },
    });
    expect(createAudit).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        action: 'webhook_processed',
        resource: 'webhook',
        resourceId: 'evt-1',
        metadata: { source: 'amocrm', eventType: 'leads' },
      },
    });
  });

  it('processes an event delivered twice only once', async () => {
    let processed = false;

    findEvent.mockImplementation(() => Promise.resolve(storedEvent({ processed })));
    updateEvent.mockImplementation(({ data }: { data: { processed?: boolean } }) => {
      if (data.processed) processed = true;

      return Promise.resolve({});
    });

    await processWebhookEvent('evt-1');
    await processWebhookEvent('evt-1');

    expect(amo).toHaveBeenCalledTimes(1);
    expect(updateEvent).toHaveBeenCalledTimes(1);
    expect(createAudit).toHaveBeenCalledTimes(1);
  });

  it('dispatches telegram and faceid events to their processors', async () => {
    findEvent.mockResolvedValueOnce(storedEvent({ source: 'telegram' }) as never);
    await processWebhookEvent('evt-1');
    findEvent.mockResolvedValueOnce(storedEvent({ source: 'faceid' }) as never);
    await processWebhookEvent('evt-1');

    expect(telegram).toHaveBeenCalledTimes(1);
    expect(faceId).toHaveBeenCalledTimes(1);
    expect(amo).not.toHaveBeenCalled();
  });

  it('marks an unknown source processed without running a processor', async () => {
    findEvent.mockResolvedValue(storedEvent({ source: 'stripe' }) as never);

    await processWebhookEvent('evt-1');

    expect(amo).not.toHaveBeenCalled();
    expect(updateEvent).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processed: true }) }));
  });

  it('resolves the tenant of a tenant-less amoCRM event from its account id', async () => {
    const findIntegration = jest.spyOn(systemPrisma.integration, 'findFirst').mockResolvedValue({ tenantId: 'tenant-9' } as never);

    findEvent.mockResolvedValue(storedEvent({ tenantId: null, rawPayload: { account: { id: 295 } } }) as never);

    await processWebhookEvent('evt-1');

    expect(findIntegration).toHaveBeenCalledWith({
      where: { type: 'amocrm', config: { path: ['account_id'], equals: '295' } },
    });
    expect(amo).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-1' }), 'tenant-9');
  });

  it('closes an event whose tenant cannot be determined', async () => {
    jest.spyOn(systemPrisma.integration, 'findFirst').mockResolvedValue(null);
    findEvent.mockResolvedValue(storedEvent({ tenantId: null, rawPayload: { account_id: '1' } }) as never);

    await processWebhookEvent('evt-1');

    expect(updateEvent).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { processed: true, errorMessage: 'Cannot determine tenant' },
    });
    expect(amo).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('records a processor failure, audits it and rethrows so the job is retried', async () => {
    findEvent.mockResolvedValue(storedEvent() as never);
    amo.mockRejectedValue(new Error('amo down'));

    await expect(processWebhookEvent('evt-1')).rejects.toThrow('amo down');

    expect(updateEvent).toHaveBeenCalledWith({
      where: { id: 'evt-1' },
      data: { errorMessage: 'amo down', retryCount: { increment: 1 } },
    });
    expect(createAudit).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        action: 'webhook_failed',
        resource: 'webhook',
        resourceId: 'evt-1',
        metadata: { error: 'amo down' },
      },
    });
    expect(reportError).toHaveBeenCalledWith('Webhook processing failed', expect.objectContaining({ eventId: 'evt-1', error: 'amo down' }));
  });

  it('fails for a missing event without writing an audit row', async () => {
    findEvent.mockResolvedValue(null);

    await expect(processWebhookEvent('evt-404')).rejects.toThrow('Webhook event evt-404 not found');
    expect(updateEvent).toHaveBeenCalledWith({
      where: { id: 'evt-404' },
      data: { errorMessage: 'Webhook event evt-404 not found', retryCount: { increment: 1 } },
    });
    expect(createAudit).not.toHaveBeenCalled();
  });
});
