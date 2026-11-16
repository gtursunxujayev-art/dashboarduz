import { systemPrisma as prisma } from '@dashboarduz/db';

import { getWebhookEventRetentionDays, purgeProcessedWebhookEvents } from '../webhook-event-retention';

describe('webhook event retention', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('defaults to 90 days and accepts a positive override', () => {
    expect(getWebhookEventRetentionDays({})).toBe(90);
    expect(getWebhookEventRetentionDays({ WEBHOOK_EVENT_RETENTION_DAYS: '30' })).toBe(30);
    expect(getWebhookEventRetentionDays({ WEBHOOK_EVENT_RETENTION_DAYS: '0' })).toBe(90);
    expect(getWebhookEventRetentionDays({ WEBHOOK_EVENT_RETENTION_DAYS: 'abc' })).toBe(90);
  });

  it('deletes only processed events older than the cutoff', async () => {
    const findMany = jest.spyOn(prisma.webhookEvent, 'findMany').mockResolvedValue([{ id: 'a' }, { id: 'b' }] as never);
    const deleteMany = jest.spyOn(prisma.webhookEvent, 'deleteMany').mockResolvedValue({ count: 2 });

    const now = new Date('2026-11-16T00:00:00Z');

    await expect(purgeProcessedWebhookEvents(now, 90)).resolves.toBe(2);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { processed: true, createdAt: { lt: new Date('2026-08-18T00:00:00Z') } },
    }));
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } } });
  });

  it('does nothing when there is nothing to purge', async () => {
    jest.spyOn(prisma.webhookEvent, 'findMany').mockResolvedValue([] as never);
    const deleteMany = jest.spyOn(prisma.webhookEvent, 'deleteMany');

    await expect(purgeProcessedWebhookEvents(new Date(), 90)).resolves.toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
