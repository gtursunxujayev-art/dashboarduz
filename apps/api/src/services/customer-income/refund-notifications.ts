import type { DbClient } from '@dashboarduz/db';

import { logger } from '../../lib/logger';
import { buildTelegramChatIdCandidates, resolveTelegramBotTokenForTenant, sendMessageToTelegramChat, toHashtag } from '../../lib/telegram';
import { telegramService } from '../integrations/telegram';

import { ADJUSTMENT_STATUS_APPROVED, ADJUSTMENT_STATUS_PENDING, ADJUSTMENT_TYPE_REFUND, TELEGRAM_BOT_TOKEN_OPTIONS } from './constants';
import { formatAmountUz, formatDateGmt5, resolveRefundGroupIds } from './payment-notifications';

export async function sendRefundApprovedTelegram(params: {
  tenantId: string;
  requestId: string;
  reviewedByUserId: string;
  db: DbClient;
}) {
  const { db } = params;

  const groupIds = resolveRefundGroupIds();

  if (!groupIds.length) {
    logger.warn('[Income][Telegram] Refund group is missing. Set PAYMENT_RETURN_GROUP_ID (or REFUND_GROUP_ID).');

    return;
  }

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId, db, TELEGRAM_BOT_TOKEN_OPTIONS);

  if (!botToken) {
    logger.warn('[Income][Telegram] Bot token is missing for refund message.');

    return;
  }

  const request = await db.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_REFUND,
      status: ADJUSTMENT_STATUS_APPROVED,
    },
    select: {
      id: true,
      reason: true,
      requestedAmount: true,
      refundCardNumber: true,
      income: {
        select: {
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
            },
          },
          tariff: {
            select: {
              name: true,
            },
          },
        },
      },
      reviewedBy: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
      reviewedAt: true,
    },
  });

  if (!request?.income?.customer) {
    return;
  }

  const customer = request.income.customer;
  const managerLabel = request.income.manager?.name || request.income.manager?.username || null;

  const messageLines = [
    ...(toHashtag(managerLabel) ? [toHashtag(managerLabel)] : []),
    `${customer.name}`,
    `${customer.customerNumber}`,
    `Summa - ${formatAmountUz(request.requestedAmount ?? request.income.paymentAmount ?? 0)}`,
    `Karta - ${request.refundCardNumber || '-'}`,
    '✅ Qaytarildi',
  ];

  const message = messageLines.join('\n');

  for (const groupId of groupIds) {
    const chatIdCandidates = buildTelegramChatIdCandidates(groupId);
    let delivered = false;
    let lastError = '';

    for (const candidate of chatIdCandidates) {
      try {
        await telegramService.sendMessage(botToken, candidate, message, {
          disable_web_page_preview: true,
        });
        delivered = true;
        break;
      } catch (error) {
        lastError = String((error as any)?.message || error);
      }
    }

    if (!delivered) {
      logger.error({
        tenantId: params.tenantId,
        requestId: params.requestId,
        groupId,
        chatIdCandidates,
        error: lastError,
      }, '[Income][Telegram] Failed to send refund message');
    }
  }
}

