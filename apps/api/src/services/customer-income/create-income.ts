import type { TenantPrismaClient } from '@dashboarduz/db';
import { type CreateIncomeInput, normalizeDigits, sanitizeTelegramUsername } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { thrownText } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { buildActiveSaleChainMetrics, INCOME_LIFECYCLE_ACTIVE, SALE_SUB_TARIFF_META_KEY } from '../income-chain';

import { CUSTOMER_NUMBER_REGEX, TELEGRAM_USERNAME_REGEX } from './constants';
import { parseDateInput } from './labels';
import { sendOfflineOrIntensivePaymentTelegram } from './payment-notifications';
import { assertManagerBelongsToTenantWithOptions, canSelectInactiveManagerForIncome } from './roles';
import { assertSaleChainDebtInvariant, lockSaleChain, normalizeSaleChainChronology, refreshCustomerProfileFromLatestActiveSale, requestBonusReconcile } from './sale-chain';

export async function createIncomeEntry(params: {
  tenantId: string;
  userId: string;
  input: CreateIncomeInput;
  requesterRoles?: string[];
  writeAuditLog?: boolean;
  allowHiddenCourseSelection?: boolean;
  skipTelegramNotification?: boolean;
  db: TenantPrismaClient;
}) {
  const { db } = params;

  const {
    tenantId,
    userId,
    input,
    requesterRoles = [],
    writeAuditLog = true,
    allowHiddenCourseSelection = false,
    skipTelegramNotification = false,
  } = params;

  await assertManagerBelongsToTenantWithOptions({
    tenantId,
    managerUserId: input.managerUserId,
    includeInactive: canSelectInactiveManagerForIncome(requesterRoles),
    db,
  });
  const entryDate = parseDateInput(input.entryDate);

  if (entryDate > new Date()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: "Kelajakdagi sana kiritish mumkin emas. Bugungi yoki o'tgan sanani tanlang." });
  }
  const deadline = input.deadline ? parseDateInput(input.deadline) : null;
  const customerNumber = normalizeDigits(input.customerNumber.trim());

  if (!customerNumber || !CUSTOMER_NUMBER_REGEX.test(customerNumber)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: "Customer number must contain only digits.",
    });
  }

  const normalizedTelegramUsername = input.telegramUsername
    ? sanitizeTelegramUsername(input.telegramUsername.trim())
    : null;

  if (normalizedTelegramUsername && !TELEGRAM_USERNAME_REGEX.test(normalizedTelegramUsername)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Telegram username may contain only letters, digits, "_" and optional "@".',
    });
  }

  if (input.paymentAmount < 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Payment amount cannot be negative.' });
  }

  let customer = await db.customer.findUnique({
    where: {
      tenantId_customerNumber: {
        tenantId,
        customerNumber,
      },
    },
  });

  if (!customer) {
    if (input.type === 'repayment') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Repayment can only be added for an existing customer debt.',
      });
    }

    if (!input.customerName?.trim()) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Customer name is required for a new customer number.',
      });
    }

    customer = await db.customer.create({
      data: {
        tenantId,
        customerNumber,
        name: input.customerName.trim(),
        telegramUsername: normalizedTelegramUsername || null,
      },
    });
  }

  let createdIncome;
  let chronologyReordered = false;
  let chronologyCanonicalSaleId: string | null = null;
  let selectedSubTariffId: string | undefined;
  let telegramDispatch:
    | {
        attempted: boolean;
        delivered: boolean;
        sentCount: number;
        failedCount: number;
        reason?: string;
        errors?: string[];
      }
    | null = null;

  if (input.type === 'new_sale') {
    if (!input.courseId || !input.tariffId || input.coursePriceAmount === undefined) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Course, tariff, and course price are required for a new sale.',
      });
    }

    if (input.coursePriceAmount < 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course price cannot be negative.' });
    }

    const [course, tariff, activeSubTariffCount] = await Promise.all([
      db.course.findFirst({
        where: {
          id: input.courseId,
          tenantId,
          isActive: true,
          ...(allowHiddenCourseSelection ? {} : { isHiddenFromIncomeForm: false }),
        },
        select: { id: true },
      }),
      db.tariff.findFirst({
        where: { id: input.tariffId, tenantId, courseId: input.courseId, isActive: true },
        select: { id: true },
      }),
      db.subTariff.count({
        where: {
          tenantId,
          tariffId: input.tariffId,
          isActive: true,
        },
      }),
    ]);

    if (!course || !tariff) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course or tariff not found.' });
    }

    if (activeSubTariffCount > 0 && !input.subTariffId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Sub-tariff is required for the selected tariff.',
      });
    }

    if (input.subTariffId) {
      const subTariff = await db.subTariff.findFirst({
        where: {
          id: input.subTariffId,
          tenantId,
          tariffId: input.tariffId,
          isActive: true,
        },
        select: { id: true },
      });

      if (!subTariff) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Sub-tariff not found for selected tariff.' });
      }
      selectedSubTariffId = subTariff.id;
    }

    const remainingDebtAmount = Math.max(input.coursePriceAmount - input.paymentAmount, 0);

    createdIncome = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await requestBonusReconcile(tx, tenantId, 'createIncome');
      const createdSale = await tx.income.create({
        data: {
          tenantId,
          customerId: customer.id,
          managerUserId: input.managerUserId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          courseId: input.courseId,
          tariffId: input.tariffId,
          entryDate,
          deadline: remainingDebtAmount > 0 ? deadline : null,
          coursePriceAmount: input.coursePriceAmount,
          debtAmount: input.coursePriceAmount,
          paymentAmount: input.paymentAmount,
          remainingDebtAmount,
          legacyImportMeta: selectedSubTariffId
            ? ({ [SALE_SUB_TARIFF_META_KEY]: selectedSubTariffId } as Prisma.InputJsonValue)
            : undefined,
        },
      });

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          profileSubTariffId: selectedSubTariffId || null,
        },
      });

      await refreshCustomerProfileFromLatestActiveSale(tx, {
        tenantId,
        customerId: customer.id,
      });
      await assertSaleChainDebtInvariant(tx, {
        tenantId,
        saleId: createdSale.id,
      });

      return createdSale;
    }, {
      // Keep transaction alive for chain normalization/invariant checks on busy tenants.
      maxWait: 10_000,
      timeout: 30_000,
    });
  } else {
    let debtSourceId = input.debtSourceIncomeId;

    if (!debtSourceId) {
      const candidateDebts = await db.income.findMany({
        where: {
          tenantId,
          customerId: customer.id,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        take: 200,
        select: {
          id: true,
          entryDate: true,
          coursePriceAmount: true,
          debtAmount: true,
          paymentAmount: true,
        },
      });
      const candidateMetrics = await buildActiveSaleChainMetrics({
        tenantId,
        sales: candidateDebts,
        db,
      });
      const latestDebt = candidateDebts.find((sale) => (candidateMetrics.get(sale.id)?.currentDebtAmount ?? 0) > 0);

      debtSourceId = latestDebt?.id;
    }

    if (!debtSourceId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Debt source is required for repayment.',
      });
    }

    if (input.paymentAmount <= 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Repayment amount must be greater than zero.',
      });
    }

    const lockedDebtSourceId = debtSourceId;

    createdIncome = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      // Lock the chain first and read the debt under the lock: two concurrent repayments on one sale then run one
      // after the other, and the second one sees the first one's payment instead of the same old debt.
      await lockSaleChain(tx, { tenantId, saleId: lockedDebtSourceId });
      await requestBonusReconcile(tx, tenantId, 'createIncome');

      const debtSource = await tx.income.findFirst({
        where: {
          id: lockedDebtSourceId,
          tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        },
        select: {
          id: true,
          customerId: true,
          courseId: true,
          tariffId: true,
          entryDate: true,
          coursePriceAmount: true,
          debtAmount: true,
          paymentAmount: true,
          remainingDebtAmount: true,
        },
      });

      if (!debtSource) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected debt source not found.' });
      }

      if (debtSource.customerId !== customer.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected debt does not belong to the selected customer.',
        });
      }

      const sourceMetrics = await buildActiveSaleChainMetrics({
        tenantId,
        sales: [debtSource],
        db: tx,
      });
      const sourceCurrentDebt = sourceMetrics.get(debtSource.id)?.currentDebtAmount ?? debtSource.remainingDebtAmount;

      if (sourceCurrentDebt <= 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected debt source has no remaining debt.',
        });
      }

      if (input.paymentAmount > sourceCurrentDebt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Repayment amount cannot exceed the selected debt.',
        });
      }

      const remainingDebtAmount = Math.max(sourceCurrentDebt - input.paymentAmount, 0);
      const repayment = await tx.income.create({
        data: {
          tenantId,
          customerId: customer.id,
          managerUserId: input.managerUserId,
          type: 'repayment',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          relatedDebtIncomeId: debtSource.id,
          courseId: debtSource.courseId,
          tariffId: debtSource.tariffId,
          entryDate,
          deadline,
          debtAmount: sourceCurrentDebt,
          paymentAmount: input.paymentAmount,
          remainingDebtAmount,
        },
      });

      await tx.income.update({
        where: { id: debtSource.id },
        data: {
          remainingDebtAmount,
        },
      });

      const normalized = await normalizeSaleChainChronology(tx, {
        tenantId,
        saleId: debtSource.id,
      });

      if (normalized.didReorder) {
        chronologyReordered = true;
        chronologyCanonicalSaleId = normalized.canonicalSaleId;
      }
      await assertSaleChainDebtInvariant(tx, {
        tenantId,
        saleId: chronologyCanonicalSaleId || debtSource.id,
      });

      const refreshedRepayment = await tx.income.findUnique({
        where: { id: repayment.id },
      });

      return refreshedRepayment ?? repayment;
    }, {
      // Repayment flow can touch long chains; avoid premature interactive transaction close.
      maxWait: 10_000,
      timeout: 30_000,
    });
  }

  if (writeAuditLog) {
    await db.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'income_create',
        resource: 'income',
        resourceId: createdIncome.id,
        metadata: {
          type: input.type,
          customerNumber: customer.customerNumber,
          ...(chronologyReordered
            ? {
                mode: 'income_chain_reordered_by_date',
                canonicalSaleIncomeId: chronologyCanonicalSaleId,
              }
            : {}),
        },
      },
    });

    if (skipTelegramNotification) {
      telegramDispatch = {
        attempted: false,
        delivered: false,
        sentCount: 0,
        failedCount: 0,
        reason: 'skipped_by_admin',
      };
    } else {
      try {
        telegramDispatch = await sendOfflineOrIntensivePaymentTelegram({
          tenantId,
          incomeId: createdIncome.id,
          preferredSubTariffId: selectedSubTariffId,
          db,
        });
      } catch (error) {
        logger.error({
          tenantId,
          incomeId: createdIncome.id,
          error: thrownText(error),
        }, '[Income][Telegram] Payment notification failed (non-blocking)');
        telegramDispatch = {
          attempted: true,
          delivered: false,
          sentCount: 0,
          failedCount: 0,
          reason: 'send_failed',
          errors: [thrownText(error)],
        };
      }
    }
  }

  return {
    income: createdIncome,
    customerNumber: customer.customerNumber,
    telegramDispatch,
    chronologyDebug: {
      incomeChainReorderedByDate: chronologyReordered,
      canonicalSaleIncomeId: chronologyCanonicalSaleId,
    },
  };
}
