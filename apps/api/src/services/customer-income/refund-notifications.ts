import type { DbClient } from '@dashboarduz/db';
import { formatSomAmount } from '@dashboarduz/shared';

import { thrownText } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { resolveTenantNotificationBotToken, sendMessageToTelegramChat } from '../../lib/telegram';

import { ADJUSTMENT_STATUS_APPROVED, ADJUSTMENT_STATUS_PENDING, ADJUSTMENT_TYPE_REFUND } from './constants';
import {
  ADJUSTMENT_INCOME_SELECT,
  customerLines,
  formatCourseTariff,
  hashtagLines,
  sendToTelegramGroups,
  userLabel,
} from './notification-parts';
import { formatDateGmt5, resolveRefundGroupIds } from './payment-notifications';

const USER_LABEL_SELECT = { select: { id: true, name: true, username: true } } as const;

/** Refund group ids and bot token, or `null` (logged) when either is missing. */
async function resolveRefundGroupDelivery(params: { tenantId: string; db: DbClient; kind: 'refund' | 'refund request' }) {
  const groupIds = resolveRefundGroupIds();

  if (!groupIds.length) {
    logger.warn(params.kind === 'refund'
      ? '[Income][Telegram] Refund group is missing. Set PAYMENT_RETURN_GROUP_ID (or REFUND_GROUP_ID).'
      : '[Income][Telegram] Refund request group is missing. Set PAYMENT_RETURN_GROUP_ID (or REFUND_GROUP_ID).');

    return null;
  }

  const botToken = await resolveTenantNotificationBotToken(params.tenantId, params.db);

  if (!botToken) {
    logger.info({ tenantId: params.tenantId }, `[Income][Telegram] No active Telegram integration; ${params.kind} message not sent.`);

    return null;
  }

  return { groupIds, botToken };
}

/** A refund request with its sale, requester and reviewer, or `null` when it has no customer. */
async function findRefundRequest(db: DbClient, params: { tenantId: string; requestId: string; status: string }) {
  const request = await db.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_REFUND,
      status: params.status,
    },
    select: {
      id: true,
      reason: true,
      reviewNote: true,
      requestedAmount: true,
      refundCardNumber: true,
      createdAt: true,
      reviewedAt: true,
      income: { select: ADJUSTMENT_INCOME_SELECT },
      requestedBy: { select: { id: true, name: true, username: true, telegramId: true } },
      reviewedBy: USER_LABEL_SELECT,
    },
  });

  if (!request?.income?.customer) {
    return null;
  }

  return { ...request, income: request.income, customer: request.income.customer };
}

function refundAmount(request: { requestedAmount: number | null; income: { paymentAmount: number | null } }): number {
  return request.requestedAmount ?? request.income.paymentAmount ?? 0;
}

export async function sendRefundApprovedTelegram(params: {
  tenantId: string;
  requestId: string;
  reviewedByUserId: string;
  db: DbClient;
}) {
  const delivery = await resolveRefundGroupDelivery({ tenantId: params.tenantId, db: params.db, kind: 'refund' });

  if (!delivery) {
    return;
  }

  const request = await findRefundRequest(params.db, { ...params, status: ADJUSTMENT_STATUS_APPROVED });

  if (!request) {
    return;
  }

  const message = [
    ...hashtagLines(userLabel(request.income.manager, null)),
    `${request.customer.name}`,
    `${request.customer.customerNumber}`,
    `Summa - ${formatSomAmount(refundAmount(request))}`,
    `Karta - ${request.refundCardNumber || '-'}`,
    '✅ Qaytarildi',
  ].join('\n');

  await sendToTelegramGroups({
    ...delivery,
    message,
    logContext: { tenantId: params.tenantId, requestId: params.requestId },
    failureLogMessage: '[Income][Telegram] Failed to send refund message',
  });
}

export async function sendRefundRequestedTelegram(params: {
  tenantId: string;
  requestId: string;
  requestedByUserId: string;
  db: DbClient;
}) {
  const delivery = await resolveRefundGroupDelivery({ tenantId: params.tenantId, db: params.db, kind: 'refund request' });

  if (!delivery) {
    return;
  }

  const request = await findRefundRequest(params.db, { ...params, status: ADJUSTMENT_STATUS_PENDING });

  if (!request) {
    return;
  }

  const message = [
    '#Pul_qaytarish_so\'rovi',
    ...hashtagLines(request.income.course?.name, request.income.tariff?.name, userLabel(request.income.manager, null)),
    '',
    ...customerLines(request.customer),
    '',
    `So'ralgan summa: ${formatSomAmount(refundAmount(request))}`,
    `Karta raqami: ${request.refundCardNumber || '-'}`,
    `Asl to'lov sanasi: ${formatDateGmt5(request.income.entryDate)}`,
    `So'rov yuborgan: ${userLabel(request.requestedBy, params.requestedByUserId)}`,
    `So'rov vaqti: ${formatDateGmt5(request.createdAt)}`,
    'Holat: Kutilmoqda',
    ...(request.reason ? [`Izoh: ${request.reason}`] : []),
    '',
    '@Moliya_b0limi',
    '@najotnur_oflayn',
  ].join('\n');

  await sendToTelegramGroups({
    ...delivery,
    message,
    logContext: { tenantId: params.tenantId, requestId: params.requestId },
    failureLogMessage: '[Income][Telegram] Failed to send refund request message',
  });
}