export async function sendRefundRequestedTelegram(params: {
  tenantId: string;
  requestId: string;
  requestedByUserId: string;
  db: DbClient;
}) {
  const { db } = params;

  const groupIds = resolveRefundGroupIds();

  if (!groupIds.length) {
    logger.warn('[Income][Telegram] Refund request group is missing. Set PAYMENT_RETURN_GROUP_ID (or REFUND_GROUP_ID).');

    return;
  }

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId, db, TELEGRAM_BOT_TOKEN_OPTIONS);

  if (!botToken) {
    logger.warn('[Income][Telegram] Bot token is missing for refund request message.');

    return;
  }

  const request = await db.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_REFUND,
      status: ADJUSTMENT_STATUS_PENDING,
    },
    select: {
      id: true,
      reason: true,
      requestedAmount: true,
      refundCardNumber: true,
      createdAt: true,
      income: {
        select: {
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
            },
          },
          tariff: {
            select: {
              name: true,
            },
          },
        },
      },
      requestedBy: {
        select: {
          id: true,
          name: true,
          username: true,
        },
      },
    },
  });

  if (!request?.income?.customer) {
    return;
  }

  const customer = request.income.customer;
  const managerLabel = request.income.manager?.name || request.income.manager?.username || null;
  const requesterLabel = request.requestedBy?.name || request.requestedBy?.username || params.requestedByUserId;
  const telegramUsername = customer.telegramUsername
    ? (customer.telegramUsername.startsWith('@') ? customer.telegramUsername : `@${customer.telegramUsername}`)
    : '-';

  const messageLines = [
    '#Pul_qaytarish_so\'rovi',
    ...(toHashtag(request.income.course?.name) ? [toHashtag(request.income.course?.name)] : []),
    ...(toHashtag(request.income.tariff?.name) ? [toHashtag(request.income.tariff?.name)] : []),
    ...(toHashtag(managerLabel) ? [toHashtag(managerLabel)] : []),
    '',
    `1.Mijoz: ${customer.name}`,
    `2.Tel: ${customer.customerNumber}`,
    `3.Tg: ${telegramUsername}`,
    '',
    `So'ralgan summa: ${formatAmountUz(request.requestedAmount ?? request.income.paymentAmount ?? 0)}`,
    `Karta raqami: ${request.refundCardNumber || '-'}`,
    `Asl to'lov sanasi: ${formatDateGmt5(request.income.entryDate)}`,
    `So'rov yuborgan: ${requesterLabel}`,
    `So'rov vaqti: ${formatDateGmt5(request.createdAt)}`,
    'Holat: Kutilmoqda',
    ...(request.reason ? [`Izoh: ${request.reason}`] : []),
    '',
    '@Moliya_b0limi',
    '@najotnur_oflayn',
  ];

  const message = messageLines.join('\n');

  for (const groupId of groupIds) {
    const chatIdCandidates = buildTelegramChatIdCandidates(groupId);
    let delivered = false;
    let lastError = '';

    for (const candidate of chatIdCandidates) {
      try {
        await telegramService.sendMessage(botToken, candidate, message, {
          disable_web_page_preview: true,
        });
        delivered = true;
        break;
      } catch (error) {
        lastError = String((error as any)?.message || error);
      }
    }

    if (!delivered) {
      logger.error({
        tenantId: params.tenantId,
        requestId: params.requestId,
        groupId,
        chatIdCandidates,
        error: lastError,
      }, '[Income][Telegram] Failed to send refund request message');
    }
  }
}

