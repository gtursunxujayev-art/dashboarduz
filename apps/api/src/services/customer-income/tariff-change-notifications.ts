import type { DbClient } from '@dashboarduz/db';

import { logger } from '../../lib/logger';
import { resolveTelegramBotTokenForTenant } from '../../lib/telegram';
import { parseTelegramGroupIdsFromEnvKeys } from '../integrations/telegram-groups';

import { ADJUSTMENT_STATUS_PENDING, ADJUSTMENT_TYPE_TARIFF_CHANGE, TARIFF_CHANGE_GROUP_ENV_KEYS, TELEGRAM_BOT_TOKEN_OPTIONS } from './constants';
import {
  ADJUSTMENT_INCOME_SELECT,
  customerLines,
  formatCourseTariff,
  hashtagLines,
  sendToTelegramGroups,
  userLabel,
} from './notification-parts';
import { formatAmountUz, formatDateGmt5 } from './payment-notifications';

/** A tariff-change request with its sale, people and new course, or `null` when it has no customer. */
async function findTariffChangeRequest(db: DbClient, params: { tenantId: string; requestId: string; status: string }) {
  const request = await db.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_TARIFF_CHANGE,
      status: params.status,
    },
    select: {
      id: true,
      reason: true,
      newAgreementAmount: true,
      createdAt: true,
      requestedBy: { select: { id: true, name: true, username: true } },
      income: { select: ADJUSTMENT_INCOME_SELECT },
      newCourse: { select: { name: true, category: true } },
      newTariff: { select: { name: true } },
    },
  });

  if (!request?.income?.customer) {
    return null;
  }

  return { ...request, income: request.income, customer: request.income.customer };
}

/** Tariff-change group ids and bot token, or `null` (logged when the group is missing). */
async function resolveTariffChangeDelivery(tenantId: string, db: DbClient) {
  const groupIds = parseTelegramGroupIdsFromEnvKeys(TARIFF_CHANGE_GROUP_ENV_KEYS);

  if (!groupIds.length) {
    logger.warn('[Income][Telegram] Tariff change group is missing. Set TARIFF_CHANGE_GROUP_ID (or CHANGE_GROUP_ID).');

    return null;
  }

  const botToken = await resolveTelegramBotTokenForTenant(tenantId, db, TELEGRAM_BOT_TOKEN_OPTIONS);

  return botToken ? { groupIds, botToken } : null;
}

/** Tariff-change messages go to each group id exactly as configured. */
const exactGroupId = (groupId: string) => [groupId];

export async function sendTariffChangeRequestedTelegram(params: {
  tenantId: string;
  requestId: string;
  requestedByUserId: string;
  db: DbClient;
}) {
  const request = await findTariffChangeRequest(params.db, { ...params, status: ADJUSTMENT_STATUS_PENDING });

  if (!request?.newCourse) {
    return;
  }

  const delivery = await resolveTariffChangeDelivery(params.tenantId, params.db);

  if (!delivery) {
    return;
  }

  const hashtags = [
    "#Tarif_o'zgarishi_so'rovi",
    ...hashtagLines(request.newCourse.name, request.newTariff?.name, userLabel(request.income.manager, null)),
  ].join('\n');

  const courseChangeBlock = [
    `Eski kurs/tarif: ${formatCourseTariff(request.income.course?.name, request.income.tariff?.name)}`,
    `Yangi kurs/tarif: ${formatCourseTariff(request.newCourse.name, request.newTariff?.name)}`,
  ].join('\n');

  const agreementBlock = `Yangi kelishuv: ${formatAmountUz(request.newAgreementAmount ?? 0)}`;

  const metaBlock = [
    `So'rov yuborgan: ${userLabel(request.requestedBy, params.requestedByUserId)}`,
    `So'rov vaqti: ${formatDateGmt5(request.createdAt)}`,
    ...(request.reason ? [`Izoh: ${request.reason}`] : []),
  ].join('\n');

  const message = [
    hashtags,
    customerLines(request.customer).join('\n'),
    courseChangeBlock,
    agreementBlock,
    metaBlock,
  ].filter(Boolean).join('\n\n');

  await sendToTelegramGroups({
    ...delivery,
    message,
    buildCandidates: exactGroupId,
    logContext: { tenantId: params.tenantId, requestId: params.requestId },
    failureLogMessage: '[Income][Telegram] Failed to send tariff-change requested message',
  });
}
