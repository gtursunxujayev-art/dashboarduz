import { trimmedString } from '../../lib/object';
export type TelegramRecipientFromUpdate = {
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  started: boolean;
};

export function extractTelegramRecipientFromPayload(payload: any): TelegramRecipientFromUpdate | null {
  const message = payload?.message
    || payload?.edited_message
    || payload?.channel_post
    || payload?.edited_channel_post
    || payload?.callback_query?.message
    || null;
  const chat = message?.chat || null;

  if (!chat || chat.id === null || chat.id === undefined) return null;

  const chatType = trimmedString(chat.type || 'private').toLowerCase();

  if (chatType && chatType !== 'private') return null;

  const from = payload?.message?.from
    || payload?.edited_message?.from
    || payload?.callback_query?.from
    || payload?.channel_post?.from
    || payload?.edited_channel_post?.from
    || null;
  const messageText = trimmedString(
    message?.text || message?.caption || payload?.callback_query?.data || '',
  );

  return {
    chatId: String(chat.id),
    username: trimmedString(from?.username || chat.username || '') || null,
    firstName: trimmedString(from?.first_name || chat.first_name || '') || null,
    lastName: trimmedString(from?.last_name || chat.last_name || '') || null,
    started: /^\/start\b/i.test(messageText) || Boolean(from || message),
  };
}
