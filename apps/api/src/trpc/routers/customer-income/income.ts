import { createIncomeSchema } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ADJUSTMENT_STATUS_PENDING } from '../../../services/customer-income/constants';
import { createIncomeEntry } from '../../../services/customer-income/create-income';
import { isAdminUser, shouldSelfScopeManagerActions } from '../../../services/customer-income/roles';
import { assertSaleChainDebtInvariant, lockSaleChain, reconcileBonusAfterIncomeChange } from '../../../services/customer-income/sale-chain';
import { adminProcedure, protectedProcedure } from '../../trpc';

export const incomeProcedures = {
  createIncome: protectedProcedure
    .input(createIncomeSchema)
    .mutation(async ({ ctx, input }) => {
      if (shouldSelfScopeManagerActions(ctx.user.roles) && input.managerUserId !== ctx.user.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can create income records only for yourself.',
        });
      }

      const isAdmin = isAdminUser(ctx.user.roles);
      const skipTelegramNotification = isAdmin && Boolean(input.skipTelegramNotification);

      const result = await createIncomeEntry({
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        input,
        requesterRoles: ctx.user.roles,
        skipTelegramNotification,
        db: ctx.db,
      });

      await reconcileBonusAfterIncomeChange(ctx.tenantId, ctx.user.userId, { incomeId: result.income.id }, ctx.db);

      return {
        income: result.income,
        telegramDispatch: result.telegramDispatch,
        debug: result.chronologyDebug,
      };
    }),
  deleteIncome: adminProcedure
    .input(
      z.object({
        incomeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const income = await ctx.db.income.findFirst({
        where: {
          id: input.incomeId,
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
          type: true,
          paymentAmount: true,
          relatedDebtIncomeId: true,
        },
      });

      if (!income) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Income entry not found.' });
      }

      const linkedPendingAdjustmentCount = await ctx.db.incomeAdjustmentRequest.count({
        where: {
          tenantId: ctx.tenantId,
          incomeId: income.id,
          status: ADJUSTMENT_STATUS_PENDING,
        },
      });

      if (linkedPendingAdjustmentCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This income entry has pending adjustment requests. Resolve them first.',
        });
      }

      if (income.type === 'new_sale') {
        const linkedRepayments = await ctx.db.income.count({
          where: {
            tenantId: ctx.tenantId,
            type: 'repayment',
            relatedDebtIncomeId: income.id,
          },
        });

        if (linkedRepayments > 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This sale has repayments. Delete repayments first.',
          });
        }
      }

      await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
        // Repeat the checks above under the chain lock: a repayment or request added meanwhile must stop the delete.
        await lockSaleChain(tx, {
          tenantId: ctx.tenantId,
          saleId: income.type === 'repayment' && income.relatedDebtIncomeId ? income.relatedDebtIncomeId : income.id,
        });
        const [pendingNow, repaymentsNow] = await Promise.all([
          tx.incomeAdjustmentRequest.count({
            where: { tenantId: ctx.tenantId, incomeId: income.id, status: ADJUSTMENT_STATUS_PENDING },
          }),
          income.type === 'new_sale'
            ? tx.income.count({ where: { tenantId: ctx.tenantId, type: 'repayment', relatedDebtIncomeId: income.id } })
            : Promise.resolve(0),
        ]);

        if (pendingNow > 0 || repaymentsNow > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: repaymentsNow > 0
              ? 'This sale has repayments. Delete repayments first.'
              : 'This income entry has pending adjustment requests. Resolve them first.',
          });
        }

        await tx.income.delete({
          where: { id: income.id },
        });

        // Recompute the whole chain so later repayments' stored debt stays correct.
        if (income.type === 'repayment' && income.relatedDebtIncomeId) {
          await assertSaleChainDebtInvariant(tx, {
            tenantId: ctx.tenantId,
            saleId: income.relatedDebtIncomeId,
          });
        }
      }, {
        // Chain recompute after delete can outlast the 5s interactive transaction default.
        maxWait: 15000,
        timeout: 60000,
      });

      await reconcileBonusAfterIncomeChange(ctx.tenantId, ctx.user.userId, { incomeId: income.id }, ctx.db);

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_delete',
          resource: 'income',
          resourceId: income.id,
          metadata: {
            type: income.type,
          },
        },
      });

      return { success: true };
    }),
};
