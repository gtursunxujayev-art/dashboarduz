import { trimmedString } from '../../lib/object';
import { valueAtPath } from '../../lib/unknown-path';

export type TelegramRecipientFromUpdate = {
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  started: boolean;
};

/** The update keys that carry a message, in the order the recipient is looked for. */
const MESSAGE_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ['message'],
  ['edited_message'],
  ['channel_post'],
  ['edited_channel_post'],
  ['callback_query', 'message'],
];

/** The update keys that carry the sender, in the order the sender is looked for. */
const SENDER_PATHS: ReadonlyArray<ReadonlyArray<string>> = [
  ['message', 'from'],
  ['edited_message', 'from'],
  ['callback_query', 'from'],
  ['channel_post', 'from'],
  ['edited_channel_post', 'from'],
];

/** The first truthy value at one of `paths` in a Telegram update, else `null`. */
function firstTruthyAtPaths(payload: unknown, paths: ReadonlyArray<ReadonlyArray<string>>): unknown {
  for (const path of paths) {
    const value = valueAtPath(payload, ...path);

    if (value) return value;
  }

  return null;
}

/**
 * The private-chat recipient of a Telegram Bot API update (`message`, `edited_message`, `channel_post`,
 * `edited_channel_post` or `callback_query`), or `null` for group chats and updates without a chat.
 */
export function extractTelegramRecipientFromPayload(payload: unknown): TelegramRecipientFromUpdate | null {
  const message = firstTruthyAtPaths(payload, MESSAGE_PATHS);
  const chat = valueAtPath(message, 'chat') || null;
  const chatId = valueAtPath(chat, 'id');

  if (!chat || chatId === null || chatId === undefined) return null;

  const chatType = trimmedString(valueAtPath(chat, 'type') || 'private').toLowerCase();

  if (chatType && chatType !== 'private') return null;

  const from = firstTruthyAtPaths(payload, SENDER_PATHS);
  const messageText = trimmedString(
    valueAtPath(message, 'text') || valueAtPath(message, 'caption') || valueAtPath(payload, 'callback_query', 'data') || '',
  );
  const nameField = (key: string): string | null => (
    trimmedString(valueAtPath(from, key) || valueAtPath(chat, key) || '') || null
  );

  return {
    chatId: String(chatId),
    username: nameField('username'),
    firstName: nameField('first_name'),
    lastName: nameField('last_name'),
    started: /^\/start\b/i.test(messageText) || Boolean(from || message),
  };
}
