import { sanitizeTelegramUsername } from '@dashboarduz/shared';

import { telegramService } from '../../services/integrations/telegram';
import {
  getOfflineTelegramGroupIds,
  getOnlineTelegramGroupIds,
  parseTelegramGroupIds,
  parseTelegramGroupIdsFromEnvKeys,
} from '../../services/integrations/telegram-groups';
import * as encryption from '../../services/security/encryption';
import { logger } from '../logger';
import {
  buildLooseTelegramChatIdCandidates,
  buildTelegramChatIdCandidates,
  normalizeTelegramBotToken,
  parseTelegramDailyReportCourseIds,
  resolveTelegramBotToken,
  resolveTelegramBotTokenForTenant,
  sendMessageToTelegramChat,
  toHashtag,
} from '../telegram';

describe('normalizeTelegramBotToken', () => {
  it('strips wrapping quotes, trims and removes line breaks', () => {
    expect(normalizeTelegramBotToken('  abc  ')).toBe('abc');
    expect(normalizeTelegramBotToken('"abc"')).toBe('abc');
    expect(normalizeTelegramBotToken('`abc`\n')).toBe('abc');
    expect(normalizeTelegramBotToken(' a\r\nb \n')).toBe('ab');
    expect(normalizeTelegramBotToken('``')).toBeNull();
    expect(normalizeTelegramBotToken('   ')).toBeNull();
    expect(normalizeTelegramBotToken(undefined)).toBeNull();
  });
});

describe('resolveTelegramBotToken (one rule for every router, scheduler and worker)', () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;

  beforeEach(() => {
    jest.spyOn(encryption, 'decryptIntegrationTokens').mockImplementation((value: string) => {
      if (value === 'garbage') throw new Error('bad ciphertext');

      return JSON.parse(value);
    });
  });

  afterEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = originalToken;
    jest.restoreAllMocks();
  });

  function fakeDb(integration: { status: string; tokensEncrypted: string | null } | null) {
    return { integration: { findUnique: jest.fn().mockResolvedValue(integration) } } as never;
  }

  it('uses an active integration token, otherwise TELEGRAM_BOT_TOKEN', async () => {
    process.env.TELEGRAM_BOT_TOKEN = '"env-token"';
    const tokensEncrypted = JSON.stringify({ botToken: ' tenant-token ' });

    await expect(resolveTelegramBotTokenForTenant('t1', fakeDb({ status: 'active', tokensEncrypted }))).resolves.toBe('tenant-token');
    await expect(resolveTelegramBotTokenForTenant('t1', fakeDb(null))).resolves.toBe('env-token');
  });

  it('never uses the token of an inactive integration (two routers used it regardless of status)', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    const tokensEncrypted = JSON.stringify({ token: 'tenant-token' });

    for (const status of ['error', 'pending', 'disconnected']) {
      expect(resolveTelegramBotToken({ status, tokensEncrypted })).toBe('env-token');
    }
    expect(resolveTelegramBotToken({ status: 'active', tokensEncrypted })).toBe('tenant-token');
  });

  it('falls back when the active integration has no usable token, and is null when nothing is set', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    expect(resolveTelegramBotToken({ status: 'active', tokensEncrypted: JSON.stringify({ botToken: '  ' }) })).toBe('env-token');
    expect(resolveTelegramBotToken({ status: 'active', tokensEncrypted: null })).toBe('env-token');

    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(resolveTelegramBotToken(null)).toBeNull();
  });

  it('logs and falls back when the stored token cannot be decrypted', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token';
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(resolveTelegramBotTokenForTenant('t1', fakeDb({ status: 'active', tokensEncrypted: 'garbage' }))).resolves.toBe('env-token');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }), expect.stringContaining('could not be decrypted'));
  });
});

describe('chat id candidates', () => {
  it('group candidates toggle the -100 supergroup prefix', () => {
    expect(buildTelegramChatIdCandidates(' -100123 ')).toEqual(['-100123', '-123']);
    expect(buildTelegramChatIdCandidates('-123')).toEqual(['-123', '-100123']);
    expect(buildTelegramChatIdCandidates('@channel')).toEqual(['@channel']);
    expect(buildTelegramChatIdCandidates('')).toEqual([]);
  });

  it('loose candidates (agent performance scheduler) never strip -100', () => {
    expect(buildLooseTelegramChatIdCandidates('-100123')).toEqual(['-100123']);
    expect(buildLooseTelegramChatIdCandidates('-123')).toEqual(['-123', '-100123']);
    expect(buildLooseTelegramChatIdCandidates('123')).toEqual(['123', '-100123']);
    expect(buildLooseTelegramChatIdCandidates('@user1')).toEqual(['@user1', '1', '-1001']);
    expect(buildLooseTelegramChatIdCandidates('  ')).toEqual([]);
  });
});

