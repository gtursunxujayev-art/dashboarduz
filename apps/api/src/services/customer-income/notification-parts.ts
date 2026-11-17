/**
 * Pieces shared by the refund, tariff-change and payment Telegram messages.
 */
import { logger } from '../../lib/logger';
import { buildTelegramChatIdCandidates, sendMessageToTelegramChat, toHashtag } from '../../lib/telegram';

/** The income fields an adjustment (refund / tariff change) message shows. */
export const ADJUSTMENT_INCOME_SELECT = {
  id: true,
  entryDate: true,
  paymentAmount: true,
  customer: {
    select: {
      name: true,
      customerNumber: true,
      telegramUsername: true,
    },
  },
  manager: {
    select: {
      name: true,
      username: true,
    },
  },
  course: {
    select: {
      name: true,
      category: true,
    },
  },
  tariff: {
    select: {
      name: true,
    },
  },
} as const;

/** `name`, else `username`, else `fallback`. */
export function userLabel<F>(user: { name?: string | null; username?: string | null } | null | undefined, fallback: F): string | F {
  return user?.name || user?.username || fallback;
}

/** `@handle` (adding the `@` when missing), or `-` when there is none. */
export function formatTelegramHandle(username: string | null | undefined): string {
  if (!username) {
    return '-';
  }

  return username.startsWith('@') ? username : `@${username}`;
}

/** Hashtags of the given values, skipping those that produce none. */
export function hashtagLines(...values: Array<string | null | undefined>): string[] {
  return values.map((value) => toHashtag(value)).filter((tag): tag is string => Boolean(tag));
}

/** `Course / Tariff`, or `-` when both are missing. */
export function formatCourseTariff(courseName: string | null | undefined, tariffName: string | null | undefined): string {
  return [courseName, tariffName].filter(Boolean).join(' / ') || '-';
}

/** The three customer lines every adjustment message starts with. */
export function customerLines(customer: { name: string; customerNumber: string; telegramUsername?: string | null }): string[] {
  return [
    `1.Mijoz: ${customer.name}`,
    `2.Tel: ${customer.customerNumber}`,
    `3.Tg: ${formatTelegramHandle(customer.telegramUsername)}`,
  ];
}

/**
 * Sends `message` to every group; a group that fails is logged with `logContext` and skipped.
 * By default each group id is also tried in its other supergroup form.
 */
export async function sendToTelegramGroups(params: {
  botToken: string;
  groupIds: string[];
  message: string;
  logContext: Record<string, unknown>;
  failureLogMessage: string;
  buildCandidates?: (groupId: string) => string[];
}): Promise<{ sentCount: number; errors: string[] }> {
  const buildCandidates = params.buildCandidates ?? buildTelegramChatIdCandidates;
  const errors: string[] = [];
  let sentCount = 0;

  for (const groupId of params.groupIds) {
    try {
      await sendMessageToTelegramChat(params.botToken, groupId, params.message, { buildCandidates });
      sentCount += 1;
    } catch (error) {
      const message = String((error as Error)?.message || error);

      errors.push(`${groupId}: ${message || 'Unknown error'}`);
      logger.error({
        ...params.logContext,
        groupId,
        chatIdCandidates: buildCandidates(groupId),
        error: message,
      }, params.failureLogMessage);
    }
  }

  return { sentCount, errors };
}
