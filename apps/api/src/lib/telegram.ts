/**
 * Telegram helpers shared by routers, schedulers and webhooks: bot-token lookup,
 * chat-id candidates, hashtags and config parsing.
 */
import type { DbClient } from '@dashboarduz/db';

import { telegramService } from '../services/integrations/telegram';
import { decryptIntegrationTokens } from '../services/security/encryption';

import { logger } from './logger';
import { asObject } from './object';

/**
 * A bot token as pasted into an env file or the integration form: wrapping quotes/backticks removed,
 * trimmed, inner line breaks removed; `null` when nothing is left.
 */
export function normalizeTelegramBotToken(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().replace(/^['"`]+|['"`]+$/g, '').trim().replace(/\r?\n/g, '').trim();

  return normalized || null;
}

export type TelegramIntegrationTokenSource = {
  tenantId?: string;
  status: string | null;
  tokensEncrypted: string | null;
} | null | undefined;

/**
 * The one bot-token rule for every router, scheduler and worker: a tenant's own token is used only while its
 * Telegram integration is `active` (and the token decrypts to something); otherwise `TELEGRAM_BOT_TOKEN`.
 * `null` when neither is set.
 */
export function resolveTelegramBotToken(integration: TelegramIntegrationTokenSource): string | null {
  const envToken = normalizeTelegramBotToken(process.env.TELEGRAM_BOT_TOKEN);

  if (integration?.status !== 'active' || !integration.tokensEncrypted) {
    return envToken;
  }

  try {
    const tokens = decryptIntegrationTokens<{ botToken?: string; token?: string }>(integration.tokensEncrypted);

    return normalizeTelegramBotToken(tokens.botToken || tokens.token) || envToken;
  } catch (error) {
    logger.warn(
      { tenantId: integration.tenantId, error: String((error as Error)?.message || error) },
      '[Telegram] Integration bot token could not be decrypted; using TELEGRAM_BOT_TOKEN',
    );

    return envToken;
  }
}

/** {@link resolveTelegramBotToken} for a tenant, looking up its Telegram integration. */
export async function resolveTelegramBotTokenForTenant(tenantId: string, db: DbClient): Promise<string | null> {
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

  return resolveTelegramBotToken(integration ? { tenantId, ...integration } : null);
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
