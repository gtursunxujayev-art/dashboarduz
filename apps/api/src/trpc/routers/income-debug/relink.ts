import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { recomputeSaleChainStateFully, refreshCustomerProfileFromLatestActiveSaleForDebug } from '../../../services/income-debug/chain-recompute';
import { adminProcedure } from '../../trpc';

export const incomeDebugRelinkProcedures = {
  destructiveRelinkCourseChain: adminProcedure
    .input(z.object({
      sourceSaleIncomeId: z.string().uuid(),
      targetSaleIncomeId: z.string().uuid(),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.sourceSaleIncomeId === input.targetSaleIncomeId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Manba va maqsad sotuv bir xil bo'lishi mumkin emas.",
        });
      }

      const sourceSale = await ctx.db.income.findFirst({
        where: {
          id: input.sourceSaleIncomeId,
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: 'active',
        },
        select: {
          id: true,
          customerId: true,
          managerUserId: true,
          courseId: true,
          tariffId: true,
        },
      });
      const targetSale = await ctx.db.income.findFirst({
        where: {
          id: input.targetSaleIncomeId,
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: 'active',
        },
        select: {
          id: true,
          customerId: true,
          managerUserId: true,
          courseId: true,
          tariffId: true,
          deadline: true,
          remainingDebtAmount: true,
        },
      });

      if (!sourceSale || !targetSale) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Manba yoki maqsad aktiv yangi sotuv topilmadi.',
        });
      }
      if (sourceSale.customerId !== targetSale.customerId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Faqat bir xil mijoz kurslari orasida destructive relink mumkin.',
        });
      }

      const result = await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
        const sourceChain = await tx.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            OR: [
              { id: sourceSale.id },
              { relatedDebtIncomeId: sourceSale.id },
            ],
            lifecycleStatus: 'active',
          },
          orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            entryDate: true,
            createdAt: true,
            paymentAmount: true,
          },
        });

        if (!sourceChain.length) {
          return {
            deletedCount: 0,
            createdRepaymentsCount: 0,
            transferAmount: 0,
            targetSaleIncomeId: targetSale.id,
          };
        }

        await recomputeSaleChainStateFully(tx, {
          tenantId: ctx.tenantId,
          saleId: targetSale.id,
        });
        const refreshedTarget = await tx.income.findUnique({
          where: { id: targetSale.id },
          select: {
            id: true,
            managerUserId: true,
            courseId: true,
            tariffId: true,
            deadline: true,
            remainingDebtAmount: true,
          },
        });

        if (!refreshedTarget) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Maqsad kurs topilmadi.' });
        }

        const transferAmount = sourceChain.reduce((sum, row) => sum + Math.max(Number(row.paymentAmount || 0), 0), 0);

        if (transferAmount > Math.max(Number(refreshedTarget.remainingDebtAmount || 0), 0)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "O'tkaziladigan summa maqsad kurs qarzidan katta.",
          });
        }

        let runningRemainingDebt = Math.max(Number(refreshedTarget.remainingDebtAmount || 0), 0);
        let createdRepaymentsCount = 0;

        for (const row of sourceChain) {
          const paymentAmount = Math.max(Number(row.paymentAmount || 0), 0);

          if (paymentAmount <= 0) {
            continue;
          }
          const debtBeforePayment = runningRemainingDebt;

          runningRemainingDebt = Math.max(runningRemainingDebt - paymentAmount, 0);
          await tx.income.create({
            data: {
              tenantId: ctx.tenantId,
              customerId: sourceSale.customerId,
              managerUserId: sourceSale.managerUserId || refreshedTarget.managerUserId,
              type: 'repayment',
              lifecycleStatus: 'active',
              relatedDebtIncomeId: refreshedTarget.id,
              courseId: refreshedTarget.courseId,
              tariffId: refreshedTarget.tariffId,
              entryDate: row.entryDate,
              deadline: refreshedTarget.deadline,
              debtAmount: debtBeforePayment,
              paymentAmount,
              remainingDebtAmount: runningRemainingDebt,
            },
          });
          createdRepaymentsCount += 1;
        }

        await tx.income.update({
          where: { id: refreshedTarget.id },
          data: {
            remainingDebtAmount: runningRemainingDebt,
          },
        });

        const deleted = await tx.income.deleteMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: sourceChain.map((row) => row.id) },
          },
        });

        await recomputeSaleChainStateFully(tx, {
          tenantId: ctx.tenantId,
          saleId: refreshedTarget.id,
        });
        await refreshCustomerProfileFromLatestActiveSaleForDebug(tx, {
          tenantId: ctx.tenantId,
          customerId: sourceSale.customerId,
        });

        return {
          deletedCount: deleted.count,
          createdRepaymentsCount,
          transferAmount,
          targetSaleIncomeId: refreshedTarget.id,
        };
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_debug_destructive_relink',
          resource: 'income',
          resourceId: input.sourceSaleIncomeId,
          metadata: {
            sourceSaleIncomeId: input.sourceSaleIncomeId,
            note: input.note || null,
            ...result,
          },
        },
      });

      return {
        success: true,
        ...result,
      };
    }),
};