function buildRefundDetailsBlock(params: {
  customerName: string;
  customerNumber: string;
  telegramUsername?: string | null;
  amount: number;
  courseName?: string | null;
  tariffName?: string | null;
  requesterLabel?: string | null;
  reviewerLabel?: string | null;
  createdAt?: Date | null;
  reviewedAt?: Date | null;
  reason?: string | null;
  reviewNote?: string | null;
  refundCardNumber?: string | null;
}): string {
  const tg = params.telegramUsername
    ? (params.telegramUsername.startsWith('@') ? params.telegramUsername : `@${params.telegramUsername}`)
    : '-';
  const details = [
    `1.Mijoz: ${params.customerName}`,
    `2.Tel: ${params.customerNumber}`,
    `3.Tg: ${tg}`,
    '',
    `Summa: ${formatAmountUz(params.amount)}`,
    `Karta raqami: ${params.refundCardNumber || '-'}`,
    `Kurs/Tarif: ${[params.courseName, params.tariffName].filter(Boolean).join(' / ') || '-'}`,
    ...(params.requesterLabel ? [`So'rov yuborgan: ${params.requesterLabel}`] : []),
    ...(params.reviewerLabel ? [`Ko'rib chiqqan: ${params.reviewerLabel}`] : []),
    ...(params.createdAt ? [`So'rov vaqti: ${formatDateGmt5(params.createdAt)}`] : []),
    ...(params.reviewedAt ? [`Ko'rib chiqilgan vaqt: ${formatDateGmt5(params.reviewedAt)}`] : []),
    ...(params.reason ? [`Izoh: ${params.reason}`] : []),
    ...(params.reviewNote ? [`Javob izohi: ${params.reviewNote}`] : []),
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

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId, db, TELEGRAM_BOT_TOKEN_OPTIONS);

  if (!botToken) {
    return;
  }

  const [request, financeUsers] = await Promise.all([
    db.incomeAdjustmentRequest.findFirst({
      where: {
        id: params.requestId,
        tenantId: params.tenantId,
        type: ADJUSTMENT_TYPE_REFUND,
        status: ADJUSTMENT_STATUS_PENDING,
      },
      select: {
        requestedAmount: true,
        refundCardNumber: true,
        reason: true,
        createdAt: true,
        requestedBy: {
          select: {
            name: true,
            username: true,
          },
        },
        income: {
          select: {
            paymentAmount: true,
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
            customer: {
              select: {
                name: true,
                customerNumber: true,
                telegramUsername: true,
              },
            },
          },
        },
      },
    }),
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

  if (!request?.income?.customer || financeUsers.length === 0) {
    return;
  }

  const requesterLabel = request.requestedBy?.name || request.requestedBy?.username || params.requestedByUserId;
  const details = buildRefundDetailsBlock({
    customerName: request.income.customer.name,
    customerNumber: request.income.customer.customerNumber,
    telegramUsername: request.income.customer.telegramUsername || null,
    amount: request.requestedAmount ?? request.income.paymentAmount ?? 0,
    refundCardNumber: request.refundCardNumber || null,
    courseName: request.income.course?.name || null,
    tariffName: request.income.tariff?.name || null,
    requesterLabel,
    createdAt: request.createdAt,
    reason: request.reason || null,
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
        error: String((error as any)?.message || error),
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

  const botToken = await resolveTelegramBotTokenForTenant(params.tenantId, db, TELEGRAM_BOT_TOKEN_OPTIONS);

  if (!botToken) {
    return;
  }

  const request = await db.incomeAdjustmentRequest.findFirst({
    where: {
      id: params.requestId,
      tenantId: params.tenantId,
      type: ADJUSTMENT_TYPE_REFUND,
      status: params.status,
    },
    select: {
      requestedAmount: true,
      refundCardNumber: true,
      reason: true,
      reviewNote: true,
      createdAt: true,
      reviewedAt: true,
      requestedBy: {
        select: {
          id: true,
          name: true,
          username: true,
          telegramId: true,
        },
      },
      reviewedBy: {
        select: {
          name: true,
          username: true,
        },
      },
      income: {
        select: {
          paymentAmount: true,
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
          customer: {
            select: {
              name: true,
              customerNumber: true,
              telegramUsername: true,
            },
          },
        },
      },
    },
  });

  const requesterChatId = String(request?.requestedBy?.telegramId || '').trim();

  if (!request?.income?.customer || !requesterChatId) {
    return;
  }

  const reviewerLabel = request.reviewedBy?.name || request.reviewedBy?.username || null;
  const requesterLabel = request.requestedBy?.name || request.requestedBy?.username || request.requestedBy?.id || '-';
  const details = buildRefundDetailsBlock({
    customerName: request.income.customer.name,
    customerNumber: request.income.customer.customerNumber,
    telegramUsername: request.income.customer.telegramUsername || null,
    amount: request.requestedAmount ?? request.income.paymentAmount ?? 0,
    refundCardNumber: request.refundCardNumber || null,
    courseName: request.income.course?.name || null,
    tariffName: request.income.tariff?.name || null,
    requesterLabel,
    reviewerLabel,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
    reason: request.reason || null,
    reviewNote: request.reviewNote || null,
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
      error: String((error as any)?.message || error),
    }, '[Income][Telegram] Failed to notify requester about refund review result');
  }
}