type RefundRequestRow = NonNullable<Awaited<ReturnType<typeof findRefundRequest>>>;

function buildRefundDetailsBlock(request: RefundRequestRow, extra: {
  requesterLabel: string;
  reviewerLabel?: string | null;
  showReview?: boolean;
}): string {
  const details = [
    ...customerLines(request.customer),
    '',
    `Summa: ${formatSomAmount(refundAmount(request))}`,
    `Karta raqami: ${request.refundCardNumber || '-'}`,
    `Kurs/Tarif: ${formatCourseTariff(request.income.course?.name, request.income.tariff?.name)}`,
    ...(extra.requesterLabel ? [`So'rov yuborgan: ${extra.requesterLabel}`] : []),
    ...(extra.reviewerLabel ? [`Ko'rib chiqqan: ${extra.reviewerLabel}`] : []),
    `So'rov vaqti: ${formatDateGmt5(request.createdAt)}`,
    ...(extra.showReview && request.reviewedAt ? [`Ko'rib chiqilgan vaqt: ${formatDateGmt5(request.reviewedAt)}`] : []),
    ...(request.reason ? [`Izoh: ${request.reason}`] : []),
    ...(extra.showReview && request.reviewNote ? [`Javob izohi: ${request.reviewNote}`] : []),
  ];

  return details.join('\n');
}

export async function notifyFinanceUsersRefundRequested(params: {
  tenantId: string;
  requestId: string;
  requestedByUserId: string;
  db: DbClient;
}) {
  const { db } = params;

  const botToken = await resolveTenantNotificationBotToken(params.tenantId, db);

  if (!botToken) {
    return;
  }

  const [request, financeUsers] = await Promise.all([
    findRefundRequest(db, { ...params, status: ADJUSTMENT_STATUS_PENDING }),
    db.user.findMany({
      where: {
        tenantId: params.tenantId,
        isActive: true,
        roles: {
          has: 'Finance',
        },
        telegramId: {
          not: null,
        },
      },
      select: {
        id: true,
        telegramId: true,
      },
    }),
  ]);

  if (!request || financeUsers.length === 0) {
    return;
  }

  const details = buildRefundDetailsBlock(request, {
    requesterLabel: userLabel(request.requestedBy, params.requestedByUserId),
  });
  const message = `Pul qaytarish uchun yangi so'rov\n\n${details}`;

  for (const financeUser of financeUsers) {
    const chatId = String(financeUser.telegramId || '').trim();

    if (!chatId) {
      continue;
    }
    try {
      await sendMessageToTelegramChat(botToken, chatId, message);
    } catch (error) {
      logger.error({
        tenantId: params.tenantId,
        requestId: params.requestId,
        financeUserId: financeUser.id,
        chatId,
        error: thrownText(error),
      }, '[Income][Telegram] Failed to notify finance user about refund request');
    }
  }
}

export async function notifyRefundRequesterReviewResult(params: {
  tenantId: string;
  requestId: string;
  status: 'approved' | 'rejected';
  db: DbClient;
}) {
  const { db } = params;

  const botToken = await resolveTenantNotificationBotToken(params.tenantId, db);

  if (!botToken) {
    return;
  }

  const request = await findRefundRequest(db, params);
  const requesterChatId = String(request?.requestedBy?.telegramId || '').trim();

  if (!request || !requesterChatId) {
    return;
  }

  const details = buildRefundDetailsBlock(request, {
    requesterLabel: userLabel(request.requestedBy, request.requestedBy?.id || '-'),
    reviewerLabel: userLabel(request.reviewedBy, null),
    showReview: true,
  });

  const header = params.status === 'approved'
    ? '✅ Pul qaytarildi'
    : '❌ Qaytarish rad etildi';
  const message = `${header}\n\n${details}`;

  try {
    await sendMessageToTelegramChat(botToken, requesterChatId, message);
  } catch (error) {
    logger.error({
      tenantId: params.tenantId,
      requestId: params.requestId,
      requesterUserId: request.requestedBy?.id || null,
      chatId: requesterChatId,
      status: params.status,
      error: thrownText(error),
    }, '[Income][Telegram] Failed to notify requester about refund review result');
  }
}
