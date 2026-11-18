import { systemPrisma } from '@dashboarduz/db';

import { resolveTenantNotificationBotToken } from '../../../lib/telegram';
import { telegramService } from '../../../services/integrations/telegram';
import { queueService } from '../../../services/queue';
import { rateLimiter } from '../../../services/security/rate-limiter';
import { processNotification } from '../notification';

jest.mock('../../../lib/telegram', () => ({ resolveTenantNotificationBotToken: jest.fn() }));

const resolveToken = jest.mocked(resolveTenantNotificationBotToken);

type StoredNotification = {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
};

function storedNotification(fields: Partial<StoredNotification> = {}): StoredNotification {
  return {
    id: 'n-1',
    tenantId: 'tenant-1',
    type: 'telegram',
    status: 'pending',
    payload: { chatId: 42, text: 'Hello', options: { parse_mode: 'HTML' } },
    attempts: 0,
    maxAttempts: 3,
    ...fields,
  };
}

let findNotification: jest.SpyInstance;
let updateNotification: jest.SpyInstance;
let sendMessage: jest.SpyInstance;
let isAllowed: jest.SpyInstance;
let addNotificationJob: jest.SpyInstance;

beforeEach(() => {
  resolveToken.mockResolvedValue('bot-token');
  findNotification = jest.spyOn(systemPrisma.notification, 'findUnique').mockResolvedValue(storedNotification() as never);
  updateNotification = jest.spyOn(systemPrisma.notification, 'update').mockResolvedValue({} as never);
  sendMessage = jest.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true });
  isAllowed = jest.spyOn(rateLimiter, 'isAllowed').mockResolvedValue({ allowed: true } as never);
  addNotificationJob = jest.spyOn(queueService, 'addNotificationJob').mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('processNotification', () => {
  it('sends a telegram notification and marks it sent', async () => {
    await processNotification('n-1');

    expect(isAllowed).toHaveBeenCalledWith('tenant-1', 'notifications:fanout', {
      maxRequests: 120,
      windowMs: 60000,
      keyPrefix: 'notifications',
    });
    expect(sendMessage).toHaveBeenCalledWith('bot-token', '42', 'Hello', { parse_mode: 'HTML' });
    expect(updateNotification).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { status: 'sent', sentAt: expect.any(Date), attempts: { increment: 1 }, errorMessage: null },
    });
  });

  it('does nothing for a notification already sent', async () => {
    findNotification.mockResolvedValue(storedNotification({ status: 'sent' }));

    await processNotification('n-1');

    expect(sendMessage).not.toHaveBeenCalled();
    expect(updateNotification).not.toHaveBeenCalled();
  });

  it('schedules a retry with exponential delay when sending fails', async () => {
    const now = 1_800_000_000_000;

    jest.spyOn(Date, 'now').mockReturnValue(now);
    findNotification.mockResolvedValue(storedNotification({ attempts: 1, payload: { chatId: 42 } }));

    await expect(processNotification('n-1')).rejects.toThrow('Telegram payload must include chatId and text');

    expect(updateNotification).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: {
        attempts: { increment: 1 },
        errorMessage: 'Telegram payload must include chatId and text',
        status: 'retrying',
        nextRetryAt: new Date(now + 2000),
      },
    });
    expect(addNotificationJob).toHaveBeenCalledWith('n-1', { delay: 2000 });
  });

  it('marks the notification failed on its last attempt', async () => {
    findNotification.mockResolvedValue(storedNotification({ attempts: 2 }));
    sendMessage.mockRejectedValue(new Error('Telegram is down'));

    await expect(processNotification('n-1')).rejects.toThrow('Telegram is down');

    expect(updateNotification).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { attempts: { increment: 1 }, errorMessage: 'Telegram is down', status: 'failed', nextRetryAt: null },
    });
    expect(addNotificationJob).not.toHaveBeenCalled();
  });

  it('closes the notification without a send, error or retry when the tenant has no active Telegram integration', async () => {
    resolveToken.mockResolvedValue(null);

    await expect(processNotification('n-1')).resolves.toBeUndefined();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(updateNotification).toHaveBeenCalledTimes(1);
    expect(updateNotification).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: {
        status: 'failed',
        attempts: { increment: 1 },
        errorMessage: 'No active Telegram integration; not sent',
        nextRetryAt: null,
      },
    });
    expect(addNotificationJob).not.toHaveBeenCalled();
  });

  it('fails unsupported channels and the tenant rate limit', async () => {
    findNotification.mockResolvedValue(storedNotification({ type: 'email' }));
    await expect(processNotification('n-1')).rejects.toThrow('Email notification not implemented');

    findNotification.mockResolvedValue(storedNotification({ type: 'sms' }));
    await expect(processNotification('n-1')).rejects.toThrow('SMS notification not implemented');

    findNotification.mockResolvedValue(storedNotification({ type: 'push' }));
    await expect(processNotification('n-1')).rejects.toThrow('Unsupported notification type: push');

    isAllowed.mockResolvedValue({ allowed: false });
    await expect(processNotification('n-1')).rejects.toThrow('Per-tenant notification rate limit exceeded');
  });

  it('rethrows without bookkeeping when the notification does not exist', async () => {
    findNotification.mockResolvedValue(null);

    await expect(processNotification('n-404')).rejects.toThrow('Notification n-404 not found');
    expect(updateNotification).not.toHaveBeenCalled();
  });
});
