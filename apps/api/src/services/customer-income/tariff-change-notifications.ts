import type { DbClient } from '@dashboarduz/db';

import { logger } from '../../lib/logger';
import { resolveTelegramBotTokenForTenant, toHashtag } from '../../lib/telegram';
import { telegramService } from '../integrations/telegram';
import { parseTelegramGroupIdsFromEnvKeys } from '../integrations/telegram-groups';

import { ADJUSTMENT_STATUS_APPROVED, ADJUSTMENT_STATUS_PENDING, ADJUSTMENT_TYPE_TARIFF_CHANGE, TARIFF_CHANGE_GROUP_ENV_KEYS, TELEGRAM_BOT_TOKEN_OPTIONS } from './constants';
import { formatAmountUz, formatDateGmt5 } from './payment-notifications';

export async function sendTariffChangeRequestedTelegram(params: {
  tenantId: string;
  requestId: string;
  requestedByUserId: string;
  db: DbClient;
}) {
  const { db } = params;

  const request = await db.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_TARIFF_CHANGE,
      status: ADJUSTMENT_STATUS_PENDING,
    },
    select: {
      id: true,
      reason: true,
      newAgreementAmount: true,
      createdAt: true,
      requestedBy: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
      income: {
        select: {
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
            },
          },
          tariff: {
            select: {
              name: true,
            },
          },
        },
      },
      newCourse: {
        select: {
          name: true,
          category: true,
        },
      },
      newTariff: {
        select: {
          name: true,
        },
      },
    },
  });

  if (!request?.income?.customer || !request.newCourse) {
    return;
  }

  const groupIds = parseTelegramGroupIdsFromEnvKeys(TARIFF_CHANGE_GROUP_ENV_KEYS);

  if (!groupIds.length) {
    logger.warn('[Income][Telegram] Tariff change group is missing. Set TARIFF_CHANGE_GROUP_ID (or CHANGE_GROUP_ID).');

    return;
  }

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId, db, TELEGRAM_BOT_TOKEN_OPTIONS);

  if (!botToken) {
    return;
  }

  const customer = request.income.customer;
  const requesterLabel = request.requestedBy?.name || request.requestedBy?.username || params.requestedByUserId;
  const managerLabel = request.income.manager?.name || request.income.manager?.username || null;
  const telegramUsername = customer.telegramUsername
    ? (customer.telegramUsername.startsWith('@') ? customer.telegramUsername : `@${customer.telegramUsername}`)
    : '-';

  const hashtags = [
    "#Tarif_o'zgarishi_so'rovi",
    ...(toHashtag(request.newCourse.name) ? [toHashtag(request.newCourse.name)] : []),
    ...(toHashtag(request.newTariff?.name) ? [toHashtag(request.newTariff?.name)] : []),
    ...(toHashtag(managerLabel) ? [toHashtag(managerLabel)] : []),
  ].join('\n');

  const customerBlock = [
    `1.Mijoz: ${customer.name}`,
    `2.Tel: ${customer.customerNumber}`,
    `3.Tg: ${telegramUsername}`,
  ].join('\n');

  const courseChangeBlock = [
    `Eski kurs/tarif: ${[request.income.course?.name, request.income.tariff?.name].filter(Boolean).join(' / ') || '-'}`,
    `Yangi kurs/tarif: ${[request.newCourse?.name, request.newTariff?.name].filter(Boolean).join(' / ') || '-'}`,
  ].join('\n');

  const agreementBlock = `Yangi kelishuv: ${formatAmountUz(request.newAgreementAmount ?? 0)}`;

  const metaBlock = [
    `So'rov yuborgan: ${requesterLabel}`,
    `So'rov vaqti: ${formatDateGmt5(request.createdAt)}`,
    ...(request.reason ? [`Izoh: ${request.reason}`] : []),
  ].join('\n');

  const message = [
    hashtags,
    customerBlock,
    courseChangeBlock,
    agreementBlock,
    metaBlock,
  ].filter(Boolean).join('\n\n');

  for (const groupId of groupIds) {
    try {
      await telegramService.sendMessage(botToken, groupId, message, {
        disable_web_page_preview: true,
      });
    } catch (error) {
      logger.error({
        tenantId: params.tenantId,
        requestId: params.requestId,
        groupId,
        error: String((error as any)?.message || error),
      }, '[Income][Telegram] Failed to send tariff-change requested message');
    }
  }
}

async function sendTariffChangeApprovedTelegram(params: {
  tenantId: string;
  requestId: string;
  reviewedByUserId: string;
  db: DbClient;
}) {
  const { db } = params;

  const request = await db.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_TARIFF_CHANGE,
      status: ADJUSTMENT_STATUS_APPROVED,
    },
    select: {
      id: true,
      reason: true,
      newAgreementAmount: true,
      reviewedAt: true,
      reviewedBy: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
      income: {
        select: {
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
        },
      },
    },
  });

  if (!request?.income?.customer || !request.income.course) {
    return;
  }

  const groupIds = parseTelegramGroupIdsFromEnvKeys(TARIFF_CHANGE_GROUP_ENV_KEYS);

  if (!groupIds.length) {
    logger.warn('[Income][Telegram] Tariff change group is missing. Set TARIFF_CHANGE_GROUP_ID (or CHANGE_GROUP_ID).');

    return;
  }

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId, db, TELEGRAM_BOT_TOKEN_OPTIONS);

  if (!botToken) {
    return;
  }

  const customer = request.income.customer;
  const reviewerLabel = request.reviewedBy?.name || request.reviewedBy?.username || params.reviewedByUserId;
  const managerLabel = request.income.manager?.name || request.income.manager?.username || null;
  const telegramUsername = customer.telegramUsername
    ? (customer.telegramUsername.startsWith('@') ? customer.telegramUsername : `@${customer.telegramUsername}`)
    : '-';

  const messageLines = [
    "#Tarif_o'zgarishi_tasdiqlandi",
    ...(toHashtag(request.income.course?.name) ? [toHashtag(request.income.course?.name)] : []),
    ...(toHashtag(request.income.tariff?.name) ? [toHashtag(request.income.tariff?.name)] : []),
    ...(toHashtag(managerLabel) ? [toHashtag(managerLabel)] : []),
    '',
    `1.Mijoz: ${customer.name}`,
    `2.Tel: ${customer.customerNumber}`,
    `3.Tg: ${telegramUsername}`,
    '',
    `Yangi kurs/tarif: ${[request.income.course?.name, request.income.tariff?.name].filter(Boolean).join(' / ') || '-'}`,
    `Yangi kelishuv: ${formatAmountUz(request.newAgreementAmount ?? 0)}`,
    `Tasdiqlagan: ${reviewerLabel}`,
    `Tasdiqlangan vaqt: ${request.reviewedAt ? formatDateGmt5(request.reviewedAt) : '-'}`,
    ...(request.reason ? [`Izoh: ${request.reason}`] : []),
  ];

  const message = messageLines.join('\n');

  for (const groupId of groupIds) {
    try {
      await telegramService.sendMessage(botToken, groupId, message, {
        disable_web_page_preview: true,
      });
    } catch (error) {
      logger.error({
        tenantId: params.tenantId,
        requestId: params.requestId,
        groupId,
        error: String((error as any)?.message || error),
      }, '[Income][Telegram] Failed to send tariff-change approved message');
    }
  }
}
