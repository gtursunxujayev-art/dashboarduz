import { TelegramService } from '../telegram';
import { applyTelegramRecipientsToConfig, parseTelegramRecipients } from '../telegram-recipients';

// The Telegram Bot API client (retries on 429/5xx and network errors, error messages) with a mocked fetch,
// and the legacy recipients list stored in the integration config.
jest.mock('../../../lib/async', () => ({
  ...jest.requireActual('../../../lib/async'),
  sleep: () => Promise.resolve(),
}));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

let fetchSpy: jest.SpyInstance;

beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch');
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe('TelegramService', () => {
  const service = new TelegramService();

  it('sends a message with the options merged into the body', async () => {
    fetchSpy.mockResolvedValue(json(200, { ok: true, result: { message_id: 7 } }));

    expect(await service.sendMessage('TOKEN', '42', 'Salom', { parse_mode: 'HTML' })).toEqual({ ok: true, result: { message_id: 7 } });
    const [url, init] = fetchSpy.mock.calls[0];

    expect(url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    expect(JSON.parse(init.body)).toEqual({ chat_id: '42', text: 'Salom', parse_mode: 'HTML' });
  });

  it('retries 429 and 5xx answers, then returns the last answer', async () => {
    fetchSpy
      .mockResolvedValueOnce(json(429, { ok: false }))
      .mockResolvedValueOnce(json(502, { ok: false }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    expect(await service.sendMessage('T', '1', 'x')).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    fetchSpy.mockReset();
    fetchSpy.mockImplementation(() => Promise.resolve(json(503, { description: 'Service Unavailable' })));
    await expect(service.sendMessage('T', '1', 'x')).rejects.toThrow('Telegram API error: Service Unavailable');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('does not retry a client error and reports its description', async () => {
    fetchSpy.mockResolvedValue(json(400, { ok: false, description: 'Bad Request: chat not found' }));

    await expect(service.sendMessage('T', '1', 'x')).rejects.toThrow('Telegram API error: Bad Request: chat not found');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockResolvedValue(json(403, {}));
    await expect(service.sendMessage('T', '1', 'x')).rejects.toThrow('Telegram API error: Unknown error');
  });

  it('gives up after three network errors with the cause details', async () => {
    const networkError = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname: 'api.telegram.org', message: 'getaddrinfo ENOTFOUND' },
    });

    fetchSpy.mockRejectedValue(networkError);

    await expect(service.sendMessage('T', '1', 'x'))
      .rejects.toThrow('Telegram network error after 3 attempts: getaddrinfo ENOTFOUND (ENOTFOUND getaddrinfo api.telegram.org)');
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    fetchSpy.mockReset();
    fetchSpy.mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValueOnce(json(200, { ok: true }));
    expect(await service.sendMessage('T', '1', 'x')).toEqual({ ok: true });
  });

  it('reads bot info and verifies tokens', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, { ok: true, result: { id: 1, username: 'dash_bot' } }));
    expect(await service.verifyBotToken('GOOD')).toEqual({ isValid: true, bot: { id: 1, username: 'dash_bot' } });

    fetchSpy.mockResolvedValueOnce(json(401, { ok: false }));
    expect(await service.verifyBotToken('BAD')).toEqual({ isValid: false });

    fetchSpy.mockResolvedValueOnce(json(200, { ok: false }));
    await expect(service.getBotInfo('ODD')).rejects.toThrow('Failed to fetch Telegram bot info');
  });

  it('reads webhook info and sets the webhook with a secret', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, { ok: true, result: { url: 'https://api/webhooks/telegram', pending_update_count: 0 } }));
    expect(await service.getWebhookInfo('T')).toEqual({ url: 'https://api/webhooks/telegram', pending_update_count: 0 });

    fetchSpy.mockResolvedValueOnce(json(401, { ok: false, description: 'Unauthorized' }));
    await expect(service.getWebhookInfo('T')).rejects.toThrow('Telegram API error: Unauthorized');

    fetchSpy.mockResolvedValueOnce(json(404, { ok: false }));
    await expect(service.getWebhookInfo('T')).rejects.toThrow('Telegram API error: HTTP 404');

    fetchSpy.mockResolvedValueOnce(json(200, { ok: true, result: true }));
    expect(await service.setWebhook('T', 'https://api/webhooks/telegram', 's3cret')).toEqual({ ok: true, result: true });
    expect(JSON.parse(fetchSpy.mock.calls[3][1].body)).toEqual({ url: 'https://api/webhooks/telegram', secret_token: 's3cret' });

    fetchSpy.mockResolvedValueOnce(json(200, { ok: true }));
    await service.setWebhook('T', 'https://x');
    expect(JSON.parse(fetchSpy.mock.calls[4][1].body)).toEqual({ url: 'https://x' });
  });

  it('uploads a PDF document as multipart form data', async () => {
    fetchSpy.mockResolvedValueOnce(json(200, { ok: true, result: { document: {} } }));

    expect(await service.sendDocument('T', '42', Buffer.from('%PDF'), 'report.pdf', 'Hisobot')).toEqual({ ok: true, result: { document: {} } });
    const body: FormData = fetchSpy.mock.calls[0][1].body;

    expect(body.get('chat_id')).toBe('42');
    expect(body.get('caption')).toBe('Hisobot');
    const document = body.get('document');

    expect(document).toBeInstanceOf(Blob);
    expect(document instanceof File ? document.name : null).toBe('report.pdf');

    fetchSpy.mockResolvedValueOnce(json(400, { description: 'file is too big' }));
    await expect(service.sendDocument('T', '42', Buffer.from('x'), 'r.pdf')).rejects.toThrow('Telegram API error: file is too big');

    fetchSpy.mockResolvedValueOnce(new Response('<html>', { status: 502 }));
    await expect(service.sendDocument('T', '42', Buffer.from('x'), 'r.pdf')).rejects.toThrow('Telegram API error: HTTP 502');
  });
});

