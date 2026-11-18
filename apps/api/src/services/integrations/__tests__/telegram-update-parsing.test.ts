import { extractTelegramRecipientFromPayload } from '../telegram-update';

describe('extractTelegramRecipientFromPayload', () => {
  it('reads an edited private message and falls back to chat names when there is no sender', () => {
    expect(extractTelegramRecipientFromPayload({
      edited_message: {
        text: 'salom',
        chat: { id: 555, type: 'private', username: ' chat_user ', first_name: 'Chat', last_name: 'Name' },
      },
    })).toEqual({
      chatId: '555',
      username: 'chat_user',
      firstName: 'Chat',
      lastName: 'Name',
      started: true,
    });
  });

  it('prefers sender names over chat names and blanks empty names to null', () => {
    expect(extractTelegramRecipientFromPayload({
      message: {
        chat: { id: '777', type: 'private', username: 'from_chat', first_name: 'Chat' },
        from: { username: 'from_sender', first_name: '  ', last_name: '' },
        caption: '/start ref',
      },
    })).toEqual({
      chatId: '777',
      username: 'from_sender',
      firstName: null,
      lastName: null,
      started: true,
    });
  });

  it('treats a chat without a type as private', () => {
    expect(extractTelegramRecipientFromPayload({ message: { chat: { id: 9 } } })?.chatId).toBe('9');
  });

  it('keeps chat id 0 but drops updates without a chat id', () => {
    expect(extractTelegramRecipientFromPayload({ message: { chat: { id: 0, type: 'private' } } })?.chatId).toBe('0');
    expect(extractTelegramRecipientFromPayload({ message: { chat: { id: null, type: 'private' } } })).toBeNull();
    expect(extractTelegramRecipientFromPayload({ message: { chat: { type: 'private' } } })).toBeNull();
  });

  it('uses the first update key that holds a message', () => {
    expect(extractTelegramRecipientFromPayload({
      message: { chat: { id: 1, type: 'private' } },
      edited_message: { chat: { id: 2, type: 'private' } },
    })?.chatId).toBe('1');
  });

  it('returns null for payloads that are not Telegram updates', () => {
    expect(extractTelegramRecipientFromPayload(null)).toBeNull();
    expect(extractTelegramRecipientFromPayload('update')).toBeNull();
    expect(extractTelegramRecipientFromPayload({ update_id: 1 })).toBeNull();
    expect(extractTelegramRecipientFromPayload({ message: 'not an object' })).toBeNull();
    expect(extractTelegramRecipientFromPayload({ my_chat_member: { chat: { id: 1, type: 'private' } } })).toBeNull();
  });

  it('rejects supergroups even when the type has odd casing', () => {
    expect(extractTelegramRecipientFromPayload({ message: { chat: { id: -100, type: ' SuperGroup ' } } })).toBeNull();
  });
});
