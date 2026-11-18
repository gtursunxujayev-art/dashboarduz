import { systemPrisma as prisma } from '@dashboarduz/db';

import * as queues from '../queue/queues';
import { requeueStrandedWebhookEvents } from '../webhook-requeue-sweeper';

describe('webhook re-queue sweeper', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  let queueAdd: jest.Mock;

  beforeEach(() => {
    queueAdd = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(queues, 'getQueue').mockReturnValue({ add: queueAdd } as unknown as ReturnType<typeof queues.getQueue>);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('re-queues only never-attempted events older than five minutes, under the handler job id', async () => {
    const findMany = jest.spyOn(prisma.webhookEvent, 'findMany').mockResolvedValue([
      { id: 'evt-1', tenantId: 't-1', source: 'amocrm', idempotencyKey: 'k1' },
      { id: 'evt-2', tenantId: 't-2', source: 'faceid', idempotencyKey: 'k2' },
    ] as never);

    await expect(requeueStrandedWebhookEvents(now)).resolves.toEqual({ requeued: 2, failed: 0 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ processed: false, retryCount: 0, createdAt: { lt: new Date('2026-11-18T11:55:00Z') } }),
    }));
    expect(queueAdd).toHaveBeenCalledWith('process-amocrm-webhook', { eventId: 'evt-1', tenantId: 't-1', idempotencyKey: 'k1' }, expect.objectContaining({ jobId: 'process-amocrm-webhook:t-1:k1' }));
    expect(queueAdd).toHaveBeenCalledWith('process-faceid-webhook', expect.anything(), expect.objectContaining({ jobId: 'process-faceid-webhook:t-2:k2' }));
  });

  it('keeps going when one enqueue fails and reports it', async () => {
    jest.spyOn(prisma.webhookEvent, 'findMany').mockResolvedValue([
      { id: 'evt-1', tenantId: 't-1', source: 'telegram', idempotencyKey: 'k1' },
      { id: 'evt-2', tenantId: 't-1', source: 'telegram', idempotencyKey: 'k2' },
    ] as never);
    queueAdd.mockRejectedValueOnce(new Error('Redis down'));

    await expect(requeueStrandedWebhookEvents(now)).resolves.toEqual({ requeued: 1, failed: 1 });
  });
});
