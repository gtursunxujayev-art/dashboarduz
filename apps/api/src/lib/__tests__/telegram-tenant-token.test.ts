import { systemPrisma, type DbClient } from '@dashboarduz/db';

import { telegramService } from '../../services/integrations/telegram';
import { decryptIntegrationTokens } from '../../services/security/encryption';
import { rateLimiter } from '../../services/security/rate-limiter';
import { processNotification } from '../../workers/processors/notification';
import { resolveTelegramBotTokenForTenant, resolveTenantNotificationBotToken } from '../telegram';

jest.mock('../../services/security/encryption', () => ({
  ...jest.requireActual<typeof import('../../services/security/encryption')>('../../services/security/encryption'),
  decryptIntegrationTokens: jest.fn(),
}));

const decrypt = jest.mocked(decryptIntegrationTokens);

type IntegrationRow = { status: string; tokensEncrypted: string | null } | null;

const cases: Array<[string, IntegrationRow, string | null]> = [
  ['no integration', null, null],
  ['an inactive integration', { status: 'inactive', tokensEncrypted: 'enc' }, null],
  ['an active integration', { status: 'active', tokensEncrypted: 'enc' }, 'tenant-token'],
];

function dbWithIntegration(row: IntegrationRow): DbClient {
  return { integration: { findUnique: jest.fn().mockResolvedValue(row) } } as unknown as DbClient;
}

describe('tenant notification bot token (owner rule: no platform-bot fallback)', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'platform-token';
    decrypt.mockReturnValue({ botToken: 'tenant-token' });
  });

  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it.each(cases)('with %s gives the tenant token or nothing', async (_label, row, expected) => {
    await expect(resolveTenantNotificationBotToken('t1', dbWithIntegration(row))).resolves.toBe(expected);
  });

  it('gives nothing when the active integration token cannot be decrypted', async () => {
    decrypt.mockImplementation(() => {
      throw new Error('bad key');
    });

    await expect(resolveTenantNotificationBotToken('t1', dbWithIntegration({ status: 'active', tokensEncrypted: 'enc' }))).resolves.toBeNull();
  });

  it('keeps the platform fallback for non-notification callers', async () => {
    await expect(resolveTelegramBotTokenForTenant('t1', dbWithIntegration(null))).resolves.toBe('platform-token');
    await expect(resolveTelegramBotTokenForTenant('t1', dbWithIntegration({ status: 'inactive', tokensEncrypted: 'enc' }))).resolves.toBe('platform-token');
  });

  describe('notification worker', () => {
    let send: jest.SpyInstance;
    let update: jest.SpyInstance;

    beforeEach(() => {
      jest.spyOn(systemPrisma.notification, 'findUnique').mockResolvedValue({
        id: 'n-1', tenantId: 't1', type: 'telegram', status: 'pending',
        payload: { chatId: 42, text: 'Hello' }, attempts: 0, maxAttempts: 3,
      } as never);
      update = jest.spyOn(systemPrisma.notification, 'update').mockResolvedValue({} as never);
      jest.spyOn(rateLimiter, 'isAllowed').mockResolvedValue({ allowed: true } as never);
      send = jest.spyOn(telegramService, 'sendMessage').mockResolvedValue({ ok: true } as never);
    });

    it.each(cases)('with %s sends only through the tenant token', async (_label, row, expected) => {
      jest.spyOn(systemPrisma.integration, 'findUnique').mockResolvedValue(row as never);

      await expect(processNotification('n-1')).resolves.toBeUndefined();

      if (expected) {
        expect(send).toHaveBeenCalledWith('tenant-token', '42', 'Hello', undefined);
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'sent' }) }));
      } else {
        expect(send).not.toHaveBeenCalled();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ status: 'failed', nextRetryAt: null, errorMessage: 'No active Telegram integration; not sent' }),
        }));
      }
    });
  });
});
