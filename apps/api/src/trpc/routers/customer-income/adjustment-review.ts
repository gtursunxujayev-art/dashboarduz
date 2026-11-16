import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logger } from '../../../lib/logger';
import { ADJUSTMENT_STATUS_APPROVED, ADJUSTMENT_STATUS_PENDING, ADJUSTMENT_STATUS_REJECTED, ADJUSTMENT_TYPE_REFUND, ADJUSTMENT_TYPE_TARIFF_CHANGE, INCOME_LIFECYCLE_PENDING_REFUND, INCOME_LIFECYCLE_REFUNDED } from '../../../services/customer-income/constants';
import { notifyRefundRequesterReviewResult, sendRefundApprovedTelegram } from '../../../services/customer-income/refund-notifications';
import { canApproveRefundRequest, canApproveTariffChangeRequest } from '../../../services/customer-income/roles';
import { assertSaleChainDebtInvariant, reconcileBonusAfterIncomeChange } from '../../../services/customer-income/sale-chain';
import { INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { protectedProcedure } from '../../trpc';

export const adjustmentReviewProcedures = {
  approveAdjustmentRequest: protectedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        reviewNote: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.db.incomeAdjustmentRequest.findFirst({
        where: {
          id: input.requestId,
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
          type: true,
          status: true,
          incomeId: true,
          newCourseId: true,
          newTariffId: true,
          newAgreementAmount: true,
          income: {
            select: {
              id: true,
              type: true,
              managerUserId: true,
              lifecycleStatus: true,
              paymentAmount: true,
              coursePriceAmount: true,
            },
          },
        },
      });

      if (!request) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found.' });
      }

      if (request.status !== ADJUSTMENT_STATUS_PENDING) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Only pending requests can be approved.' });
      }

      if (request.type === ADJUSTMENT_TYPE_REFUND && !canApproveRefundRequest(ctx.user.roles)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin or Finance role is required to approve refunds.' });
      }

      if (request.type === ADJUSTMENT_TYPE_TARIFF_CHANGE && !canApproveTariffChangeRequest(ctx.user.roles)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "Admin, Manager, Tashkiliy, or Organizator role is required to approve tariff changes.",
        });
      }

      await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
        if (request.type === ADJUSTMENT_TYPE_REFUND) {
          await tx.income.updateMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: { in: [INCOME_LIFECYCLE_ACTIVE, INCOME_LIFECYCLE_PENDING_REFUND] },
              OR: [{ id: request.incomeId }, { relatedDebtIncomeId: request.incomeId }],
            },
            data: {
              lifecycleStatus: INCOME_LIFECYCLE_REFUNDED,
            },
          });
        } else {
          if (!request.newCourseId || !request.newTariffId || !request.newAgreementAmount) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'Tariff-change request does not have target course/tariff/agreement.',
            });
          }

          const [course, tariff, sourceIncome, repaymentAggregate] = await Promise.all([
            tx.course.findFirst({
              where: {
                id: request.newCourseId,
                tenantId: ctx.tenantId,
                isActive: true,
              },
              select: { id: true },
            }),
            tx.tariff.findFirst({
              where: {
                id: request.newTariffId,
                tenantId: ctx.tenantId,
                courseId: request.newCourseId,
                isActive: true,
              },
              select: { id: true },
            }),
            tx.income.findFirst({
              where: {
                id: request.incomeId,
                tenantId: ctx.tenantId,
                type: 'new_sale',
              },
              select: {
                id: true,
                paymentAmount: true,
                lifecycleStatus: true,
              },
            }),
            tx.income.aggregate({
              where: {
                tenantId: ctx.tenantId,
                type: 'repayment',
                relatedDebtIncomeId: request.incomeId,
                lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              },
              _sum: {
                paymentAmount: true,
              },
            }),
          ]);

          if (!course || !tariff || !sourceIncome) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'Cannot apply tariff change: source/new course/new tariff is missing.',
            });
          }
          if (sourceIncome.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'Tariff change can be applied only to active income entries.',
            });
          }

          const activeSourcePayment = sourceIncome.lifecycleStatus === INCOME_LIFECYCLE_ACTIVE
            ? (sourceIncome.paymentAmount ?? 0)
            : 0;
          const activeRepayments = repaymentAggregate._sum.paymentAmount ?? 0;
          const totalPaid = activeSourcePayment + activeRepayments;
          const remainingDebtAmount = Math.max(request.newAgreementAmount - totalPaid, 0);

          await tx.income.update({
            where: { id: request.incomeId },
            data: {
              courseId: request.newCourseId,
              tariffId: request.newTariffId,
              coursePriceAmount: request.newAgreementAmount,
              debtAmount: request.newAgreementAmount,
              remainingDebtAmount,
            },
          });

          await tx.income.updateMany({
            where: {
              tenantId: ctx.tenantId,
              type: 'repayment',
              relatedDebtIncomeId: request.incomeId,
            },
            data: {
              courseId: request.newCourseId,
              tariffId: request.newTariffId,
            },
          });

          await assertSaleChainDebtInvariant(tx, {
            tenantId: ctx.tenantId,
            saleId: request.incomeId,
          });
        }

        await tx.incomeAdjustmentRequest.update({
          where: { id: request.id },
          data: {
            status: ADJUSTMENT_STATUS_APPROVED,
            reviewedByUserId: ctx.user.userId,
            reviewNote: input.reviewNote?.trim() || null,
            reviewedAt: new Date(),
          },
          select: { id: true },
        });
      }, {
        // Tariff change rewrites the whole chain + invariant repair; the 5s default closes it mid-way.
        maxWait: 15000,
        timeout: 60000,
      });

      await reconcileBonusAfterIncomeChange(ctx.tenantId, ctx.user.userId, { requestId: request.id }, ctx.db);

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_adjustment_request_approve',
          resource: 'income_adjustment_request',
          resourceId: request.id,
          metadata: {
            type: request.type,
            incomeId: request.incomeId,
          },
        },
      });

      if (request.type === ADJUSTMENT_TYPE_REFUND) {
        try {
          await sendRefundApprovedTelegram({
            tenantId: ctx.tenantId,
            requestId: request.id,
            reviewedByUserId: ctx.user.userId,
            db: ctx.db,
          });
        } catch (error) {
          logger.error({
            tenantId: ctx.tenantId,
            requestId: request.id,
            error: String((error as any)?.message || error),
          }, '[Income][Telegram] Refund notification failed (non-blocking)');
        }

        try {
          await notifyRefundRequesterReviewResult({
            tenantId: ctx.tenantId,
            requestId: request.id,
            status: 'approved',
            db: ctx.db,
          });
        } catch (error) {
          logger.error({
            tenantId: ctx.tenantId,
            requestId: request.id,
            error: String((error as any)?.message || error),
          }, '[Income][Telegram] Requester approved-refund notification failed (non-blocking)');
        }
      }

      return { success: true };
    }),
  rejectAdjustmentRequest: protectedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        reviewNote: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.db.incomeAdjustmentRequest.findFirst({
        where: {
          id: input.requestId,
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
          type: true,
          status: true,
          incomeId: true,
          income: {
            select: {
              id: true,
              customerId: true,
              courseId: true,
              tariffId: true,
              lifecycleStatus: true,
              managerUserId: true,
            },
          },
        },
      });

      if (!request) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found.' });
      }

      if (request.status !== ADJUSTMENT_STATUS_PENDING) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Only pending requests can be rejected.' });
      }

      if (request.type === ADJUSTMENT_TYPE_REFUND && !canApproveRefundRequest(ctx.user.roles)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin or Finance role is required to reject refunds.' });
      }

      if (request.type === ADJUSTMENT_TYPE_TARIFF_CHANGE && !canApproveTariffChangeRequest(ctx.user.roles)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "Admin, Manager, Tashkiliy, or Organizator role is required to reject tariff changes.",
        });
      }

      await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
        // Restore every row of the chain that the refund request put on hold, not just the sale row.
        await tx.income.updateMany({
          where: {
            tenantId: ctx.tenantId,
            lifecycleStatus: INCOME_LIFECYCLE_PENDING_REFUND,
            OR: [{ id: request.income.id }, { relatedDebtIncomeId: request.income.id }],
          },
          data: {
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          },
        });

        // Only a refund rejection changes the chain; a tariff-change rejection leaves every income row as is.
        if (request.type === ADJUSTMENT_TYPE_REFUND) {
          await assertSaleChainDebtInvariant(tx, {
            tenantId: ctx.tenantId,
            saleId: request.income.id,
          });
        }

        await tx.customer.update({
          where: { id: request.income.customerId },
          data: {
            profileCourseId: request.income.courseId ?? null,
            profileTariffId: request.income.tariffId ?? null,
          },
        });

        await tx.incomeAdjustmentRequest.update({
          where: { id: request.id },
          data: {
            status: ADJUSTMENT_STATUS_REJECTED,
            reviewedByUserId: ctx.user.userId,
            reviewNote: input.reviewNote?.trim() || null,
            reviewedAt: new Date(),
          },
          select: { id: true },
        });
      }, {
        // Refund rejection restores the chain and runs invariant repair.
        maxWait: 15000,
        timeout: 60000,
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_adjustment_request_reject',
          resource: 'income_adjustment_request',
          resourceId: request.id,
          metadata: {
            type: request.type,
            incomeId: request.income.id,
          },
        },
      });

      await reconcileBonusAfterIncomeChange(ctx.tenantId, ctx.user.userId, { requestId: request.id }, ctx.db);

      if (request.type === ADJUSTMENT_TYPE_REFUND) {
        try {
          await notifyRefundRequesterReviewResult({
            tenantId: ctx.tenantId,
            requestId: request.id,
            status: 'rejected',
            db: ctx.db,
          });
        } catch (error) {
          logger.error({
            tenantId: ctx.tenantId,
            requestId: request.id,
            error: String((error as any)?.message || error),
          }, '[Income][Telegram] Requester rejected-refund notification failed (non-blocking)');
        }
      }

      return { success: true };
    }),
};