describe('sendMessageToTelegramChat', () => {
  afterEach(() => jest.restoreAllMocks());

  it('tries candidates until one succeeds', async () => {
    const send = jest.spyOn(telegramService, 'sendMessage')
      .mockRejectedValueOnce(new Error('chat not found'))
      .mockResolvedValueOnce({} as never);

    await sendMessageToTelegramChat('token', '-123', 'hi');
    expect(send.mock.calls.map((call) => call[1])).toEqual(['-123', '-100123']);
  });

  it('throws the last error, or the configured empty-id message', async () => {
    jest.spyOn(telegramService, 'sendMessage').mockRejectedValue(new Error('forbidden'));

    await expect(sendMessageToTelegramChat('token', '5', 'hi')).rejects.toThrow('forbidden');
    await expect(sendMessageToTelegramChat('token', ' ', 'hi')).rejects.toThrow('Empty Telegram chat id');
    await expect(sendMessageToTelegramChat('token', '', 'hi', {
      buildCandidates: buildLooseTelegramChatIdCandidates,
      emptyChatIdMessage: 'Telegram chat id is empty',
    })).rejects.toThrow('Telegram chat id is empty');
  });
});

describe('toHashtag', () => {
  it('builds a hashtag or null', () => {
    expect(toHashtag("Foundation O'zbek tili")).toBe('#Foundation_Ozbek_tili');
    expect(toHashtag('!!!')).toBeNull();
    expect(toHashtag(null)).toBeNull();
    // corporate-calls used to fall back to '#manager' inside its copy; it now does `?? '#manager'`.
    expect(toHashtag('') ?? '#manager').toBe('#manager');
  });
});

describe('parseTelegramDailyReportCourseIds', () => {
  it('takes up to three unique trimmed ids', () => {
    expect(parseTelegramDailyReportCourseIds({ telegramDailyReportCourseIds: [' a ', 'a', 'b', '', 'c', 'd'] })).toEqual(['a', 'b', 'c']);
    expect(parseTelegramDailyReportCourseIds([])).toEqual([]);
    expect(parseTelegramDailyReportCourseIds({ telegramDailyReportCourseIds: 'a' })).toEqual([]);
  });
});

describe('sanitizeTelegramUsername', () => {
  it('keeps letters, digits, underscore and @', () => {
    expect(sanitizeTelegramUsername(' @user_name-1 ! ')).toBe('@user_name1');
  });
});

describe('telegram group id parsers', () => {
  it('lenient parser splits on , ; and newlines and strips quotes/whitespace', () => {
    expect(parseTelegramGroupIds('"-100 1", -1002;\n-1002')).toEqual(['-1001', '-1002']);
    expect(parseTelegramGroupIds(undefined)).toEqual([]);
  });

  it('the online/offline group readers use the same rule (they split on commas only before)', () => {
    process.env.ONLINE_GROUP_ID = '-1001; -1002\n-1003';
    process.env.OFLINE_GROUP_ID = '-2001;-2002';
    process.env.OFFLINE_GROUP_IDS = '-2002, -2003';

    expect(getOnlineTelegramGroupIds()).toEqual(['-1001', '-1002', '-1003']);
    expect(getOfflineTelegramGroupIds()).toEqual(['-2001', '-2002', '-2003']);

    delete process.env.ONLINE_GROUP_ID;
    delete process.env.OFLINE_GROUP_ID;
    delete process.env.OFFLINE_GROUP_IDS;
  });

  it('reads several env keys', () => {
    process.env.TEST_GROUP_A = '-1, -2';
    process.env.TEST_GROUP_B = '-2;-3';
    expect(parseTelegramGroupIdsFromEnvKeys(['TEST_GROUP_A', 'TEST_GROUP_B', 'TEST_GROUP_MISSING'])).toEqual(['-1', '-2', '-3']);
    delete process.env.TEST_GROUP_A;
    delete process.env.TEST_GROUP_B;
  });
});
