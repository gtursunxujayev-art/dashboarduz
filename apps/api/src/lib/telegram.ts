/**
 * Telegram helpers shared by routers, schedulers and webhooks: bot-token lookup,
 * chat-id candidates, hashtags and config parsing.
 */
import type { DbClient } from '@dashboarduz/db';

import { telegramService } from '../services/integrations/telegram';
import { decryptIntegrationTokens } from '../services/security/encryption';

import { logger } from './logger';
import { asObject } from './object';

export type NormalizeTelegramSecretOptions = {
  /** Strip quotes/backticks wrapping the value (as pasted into env files) before trimming. */
  stripWrappingQuotes?: boolean;
  /** Remove line breaks inside the trimmed value. */
  removeNewlines?: boolean;
};

/**
 * A bot token or similar secret, trimmed, or `null` when blank. The options reproduce the
 * three behaviours the former copies had; see `__tests__/telegram.test.ts`.
 */
export function normalizeTelegramSecret(
  value: string | null | undefined,
  options: NormalizeTelegramSecretOptions = {},
): string | null {
  const raw = String(value || '');
  const normalized = options.stripWrappingQuotes ? raw.replace(/^['"`]+|['"`]+$/g, '').trim() : raw.trim();

  if (!normalized) {
    return null;
  }

  return options.removeNewlines ? normalized.replace(/\r?\n/g, '').trim() : normalized;
}

export type ResolveTelegramBotTokenOptions = {
  /** Only use the tenant's integration token when the integration status is `active`. */
  requireActiveIntegration: boolean;
  /** How the env and integration tokens are normalised. */
  secret: NormalizeTelegramSecretOptions;
  /** Logged (with `tenantId` and `error`) when the stored integration token cannot be decrypted. */
  decryptFailureMessage: string;
};

/** The tenant's Telegram integration bot token, falling back to `TELEGRAM_BOT_TOKEN`. */
export async function resolveTelegramBotTokenForTenant(
  tenantId: string,
  db: DbClient,
  options: ResolveTelegramBotTokenOptions,
): Promise<string | null> {
  const integration = await db.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'telegram',
      },
    },
    select: {
      status: true,
      tokensEncrypted: true,
    },
  });

  let botToken = normalizeTelegramSecret(process.env.TELEGRAM_BOT_TOKEN, options.secret);
  const usable = options.requireActiveIntegration ? integration?.status === 'active' : true;

  if (usable && integration?.tokensEncrypted) {
    try {
      const tokens = decryptIntegrationTokens<{ botToken?: string; token?: string }>(integration.tokensEncrypted);
      const integrationBotToken = normalizeTelegramSecret(tokens.botToken || tokens.token, options.secret);

      botToken = integrationBotToken || botToken;
    } catch (error) {
      logger.warn({ tenantId, error: String((error as Error)?.message || error) }, options.decryptFailureMessage);
    }
  }

  return botToken;
}

/**
 * Chat ids to try for a group: the id itself plus its other supergroup form
 * (`-100123` also tries `-123`; `-123` also tries `-100123`).
 */
export function buildTelegramChatIdCandidates(groupId: string): string[] {
  const normalized = String(groupId || '').trim();

  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>([normalized]);

  if (/^-100\d+$/.test(normalized)) {
    candidates.add(`-${normalized.slice(4)}`);
  } else if (/^-\d+$/.test(normalized) && !normalized.startsWith('-100')) {
    candidates.add(`-100${normalized.slice(1)}`);
  }

  return Array.from(candidates);
}

/**
 * A looser candidate list (used for direct chats with agents): the id, its digits (with `-`),
 * `-100<digits>` unless it already starts with `-100`, and the bare digits unless it starts with `-` or `@`.
 * Unlike {@link buildTelegramChatIdCandidates} it never tries `-123` for `-100123`.
 */
export function buildLooseTelegramChatIdCandidates(chatId: string): string[] {
  const normalized = String(chatId || '').trim();

  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>();

  candidates.add(normalized);

  const digitsOnly = normalized.replace(/[^\d-]/g, '');

  if (digitsOnly && digitsOnly !== normalized) {
    candidates.add(digitsOnly);
  }

  const unsignedDigits = digitsOnly.replace(/-/g, '');

  if (unsignedDigits) {
    if (!normalized.startsWith('-100')) {
      candidates.add(`-100${unsignedDigits}`);
    }
    if (!normalized.startsWith('-') && !normalized.startsWith('@')) {
      candidates.add(unsignedDigits);
    }
  }

  return Array.from(candidates);
}

export type SendMessageToTelegramChatOptions = {
  buildCandidates?: (chatId: string) => string[];
  /** Error message when the chat id is blank. */
  emptyChatIdMessage?: string;
};

/** Sends `text` to the first chat-id candidate Telegram accepts; throws the last error when none does. */
export async function sendMessageToTelegramChat(
  botToken: string,
  chatId: string,
  text: string,
  options: SendMessageToTelegramChatOptions = {},
): Promise<void> {
  const buildCandidates = options.buildCandidates ?? buildTelegramChatIdCandidates;
  const candidates = buildCandidates(chatId);

  if (candidates.length === 0) {
    throw new Error(options.emptyChatIdMessage ?? 'Empty Telegram chat id');
  }

  let lastError = '';

  for (const candidate of candidates) {
    try {
      await telegramService.sendMessage(botToken, candidate, text, {
        disable_web_page_preview: true,
      });

      return;
    } catch (error) {
      lastError = String((error as Error)?.message || error);
    }
  }

  throw new Error(lastError || 'Failed to send Telegram message');
}

/** `'Foundation English'` -> `'#Foundation_English'`; `null` when nothing usable is left. */
export function toHashtag(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .normalize('NFKD')
    .replace(/['`]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');

  return normalized ? `#${normalized}` : null;
}

/** Up to three unique course ids from `config.telegramDailyReportCourseIds`. */
export function parseTelegramDailyReportCourseIds(config: unknown): string[] {
  const raw = asObject(config)?.telegramDailyReportCourseIds;

  if (!Array.isArray(raw)) {
    return [];
  }

  return Array.from(new Set(
    raw
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )).slice(0, 3);
}
