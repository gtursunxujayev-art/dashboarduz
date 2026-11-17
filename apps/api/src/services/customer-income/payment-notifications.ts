import type { DbClient } from '@dashboarduz/db';
import { formatSomAmount, TASHKENT_OFFSET_MS } from '@dashboarduz/shared';

import { logger } from '../../lib/logger';
import { resolveTelegramBotTokenForTenant, toHashtag } from '../../lib/telegram';
import { telegramService } from '../integrations/telegram';
import { parseTelegramGroupIdsFromEnvKeys } from '../integrations/telegram-groups';

import { OFFLINE_PAYMENT_GROUP_ENV_KEYS, ONLINE_PAYMENT_GROUP_ENV_KEYS, REFUND_PAYMENT_GROUP_ENV_KEYS, TELEGRAM_BOT_TOKEN_OPTIONS } from './constants';

export function resolveRefundGroupIds(): string[] {
  const preferred = parseTelegramGroupIdsFromEnvKeys(['REFUND_GROUP_ID', 'REFUND_GROUP_IDS']);

  if (preferred.length > 0) {
    return preferred;
  }

  return parseTelegramGroupIdsFromEnvKeys(REFUND_PAYMENT_GROUP_ENV_KEYS);
}

export function formatDateGmt5(dateValue: Date): string {
  const local = new Date(dateValue.getTime() + TASHKENT_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');

  return `${day}.${month}.${year}`;
}

function isOfflineOrIntensive(category: string | null | undefined): boolean {
  const normalized = String(category || '').trim().toLowerCase();

  return normalized === 'offline' || normalized === 'intensive' || normalized === 'additional_service';
}

function isOnlineCategory(category: string | null | undefined): boolean {
  return String(category || '').trim().toLowerCase() === 'online';
}

function resolvePaymentGroupEnvKeysByCategory(category: string | null | undefined): readonly string[] | null {
  if (isOfflineOrIntensive(category)) {
    return OFFLINE_PAYMENT_GROUP_ENV_KEYS;
  }
  if (isOnlineCategory(category)) {
    return ONLINE_PAYMENT_GROUP_ENV_KEYS;
  }

  return null;
}

export async function sendOfflineOrIntensivePaymentTelegram(params: {
  tenantId: string;
  incomeId: string;
  preferredSubTariffId?: string;
  db: DbClient;
}) {
  const { db } = params;

  type TelegramPaymentDispatchResult = {
    attempted: boolean;
    delivered: boolean;
    sentCount: number;
    failedCount: number;
    reason?: 'groups_missing' | 'bot_token_missing' | 'income_not_found' | 'course_not_eligible' | 'send_failed';
    errors?: string[];
  };

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId, db, TELEGRAM_BOT_TOKEN_OPTIONS);

  if (!botToken) {
    logger.warn('[Income][Telegram] Bot token is missing. Connect Telegram integration or set TELEGRAM_BOT_TOKEN.');

    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'bot_token_missing',
    } satisfies TelegramPaymentDispatchResult;
  }

  const createdIncome = await db.income.findFirst({
    where: {
      id: params.incomeId,
      tenantId: params.tenantId,
    },
    select: {
      id: true,
      type: true,
      relatedDebtIncomeId: true,
      manager: {
        select: {
          name: true,
          username: true,
        },
      },
    },
  });

  if (!createdIncome) {
    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'income_not_found',
    } satisfies TelegramPaymentDispatchResult;
  }

  const saleIncomeId = createdIncome.type === 'new_sale' ? createdIncome.id : createdIncome.relatedDebtIncomeId;

  if (!saleIncomeId) {
    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'income_not_found',
    } satisfies TelegramPaymentDispatchResult;
  }

  type SaleIncomePayload = {
    id: string;
    entryDate: Date;
    deadline: Date | null;
    coursePriceAmount: number | null;
    debtAmount: number | null;
    remainingDebtAmount: number;
    tariffId: string | null;
    customer: {
      name: string;
      customerNumber: string;
      telegramUsername: string | null;
    } | null;
    course: {
      id: string;
      name: string;
      category: string | null;
    } | null;
    tariff: {
      name: string;
    } | null;
  };

  let saleIncome: SaleIncomePayload | null = null;

  const withCategory = await db.income.findFirst({
    where: {
      id: saleIncomeId,
      tenantId: params.tenantId,
    },
    select: {
      id: true,
      entryDate: true,
      deadline: true,
      coursePriceAmount: true,
      debtAmount: true,
      remainingDebtAmount: true,
      tariffId: true,
      customer: {
        select: {
          name: true,
          customerNumber: true,
          telegramUsername: true,
        },
      },
      course: {
        select: {
          id: true,
          name: true,
          category: true,
        },
      },
      tariff: {
        select: {
          name: true,
        },
      },
    },
  });

  saleIncome = withCategory
    ? {
        ...withCategory,
        course: withCategory.course
          ? {
              ...withCategory.course,
              category: withCategory.course.category ?? null,
            }
          : null,
      }
    : null;

  if (!saleIncome?.course || !saleIncome.customer) {
    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'course_not_eligible',
    } satisfies TelegramPaymentDispatchResult;
  }

  const categoryGroupKeys = resolvePaymentGroupEnvKeysByCategory(saleIncome.course.category);

  if (!categoryGroupKeys) {
    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'course_not_eligible',
    } satisfies TelegramPaymentDispatchResult;
  }

  const groupIds = parseTelegramGroupIdsFromEnvKeys(categoryGroupKeys);

  if (!groupIds.length) {
    const normalizedCategory = String(saleIncome.course.category || '').trim().toLowerCase() || 'unknown';

    logger.warn({
      tenantId: params.tenantId,
      category: normalizedCategory,
      expectedEnv: categoryGroupKeys,
    }, '[Income][Telegram] Group ID is missing for payment category');

    return {
      attempted: false,
      delivered: false,
      sentCount: 0,
      failedCount: 0,
      reason: 'groups_missing',
    } satisfies TelegramPaymentDispatchResult;
  }

  const payments = await db.income.findMany({
    where: {
      tenantId: params.tenantId,
      OR: [
        { id: saleIncomeId },
        { relatedDebtIncomeId: saleIncomeId },
      ],
    },
    orderBy: [
      { entryDate: 'asc' },
      { createdAt: 'asc' },
    ],
    select: {
      paymentAmount: true,
      entryDate: true,
    },
  });

  let subTariffHashtag: string | null = null;

  if (saleIncome.tariffId) {
    if (params.preferredSubTariffId) {
      const selectedSubTariff = await db.subTariff.findFirst({
        where: {
          id: params.preferredSubTariffId,
          tenantId: params.tenantId,
          tariffId: saleIncome.tariffId,
          isActive: true,
        },
        select: { name: true },
      });

      if (selectedSubTariff?.name) {
        subTariffHashtag = toHashtag(selectedSubTariff.name);
      }
    }

    if (!subTariffHashtag) {
      const firstActiveSubTariff = await db.subTariff.findFirst({
        where: {
          tenantId: params.tenantId,
          tariffId: saleIncome.tariffId,
          isActive: true,
        },
        orderBy: { name: 'asc' },
        select: { name: true },
      });

      if (firstActiveSubTariff?.name) {
        subTariffHashtag = toHashtag(firstActiveSubTariff.name);
      }
    }
  }

  const courseHashtag = toHashtag(saleIncome.course.name);
  const tariffHashtag = toHashtag(saleIncome.tariff?.name);
  const managerName = createdIncome.manager?.name || createdIncome.manager?.username || null;
  const managerHashtag = toHashtag(managerName);
  const telegramUsername = saleIncome.customer.telegramUsername
    ? (saleIncome.customer.telegramUsername.startsWith('@')
      ? saleIncome.customer.telegramUsername
      : `@${saleIncome.customer.telegramUsername}`)
    : '-';
  const agreementAmount = saleIncome.coursePriceAmount ?? saleIncome.debtAmount ?? 0;
  const salesTeamMention = isOnlineCategory(saleIncome.course.category)
    ? '@najotnur_online'
    : '@najotnur_oflayn';

  const paymentLines = payments.length
    ? payments.map((payment, index) => `${index + 1}) ${formatSomAmount(payment.paymentAmount)} - ${formatDateGmt5(payment.entryDate)}`)
    : ['1) -'];

  const messageLines = [
    ...(courseHashtag ? [courseHashtag] : []),
    ...(tariffHashtag ? [tariffHashtag] : []),
    ...(subTariffHashtag ? [subTariffHashtag] : []),
    ...(managerHashtag ? [managerHashtag] : []),
    '',
    `1.Mijoz: ${saleIncome.customer.name}`,
    `2.Tel: ${saleIncome.customer.customerNumber}`,
    `3.Tg: ${telegramUsername}`,
    '',
    `Narxi - ${formatSomAmount(agreementAmount)}`,
    '',
    "To'lov:",
    '',
    ...paymentLines,
    '',
    `Qarz: ${formatSomAmount(saleIncome.remainingDebtAmount)}`,
    `Deadline: ${saleIncome.deadline ? formatDateGmt5(saleIncome.deadline) : '-'}`,
    '',
    '@Moliya_b0limi',
    salesTeamMention,
  ];

  const message = messageLines.join('\n');
  const splitMessage = (text: string): string[] => {
    const maxLength = 3500;

    if (text.length <= maxLength) {
      return [text];
    }
    const lines = text.split('\n');
    const chunks: string[] = [];
    let current = '';

    for (const line of lines) {
      const next = current ? `${current}\n${line}` : line;

      if (next.length > maxLength) {
        if (current) {
          chunks.push(current);
        }
        if (line.length > maxLength) {
          chunks.push(line.slice(0, maxLength));
          current = line.slice(maxLength);
        } else {
          current = line;
        }
      } else {
        current = next;
      }
    }
    if (current) {
      chunks.push(current);
    }

    return chunks.length ? chunks : [text];
  };
  const messageChunks = splitMessage(message);

  let sentCount = 0;
  const sendErrors: string[] = [];

  for (const groupId of groupIds) {
    try {
      for (const chunk of messageChunks) {
        await telegramService.sendMessage(botToken, groupId, chunk, {
          disable_web_page_preview: true,
        });
      }
      sentCount += 1;
    } catch (error) {
      const errorMessage = String((error as any)?.message || error);

      sendErrors.push(`${groupId}: ${errorMessage}`);
      logger.error({
        tenantId: params.tenantId,
        groupId,
        incomeId: params.incomeId,
        error: errorMessage,
      }, '[Income][Telegram] Failed to send offline/intensive payment message');
    }
  }

  const dispatchResult = {
    attempted: true,
    delivered: sentCount > 0,
    sentCount,
    failedCount: Math.max(groupIds.length - sentCount, 0),
    reason: sentCount > 0 ? undefined : 'send_failed',
    errors: sendErrors.slice(0, 3),
  } satisfies TelegramPaymentDispatchResult;

  if (!dispatchResult.delivered) {
    logger.warn({
      tenantId: params.tenantId,
      incomeId: params.incomeId,
      groupIds,
      errors: dispatchResult.errors,
    }, '[Income][Telegram] Payment message was not delivered to any target group.');
  }

  return dispatchResult;
}
