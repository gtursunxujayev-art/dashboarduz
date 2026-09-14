import { prisma } from '@dashboarduz/db';
import { TelegramService } from '../telegram';
import { upsertTelegramRecipientRecord } from '../telegram-recipient-store';
import { extractTelegramRecipientFromPayload } from '../telegram-update';

describe('Telegram recipient discovery', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts start, ordinary private messages, and private callback queries', () => {
    expect(extractTelegramRecipientFromPayload({
      update_id: 1,
      message: {
        text: '/start',
        chat: { id: 101, type: 'private' },
        from: { id: 101, username: 'agent_one', first_name: 'Agent', last_name: 'One' },
      },
    })).toEqual({
      chatId: '101', username: 'agent_one', firstName: 'Agent', lastName: 'One', started: true,
    });
    expect(extractTelegramRecipientFromPayload({
      message: { text: 'hello', chat: { id: 102, type: 'private' }, from: { id: 102, first_name: 'Two' } },
    })?.started).toBe(true);
    expect(extractTelegramRecipientFromPayload({
      callback_query: {
        data: 'confirm',
        from: { id: 103, first_name: 'Three' },
        message: { chat: { id: 103, type: 'private' } },
      },
    })?.chatId).toBe('103');
  });

  it('ignores group and channel updates', () => {
    expect(extractTelegramRecipientFromPayload({
      message: { text: '/start', chat: { id: -1001, type: 'group' }, from: { id: 1 } },
    })).toBeNull();
    expect(extractTelegramRecipientFromPayload({
      channel_post: { text: '/start', chat: { id: -1002, type: 'channel' } },
    })).toBeNull();
  });

  it('upserts concurrent users independently without replacing a shared JSON list', async () => {
    const upsert = jest.spyOn(prisma.telegramRecipient, 'upsert').mockResolvedValue({} as never);

    await Promise.all([
      upsertTelegramRecipientRecord({
        tenantId: 'tenant-1', integrationId: 'integration-1', chatId: '201', firstName: 'First', started: true,
      }),
      upsertTelegramRecipientRecord({
        tenantId: 'tenant-1', integrationId: 'integration-1', chatId: '202', firstName: 'Second', started: true,
      }),
    ]);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls.map(([args]: any[]) => args.where.integrationId_chatId.chatId).sort()).toEqual(['201', '202']);
    for (const [args] of upsert.mock.calls as any[]) {
      expect(args.create.tenantId).toBe('tenant-1');
      expect(args.create.integrationId).toBe('integration-1');
    }
  });

  it('does not discard pending updates when registering the webhook', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      json: async () => ({ ok: true, result: true }),
    } as Response);
    const service = new TelegramService();

    await service.setWebhook('token', 'https://api.example.com/webhooks/telegram', 'secret');

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toEqual({
      url: 'https://api.example.com/webhooks/telegram',
      secret_token: 'secret',
    });
    expect(body).not.toHaveProperty('drop_pending_updates');
  });

  it('reads safe Telegram webhook diagnostic fields', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          url: 'https://api.example.com/webhooks/telegram',
          pending_update_count: 2,
          last_error_message: 'temporary error',
        },
      }),
    } as Response);

    const info = await new TelegramService().getWebhookInfo('token');
    expect(info.url).toBe('https://api.example.com/webhooks/telegram');
    expect(info.pending_update_count).toBe(2);
    expect(info.last_error_message).toBe('temporary error');
  });
});
