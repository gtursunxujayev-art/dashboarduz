/**
 * The Telegram Bot API response shapes this app reads (https://core.telegram.org/bots/api).
 * Every method answers with the same envelope; `result` depends on the method.
 */

export type TelegramApiEnvelope<TResult = unknown> = {
  ok?: boolean;
  result?: TResult;
  description?: string;
  error_code?: number;
};

/** `getMe`. */
export type TelegramBotIdentity = {
  id: number;
  username?: string;
  first_name?: string;
};

/** `getWebhookInfo`. */
export type TelegramWebhookInfo = {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  ip_address?: string;
};

/**
 * Extra `sendMessage` parameters, spread into the request body (for example `disable_web_page_preview`,
 * `parse_mode`, `reply_markup`).
 */
export type TelegramSendMessageOptions = Readonly<Record<string, unknown>>;
