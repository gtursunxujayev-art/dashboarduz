import type { DbClient } from '@dashboarduz/db';
import { adjustmentStatusSchema, adjustmentTypeSchema } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { thrownText } from '../../../lib/errors';
import { logger } from '../../../lib/logger';
import { ADJUSTMENT_STATUS_PENDING, ADJUSTMENT_TYPE_REFUND, ADJUSTMENT_TYPE_TARIFF_CHANGE, INCOME_LIFECYCLE_PENDING_REFUND, REFUND_CARD_NUMBER_REGEX } from '../../../services/customer-income/constants';
import { getIncomeLifecycleLabel } from '../../../services/customer-income/labels';
import { notifyFinanceUsersRefundRequested, sendRefundRequestedTelegram } from '../../../services/customer-income/refund-notifications';
import { canViewRefundCardNumber, getAdjustmentRoleScope } from '../../../services/customer-income/roles';
import { lockSaleChain } from '../../../services/customer-income/sale-chain';
import { resolveIncomeScope, resolveIncomeWriterIds } from '../../../services/customer-income/scope';
import { sendTariffChangeRequestedTelegram } from '../../../services/customer-income/tariff-change-notifications';
import { INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { protectedProcedure } from '../../trpc';

type AdjustmentNotifyParams = { tenantId: string; requestId: string; requestedByUserId: string; db: DbClient };

/** Sends a Telegram notification about a new request; a failure is logged and never fails the request. */
async function notifyNonBlocking(
  notify: (params: AdjustmentNotifyParams) => Promise<unknown>,
  params: AdjustmentNotifyParams,
  failureLogMessage: string,
): Promise<void> {
  try {
    await notify(params);
  } catch (error) {
    logger.error({
      tenantId: params.tenantId,
      requestId: params.requestId,
      error: thrownText(error),
    }, failureLogMessage);
  }
}

/**
 * For callers outside the approver queue: the requests they made or that are on incomes in their data scope
 * (their own incomes for agents, their group's for team leaders and OnlineAdmin).
 */
async function buildVisibleRequestOwnerWhere(ctx: {
  tenantId: string;
  user: { userId: string; roles: string[] };
  db: DbClient;
}): Promise<Prisma.IncomeAdjustmentRequestWhereInput> {
  const { userIds } = await resolveIncomeScope(ctx);

  return {
    OR: [
      { requestedByUserId: ctx.user.userId },
      { income: { managerUserId: userIds ? { in: userIds } : ctx.user.userId } },
    ],
  };
}

export const adjustmentProcedures = {
  listAdjustmentRequests: protectedProcedure
    .input(
      z
        .object({
          status: adjustmentStatusSchema.optional(),
          type: adjustmentTypeSchema.optional(),
          limit: z.number().int().positive().max(200).default(80),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const scope = getAdjustmentRoleScope(ctx.user.roles);
      const roleTypeGuard = scope.typeGuard;
      const visibleOwnerWhere = scope.canSeeAll ? null : await buildVisibleRequestOwnerWhere(ctx);

      if (input?.type && roleTypeGuard && input.type !== roleTypeGuard) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this request type.',
        });
      }

      const where: Prisma.IncomeAdjustmentRequestWhereInput = {
        tenantId: ctx.tenantId,
        ...(input?.status ? { status: input.status } : {}),
        ...(input?.type
          ? { type: input.type }
          : (roleTypeGuard ? { type: roleTypeGuard } : {})),
        ...(visibleOwnerWhere ?? {}),
      };

      const requestSelectBase = {
        id: true,
        type: true,
        status: true,
        reason: true,
        reviewNote: true,
        requestedAmount: true,
        newAgreementAmount: true,
        createdAt: true,
        reviewedAt: true,
        income: {
          select: {
            id: true,
            type: true,
            lifecycleStatus: true,
            paymentAmount: true,
            coursePriceAmount: true,
            remainingDebtAmount: true,
            course: { select: { name: true } },
            tariff: { select: { name: true } },
            customer: { select: { customerNumber: true, name: true, profileSubTariffId: true } },
            manager: { select: { name: true, username: true } },
          },
        },
        requestedBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        newCourse: { select: { id: true, name: true } },
        newTariff: { select: { id: true, name: true } },
        previousCourse: { select: { id: true, name: true } },
        previousTariff: { select: { id: true, name: true } },
      } satisfies Prisma.IncomeAdjustmentRequestSelect;

      const requests = await ctx.db.incomeAdjustmentRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: input?.limit ?? 80,
        select: {
          ...requestSelectBase,
          refundCardNumber: true,
        },
      });

      const profileSubTariffIds = Array.from(
        new Set(
          requests
            .map((request) => request.income.customer.profileSubTariffId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const newTariffIds = Array.from(
        new Set(
          requests
            .map((request) => request.newTariff?.id)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const [profileSubTariffs, newTariffSubTariffs] = await Promise.all([
        profileSubTariffIds.length
          ? ctx.db.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                id: { in: profileSubTariffIds },
              },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        newTariffIds.length
          ? ctx.db.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                tariffId: { in: newTariffIds },
                isActive: true,
              },
              select: { tariffId: true, name: true },
            })
          : Promise.resolve([]),
      ]);

      const profileSubTariffNameById = new Map(profileSubTariffs.map((subTariff) => [subTariff.id, subTariff.name]));
      const newTariffSubTariffNamesByTariffId = new Map<string, Set<string>>();

      for (const subTariff of newTariffSubTariffs) {
        const tariffId = subTariff.tariffId;
        const bucket = newTariffSubTariffNamesByTariffId.get(tariffId) || new Set<string>();

        bucket.add(subTariff.name.trim().toLowerCase());
        newTariffSubTariffNamesByTariffId.set(tariffId, bucket);
      }

      const showRefundCardNumber = canViewRefundCardNumber(ctx.user.roles);

      return requests.map((request) => ({
        ...request,
        // The card number is stored as entered; only Admin and Finance get it back.
        ...(showRefundCardNumber ? {} : { refundCardNumber: null }),
        income: {
          ...request.income,
          lifecycleStatus: getIncomeLifecycleLabel(request.income.lifecycleStatus),
          managerLabel: request.income.manager.name || request.income.manager.username || '-',
          profileSubTariffName: request.income.customer.profileSubTariffId
            ? profileSubTariffNameById.get(request.income.customer.profileSubTariffId) || null
            : null,
        },
        inferredNewSubTariffName: (() => {
          const oldSubTariffName = request.income.customer.profileSubTariffId
            ? profileSubTariffNameById.get(request.income.customer.profileSubTariffId) || null
            : null;

          if (!oldSubTariffName || !request.newTariff?.id) {
            return null;
          }
          const normalizedOldName = oldSubTariffName.trim().toLowerCase();
          const targetTariffNames = newTariffSubTariffNamesByTariffId.get(request.newTariff.id);

          if (!targetTariffNames || !targetTariffNames.has(normalizedOldName)) {
            return null;
          }

          return oldSubTariffName;
        })(),
        requestedByLabel: request.requestedBy.name || request.requestedBy.username || request.requestedBy.id,
        reviewedByLabel: request.reviewedBy
          ? (request.reviewedBy.name || request.reviewedBy.username || request.reviewedBy.id)
          : null,
      }));
    }),
  adjustmentBadgeCount: protectedProcedure.query(async ({ ctx }) => {
    const scope = getAdjustmentRoleScope(ctx.user.roles);
    const visibleOwnerWhere = scope.canSeeAll ? null : await buildVisibleRequestOwnerWhere(ctx);
    const pendingWhereBase: Prisma.IncomeAdjustmentRequestWhereInput = {
      tenantId: ctx.tenantId,
      status: ADJUSTMENT_STATUS_PENDING,
      ...(scope.typeGuard ? { type: scope.typeGuard } : {}),
      ...(visibleOwnerWhere ?? {}),
    };

    const [pendingTotal, pendingRefund, pendingTariffChange] = await Promise.all([
      ctx.db.incomeAdjustmentRequest.count({
        where: pendingWhereBase,
      }),
      ctx.db.incomeAdjustmentRequest.count({
        // AND keeps the role's type guard in pendingWhereBase; a plain `type` would replace it.
        where: {
          ...pendingWhereBase,
          AND: [{ type: ADJUSTMENT_TYPE_REFUND }],
        },
      }),
      ctx.db.incomeAdjustmentRequest.count({
        // AND keeps the role's type guard in pendingWhereBase; a plain `type` would replace it.
        where: {
          ...pendingWhereBase,
          AND: [{ type: ADJUSTMENT_TYPE_TARIFF_CHANGE }],
        },
      }),
    ]);

    return {
      pendingTotal,
      pendingRefund,
      pendingTariffChange,
      scopedToApproverQueue: scope.canSeeAll,
    };
  }),
  createAdjustmentRequest: protectedProcedure
    .input(
      z.object({
        type: adjustmentTypeSchema,
        incomeId: z.string().uuid(),
        reason: z.string().max(500).optional(),
        refundCardNumber: z.string().regex(REFUND_CARD_NUMBER_REGEX).optional(),
        newCourseId: z.string().uuid().optional(),
        newTariffId: z.string().uuid().optional(),
        newAgreementAmount: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Agents and team leaders: only their own incomes; OnlineAdmin: incomes of the online group.
      const writerIds = resolveIncomeWriterIds(await resolveIncomeScope(ctx), ctx.user.userId);
      const sourceIncomeRaw = await ctx.db.income.findFirst({
        where: {
          id: input.incomeId,
          tenantId: ctx.tenantId,
          paymentAmount: { gt: 0 },
          ...(writerIds
            ? {
                managerUserId: { in: writerIds },
              }
            : {}),
        },
        select: {
          id: true,
          type: true,
          relatedDebtIncomeId: true,
          tenantId: true,
          customerId: true,
          courseId: true,
          tariffId: true,
          coursePriceAmount: true,
          paymentAmount: true,
          lifecycleStatus: true,
        },
      });

      if (!sourceIncomeRaw) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Selected income was not found.' });
      }

      let sourceIncome = sourceIncomeRaw;

      if (input.type === ADJUSTMENT_TYPE_REFUND && sourceIncomeRaw.type === 'repayment') {
        if (!sourceIncomeRaw.relatedDebtIncomeId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Qarzdorlik to'lovi uchun asosiy sotuv topilmadi.",
          });
        }

        const rootSaleIncome = await ctx.db.income.findFirst({
          where: {
            id: sourceIncomeRaw.relatedDebtIncomeId,
            tenantId: ctx.tenantId,
            customerId: sourceIncomeRaw.customerId,
            type: 'new_sale',
            ...(writerIds
              ? {
                  managerUserId: { in: writerIds },
                }
              : {}),
          },
          select: {
            id: true,
            type: true,
            relatedDebtIncomeId: true,
            tenantId: true,
            customerId: true,
            courseId: true,
            tariffId: true,
            coursePriceAmount: true,
            paymentAmount: true,
            lifecycleStatus: true,
          },
        });

        if (!rootSaleIncome) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Refund uchun asosiy sotuv topilmadi.",
          });
        }

        sourceIncome = rootSaleIncome;
      }

      if (sourceIncome.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Only active income entries can be adjusted.',
        });
      }

      const existingPending = await ctx.db.incomeAdjustmentRequest.findFirst({
        where: {
          tenantId: ctx.tenantId,
          incomeId: sourceIncome.id,
          status: ADJUSTMENT_STATUS_PENDING,
        },
        select: { id: true },
      });

      if (existingPending) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'A pending request already exists for this income entry.',
        });
      }

      if (input.type === ADJUSTMENT_TYPE_TARIFF_CHANGE) {
        if (sourceIncome.type !== 'new_sale') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Tariff change is available only for new sale entries.',
          });
        }

        if (!input.newCourseId || !input.newTariffId || !input.newAgreementAmount) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Course, tariff, and agreement amount are required for tariff change.',
          });
        }

        const [course, tariff] = await Promise.all([
          ctx.db.course.findFirst({
            where: {
              id: input.newCourseId,
              tenantId: ctx.tenantId,
              isActive: true,
            },
            select: { id: true },
          }),
          ctx.db.tariff.findFirst({
            where: {
              id: input.newTariffId,
              tenantId: ctx.tenantId,
              courseId: input.newCourseId,
              isActive: true,
            },
            select: { id: true },
          }),
        ]);

        if (!course || !tariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected course/tariff was not found.' });
        }
      }
      if (input.type === ADJUSTMENT_TYPE_REFUND && !input.refundCardNumber) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Pul qaytarish uchun 16 xonali karta raqami majburiy.",
        });
      }

      const createdRequest = await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
        // The checks above were a fast path. Lock the chain and repeat them on committed data, so two concurrent
        // requests for one sale cannot both pass and both put it on hold.
        await lockSaleChain(tx, { tenantId: ctx.tenantId, saleId: sourceIncome.id });
        const [lockedSource, pendingRequest] = await Promise.all([
          tx.income.findFirst({ where: { id: sourceIncome.id, tenantId: ctx.tenantId }, select: { lifecycleStatus: true } }),
          tx.incomeAdjustmentRequest.findFirst({
            where: { tenantId: ctx.tenantId, incomeId: sourceIncome.id, status: ADJUSTMENT_STATUS_PENDING },
            select: { id: true },
          }),
        ]);

        if (lockedSource?.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Only active income entries can be adjusted.' });
        }
        if (pendingRequest) {
          throw new TRPCError({ code: 'CONFLICT', message: 'A pending request already exists for this income entry.' });
        }

        // A refund returns the whole sale chain, so the requested amount is everything paid on it.
        const refundChainPaidAmount = input.type === ADJUSTMENT_TYPE_REFUND
          ? ((await tx.income.aggregate({
              where: {
                tenantId: ctx.tenantId,
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
                OR: [{ id: sourceIncome.id }, { relatedDebtIncomeId: sourceIncome.id }],
              },
              _sum: { paymentAmount: true },
            }))._sum.paymentAmount ?? sourceIncome.paymentAmount)
          : null;

        const request: { id: string; type: string; status: string } = await tx.incomeAdjustmentRequest.create({
          data: {
            tenantId: ctx.tenantId,
            type: input.type,
            status: ADJUSTMENT_STATUS_PENDING,
            incomeId: sourceIncome.id,
            customerId: sourceIncome.customerId,
            requestedByUserId: ctx.user.userId,
            reason: input.reason?.trim() || null,
            requestedAmount: input.type === ADJUSTMENT_TYPE_REFUND ? refundChainPaidAmount : null,
            refundCardNumber: input.type === ADJUSTMENT_TYPE_REFUND ? input.refundCardNumber || null : null,
            newCourseId: input.type === ADJUSTMENT_TYPE_TARIFF_CHANGE ? input.newCourseId || null : null,
            newTariffId: input.type === ADJUSTMENT_TYPE_TARIFF_CHANGE ? input.newTariffId || null : null,
            newAgreementAmount: input.type === ADJUSTMENT_TYPE_TARIFF_CHANGE ? input.newAgreementAmount || null : null,
            previousCourseId: sourceIncome.courseId ?? null,
            previousTariffId: sourceIncome.tariffId ?? null,
          },
          select: {
            id: true,
            type: true,
            status: true,
          },
        });

        if (input.type === ADJUSTMENT_TYPE_REFUND) {
          await tx.income.updateMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              OR: [{ id: sourceIncome.id }, { relatedDebtIncomeId: sourceIncome.id }],
            },
            data: {
              lifecycleStatus: INCOME_LIFECYCLE_PENDING_REFUND,
            },
          });
        }

        return request;
      }, {
        maxWait: 10_000,
        timeout: 30_000,
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_adjustment_request_create',
          resource: 'income_adjustment_request',
          resourceId: createdRequest.id,
          metadata: {
            incomeId: sourceIncome.id,
            type: input.type,
          },
        },
      });

      const notifyParams = {
        tenantId: ctx.tenantId,
        requestId: createdRequest.id,
        requestedByUserId: ctx.user.userId,
        db: ctx.db,
      };

      if (input.type === ADJUSTMENT_TYPE_REFUND) {
        await notifyNonBlocking(sendRefundRequestedTelegram, notifyParams, '[Income][Telegram] Refund request notification failed (non-blocking)');

        await notifyNonBlocking(notifyFinanceUsersRefundRequested, notifyParams, '[Income][Telegram] Finance direct notification for refund request failed (non-blocking)');
      } else if (input.type === ADJUSTMENT_TYPE_TARIFF_CHANGE) {
        await notifyNonBlocking(sendTariffChangeRequestedTelegram, notifyParams, '[Income][Telegram] Tariff-change request notification failed (non-blocking)');
      }

      return createdRequest;
    }),
};
