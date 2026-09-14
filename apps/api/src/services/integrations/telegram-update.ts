export type TelegramRecipientFromUpdate = {
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  started: boolean;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function extractTelegramRecipientFromPayload(payload: any): TelegramRecipientFromUpdate | null {
  const message = payload?.message
    || payload?.edited_message
    || payload?.channel_post
    || payload?.edited_channel_post
    || payload?.callback_query?.message
    || null;
  const chat = message?.chat || null;
  if (!chat || chat.id === null || chat.id === undefined) return null;

  const chatType = normalizeText(chat.type || 'private').toLowerCase();
  if (chatType && chatType !== 'private') return null;

  const from = payload?.message?.from
    || payload?.edited_message?.from
    || payload?.callback_query?.from
    || payload?.channel_post?.from
    || payload?.edited_channel_post?.from
    || null;
  const messageText = normalizeText(
    message?.text || message?.caption || payload?.callback_query?.data || '',
  );

  return {
    chatId: String(chat.id),
    username: normalizeText(from?.username || chat.username || '') || null,
    firstName: normalizeText(from?.first_name || chat.first_name || '') || null,
    lastName: normalizeText(from?.last_name || chat.last_name || '') || null,
    started: /^\/start\b/i.test(messageText) || Boolean(from || message),
  };
}
