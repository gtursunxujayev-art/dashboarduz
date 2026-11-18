import { TelegramService } from '../telegram';

jest.mock('../../../lib/async', () => ({ sleep: () => Promise.resolve() }));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('TelegramService', () => {
  const service = new TelegramService();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reads the bot identity from getMe', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({
      ok: true,
      result: { id: 77, username: 'dashboard_bot', first_name: 'Dashboard' },
    }));

    await expect(service.verifyBotToken('123:abc')).resolves.toEqual({
      isValid: true,
      bot: { id: 77, username: 'dashboard_bot', first_name: 'Dashboard' },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.telegram.org/bot123:abc/getMe');
  });

  it('rejects tokens Telegram refuses or answers without a bot', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ ok: false, description: 'Unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, description: 'Unauthorized' }, 401));

    await expect(service.getBotInfo('bad')).rejects.toThrow('Invalid Telegram bot token');
    await expect(service.getBotInfo('bad')).rejects.toThrow('Failed to fetch Telegram bot info');
    await expect(service.verifyBotToken('bad')).resolves.toEqual({ isValid: false });
  });

  it('sends a message with the extra options and returns the API answer', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ ok: true, result: { message_id: 5 } }));

    await expect(service.sendMessage('t', '-100', 'Salom', { disable_web_page_preview: true }))
      .resolves.toEqual({ ok: true, result: { message_id: 5 } });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      chat_id: '-100',
      text: 'Salom',
      disable_web_page_preview: true,
    });
  });

  it('reports the Telegram description of a failed send', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ ok: false, description: 'Bad Request: chat not found' }, 400))
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 403));

    await expect(service.sendMessage('t', '1', 'x')).rejects.toThrow('Telegram API error: Bad Request: chat not found');
    await expect(service.sendMessage('t', '1', 'x')).rejects.toThrow('Telegram API error: Unknown error');
  });

  it('retries 429 and 5xx answers, then returns the last one', async () => {
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 429))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { message_id: 9 } }));

    await expect(service.sendMessage('t', '1', 'x')).resolves.toEqual({ ok: true, result: { message_id: 9 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after three network failures and names the cause', async () => {
    const networkError = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNRESET', syscall: 'read', hostname: 'api.telegram.org', message: 'read ECONNRESET' },
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(networkError);

    await expect(service.sendMessage('t', '1', 'x')).rejects.toThrow(
      'Telegram network error after 3 attempts: read ECONNRESET (ECONNRESET read api.telegram.org)',
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reads webhook info and refuses an answer without a result', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { url: 'https://api.example.com/webhooks/telegram', pending_update_count: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ ok: false, description: 'Not Found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));

    await expect(service.getWebhookInfo('t')).resolves.toEqual({ url: 'https://api.example.com/webhooks/telegram', pending_update_count: 0 });
    await expect(service.getWebhookInfo('t')).rejects.toThrow('Telegram API error: Not Found');
    await expect(service.getWebhookInfo('t')).rejects.toThrow('Telegram API error: HTTP 200');
  });

  it('uploads a PDF document with its caption', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({ ok: true, result: { message_id: 3 } }));

    await expect(service.sendDocument('t', '42', Buffer.from('%PDF-1.4'), 'report.pdf', 'Kunlik hisobot'))
      .resolves.toEqual({ ok: true, result: { message_id: 3 } });
    const form = fetchMock.mock.calls[0]?.[1]?.body;

    expect(form).toBeInstanceOf(FormData);
    if (form instanceof FormData) {
      expect(form.get('chat_id')).toBe('42');
      expect(form.get('caption')).toBe('Kunlik hisobot');
      const document = form.get('document');

      expect(document).toBeInstanceOf(Blob);
      if (document instanceof Blob) expect(document.type).toBe('application/pdf');
    }
  });

  it('reports a failed upload with the description, else the HTTP status', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ ok: false, description: 'Request Entity Too Large' }, 413))
      .mockResolvedValueOnce(new Response('gateway down', { status: 502 }));

    await expect(service.sendDocument('t', '42', Buffer.from('x'), 'r.pdf')).rejects.toThrow('Telegram API error: Request Entity Too Large');
    await expect(service.sendDocument('t', '42', Buffer.from('x'), 'r.pdf')).rejects.toThrow('Telegram API error: HTTP 502');
  });
});