describe('Telegram recipients in the integration config', () => {
  it('parses, de-duplicates by chat id and sorts by display name', () => {
    const recipients = parseTelegramRecipients({
      telegramReportRecipients: [
        { chatId: ' 2 ', username: 'zed', started: 'no', selectedForReports: 'yes' },
        { chatId: '1', firstName: 'Ali', lastName: 'Valiyev', started: 1, selectedForReports: 0, startedAt: '2026-11-01' },
        { chatId: '3', displayName: 'Bekzod', started: 'maybe' },
        { chatId: '3', displayName: 'Bekzod (new)' },
        { chatId: '' },
        'not an object',
      ],
    });

    expect(recipients).toEqual([
      { chatId: '2', username: 'zed', firstName: null, lastName: null, displayName: '@zed', started: false, selectedForReports: true, startedAt: null, lastSeenAt: null },
      {
        chatId: '1', username: null, firstName: 'Ali', lastName: 'Valiyev', displayName: 'Ali Valiyev', started: true,
        selectedForReports: false, startedAt: '2026-11-01', lastSeenAt: null,
      },
      { chatId: '3', username: null, firstName: null, lastName: null, displayName: 'Bekzod (new)', started: true, selectedForReports: false, startedAt: null, lastSeenAt: null },
    ]);
    expect(parseTelegramRecipients(null)).toEqual([]);
  });

  it('writes recipients back with the started-and-selected chat ids', () => {
    const config = applyTelegramRecipientsToConfig({ keep: true }, [
      { chatId: '1', username: null, firstName: 'Ali', lastName: null, displayName: 'Ali', started: true, selectedForReports: true, startedAt: null, lastSeenAt: null },
      { chatId: '2', username: 'b', firstName: null, lastName: null, displayName: '@b', started: false, selectedForReports: true, startedAt: null, lastSeenAt: null },
    ]);

    expect(config.keep).toBe(true);
    expect(config.reportRecipientChatIds).toEqual(['1']);
    expect(config.telegramReportRecipients).toHaveLength(2);
    expect(applyTelegramRecipientsToConfig('bad', [])).toEqual({ telegramReportRecipients: [], reportRecipientChatIds: [] });
  });
});
