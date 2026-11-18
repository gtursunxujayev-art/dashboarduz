import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { ADJUSTMENT_STATUS_PENDING } from '../../../services/customer-income/constants';
import { parseDateInput } from '../../../services/customer-income/labels';
import { assertManagerBelongsToTenantWithOptions } from '../../../services/customer-income/roles';
import { assertSaleChainDebtInvariant, lockSaleChainUnchanged, normalizeSaleChainChronology, readSaleChainState, reconcileBonusAfterIncomeChange, refreshCustomerProfileFromLatestActiveSale, requestBonusReconcile, rowMatchesSaleChainState, withSaleSubTariffMeta } from '../../../services/customer-income/sale-chain';
import { extractSaleSubTariffId, INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { adminProcedure } from '../../trpc';

const updateIncomeSchema = z.object({
  incomeId: z.string().uuid(),
  entryDate: z.string().min(1).optional(),
  managerUserId: z.string().uuid().optional(),
  paymentAmount: z.number().int().min(0).optional(),
  deadline: z.string().min(1).nullable().optional(),
  courseId: z.string().uuid().optional(),
  tariffId: z.string().uuid().optional(),
  subTariffId: z.string().uuid().nullable().optional(),
  coursePriceAmount: z.number().int().min(0).optional(),
});

/**
 * Puts a sale chain back in date order. When that changed which row is the sale, re-reads `rowId` and
 * re-checks the debts of the new canonical sale (in that order, inside `tx`).
 */
async function normalizeChainOrder(tx: Prisma.TransactionClient, tenantId: string, saleId: string, rowId: string) {
  const normalized = await normalizeSaleChainChronology(tx, { tenantId, saleId });

  if (!normalized.didReorder) {
    return { normalized, refreshedIncome: null };
  }

  const refreshedIncome = await tx.income.findUnique({ where: { id: rowId } });

  await assertSaleChainDebtInvariant(tx, { tenantId, saleId: normalized.canonicalSaleId });

  return { normalized, refreshedIncome };
}

export const incomeUpdateProcedures = {
  updateIncome: adminProcedure
    .input(updateIncomeSchema)
    .mutation(async ({ ctx, input }) => {
      const income = await ctx.db.income.findFirst({
        where: {
          id: input.incomeId,
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
          type: true,
          customerId: true,
          managerUserId: true,
          courseId: true,
          tariffId: true,
          entryDate: true,
          deadline: true,
          paymentAmount: true,
          coursePriceAmount: true,
          debtAmount: true,
          remainingDebtAmount: true,
          relatedDebtIncomeId: true,
          lifecycleStatus: true,
          legacyImportMeta: true,
          customer: {
            select: {
              profileCourseId: true,
              profileTariffId: true,
              profileSubTariffId: true,
            },
          },
        },
      });

      if (!income) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Income entry not found.' });
      }

      if (income.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Only active income entries can be edited.',
        });
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

      // The new amounts below are computed from rows read now, outside the transaction. Record the chain state
      // first; each transaction then locks the chain and refuses to write if that state changed meanwhile.
      const chainSaleId = income.type === 'new_sale' ? income.id : (income.relatedDebtIncomeId ?? income.id);
      const chainStateBefore = await readSaleChainState(ctx.db, { tenantId: ctx.tenantId, saleId: chainSaleId });

      if (!rowMatchesSaleChainState(chainStateBefore, income)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: "Bu yozuv hozirgina boshqa foydalanuvchi tomonidan o'zgartirildi. Sahifani yangilab, qayta urinib ko'ring.",
        });
      }
      const lockChainForEdit = async (tx: Prisma.TransactionClient): Promise<void> => {
        await lockSaleChainUnchanged(tx, { tenantId: ctx.tenantId, saleId: chainSaleId, expected: chainStateBefore });
        // Every edit of a sale or a repayment can move finalized bonus; the marker commits with the edit.
        await requestBonusReconcile(tx, ctx.tenantId, 'updateIncome');
        const pendingNow = await tx.incomeAdjustmentRequest.count({
          where: { tenantId: ctx.tenantId, incomeId: income.id, status: ADJUSTMENT_STATUS_PENDING },
        });

        if (pendingNow > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This income entry has pending adjustment requests. Resolve them first.',
          });
        }
      };

      const parsedEntryDate = input.entryDate ? parseDateInput(input.entryDate) : null;

      if (parsedEntryDate && parsedEntryDate > new Date()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "Kelajakdagi sana kiritish mumkin emas. Bugungi yoki o'tgan sanani tanlang." });
      }
      const parsedDeadline = input.deadline === undefined
        ? undefined
        : (input.deadline === null ? null : parseDateInput(input.deadline));

      if (income.type === 'new_sale') {
        const linkedRepayments = await ctx.db.income.findMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'repayment',
            relatedDebtIncomeId: income.id,
            lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
          },
          orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            entryDate: true,
            paymentAmount: true,
          },
        });

        const nextManagerUserId = input.managerUserId ?? income.managerUserId;

        await assertManagerBelongsToTenantWithOptions({
          tenantId: ctx.tenantId,
          managerUserId: nextManagerUserId,
          includeInactive: true,
          db: ctx.db,
        });

        const nextCourseId = input.courseId ?? income.courseId;
        const nextTariffId = input.tariffId ?? income.tariffId;
        const existingSaleSubTariffId = extractSaleSubTariffId(income.legacyImportMeta);
        const isProfileMatchingNextSelection = Boolean(
          income.customer?.profileCourseId
          && income.customer?.profileTariffId
          && income.customer.profileCourseId === nextCourseId
          && income.customer.profileTariffId === nextTariffId,
        );
        const profileFallbackSubTariffId = isProfileMatchingNextSelection
          ? (income.customer?.profileSubTariffId ?? null)
          : null;
        const requestedSubTariffId = input.subTariffId === undefined
          ? (existingSaleSubTariffId || profileFallbackSubTariffId)
          : input.subTariffId;
        const nextCoursePriceAmount = input.coursePriceAmount ?? income.coursePriceAmount ?? 0;
        const nextPaymentAmount = input.paymentAmount ?? income.paymentAmount;
        const totalRepaymentPaid = linkedRepayments.reduce((sum, repayment) => sum + Number(repayment.paymentAmount || 0), 0);
        const totalPaidForSale = nextPaymentAmount + totalRepaymentPaid;

        if (!nextCourseId || !nextTariffId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Course and tariff are required for a new sale.',
          });
        }

        if (nextCoursePriceAmount < totalPaidForSale) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Agreement amount cannot be less than total paid amount for this sale.",
          });
        }

        const [course, tariff, activeSubTariffCount] = await Promise.all([
          ctx.db.course.findFirst({
            where: {
              id: nextCourseId,
              tenantId: ctx.tenantId,
              isActive: true,
            },
            select: { id: true },
          }),
          ctx.db.tariff.findFirst({
            where: {
              id: nextTariffId,
              tenantId: ctx.tenantId,
              courseId: nextCourseId,
              isActive: true,
            },
            select: { id: true },
          }),
          ctx.db.subTariff.count({
            where: {
              tenantId: ctx.tenantId,
              tariffId: nextTariffId,
              isActive: true,
            },
          }),
        ]);

        if (!course || !tariff) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Course or tariff not found.' });
        }

        if (activeSubTariffCount > 0 && !requestedSubTariffId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Sub-tariff is required for the selected tariff.',
          });
        }

        let nextSubTariffId: string | null = null;

        if (requestedSubTariffId) {
          const subTariff = await ctx.db.subTariff.findFirst({
            where: {
              id: requestedSubTariffId,
              tenantId: ctx.tenantId,
              tariffId: nextTariffId,
              isActive: true,
            },
            select: { id: true },
          });

          if (!subTariff) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Sub-tariff not found for selected tariff.',
            });
          }
          nextSubTariffId = subTariff.id;
        }

        let rollingDebt = Math.max(nextCoursePriceAmount - nextPaymentAmount, 0);
        const repaymentDebtStates = linkedRepayments.map((repayment) => {
          const debtAmount = rollingDebt;
          const remainingDebtAmount = Math.max(debtAmount - Number(repayment.paymentAmount || 0), 0);

          rollingDebt = remainingDebtAmount;

          return {
            id: repayment.id,
            debtAmount,
            remainingDebtAmount,
          };
        });

        const sourceRemainingDebtAmount = rollingDebt;

        let chronologyReordered = false;
        let chronologyCanonicalSaleId: string | null = null;

        const updated = await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
          await lockChainForEdit(tx);
          const updatedSale = await tx.income.update({
            where: { id: income.id },
            data: {
              managerUserId: nextManagerUserId,
              entryDate: parsedEntryDate ?? income.entryDate,
              deadline: sourceRemainingDebtAmount > 0
                ? (parsedDeadline !== undefined ? parsedDeadline : income.deadline)
                : null,
              courseId: nextCourseId,
              tariffId: nextTariffId,
              coursePriceAmount: nextCoursePriceAmount,
              debtAmount: nextCoursePriceAmount,
              paymentAmount: nextPaymentAmount,
              remainingDebtAmount: sourceRemainingDebtAmount,
              legacyImportMeta: withSaleSubTariffMeta(income.legacyImportMeta, nextSubTariffId),
            },
          });

          if (repaymentDebtStates.length > 0) {
            for (const repaymentState of repaymentDebtStates) {
              await tx.income.update({
                where: { id: repaymentState.id },
                data: {
                  courseId: nextCourseId,
                  tariffId: nextTariffId,
                  debtAmount: repaymentState.debtAmount,
                  remainingDebtAmount: repaymentState.remainingDebtAmount,
                },
              });
            }
          }

          await tx.customer.update({
            where: { id: income.customerId },
            data: {
              profileSubTariffId: nextSubTariffId,
            },
          });

          await refreshCustomerProfileFromLatestActiveSale(tx, {
            tenantId: ctx.tenantId,
            customerId: income.customerId,
          });

          if (linkedRepayments.length > 0) {
            const { normalized, refreshedIncome } = await normalizeChainOrder(tx, ctx.tenantId, income.id, income.id);

            if (normalized.didReorder) {
              chronologyReordered = true;
              chronologyCanonicalSaleId = normalized.canonicalSaleId;

              return refreshedIncome ?? updatedSale;
            }
          }

          await assertSaleChainDebtInvariant(tx, {
            tenantId: ctx.tenantId,
            saleId: chronologyCanonicalSaleId || income.id,
          });

          return updatedSale;
        }, {
          // Income edit can trigger chain normalization + full debt recompute.
          // Keep transaction open long enough to prevent "Transaction not found".
          maxWait: 15000,
          timeout: 60000,
        });

        await ctx.db.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            userId: ctx.user.userId,
            action: 'income_update',
            resource: 'income',
            resourceId: income.id,
            metadata: {
              type: income.type,
              mode: chronologyReordered
                ? 'income_chain_reordered_by_date'
                : 'new_sale',
              ...(chronologyReordered
                ? { canonicalSaleIncomeId: chronologyCanonicalSaleId }
                : {}),
            },
          },
        });

        await reconcileBonusAfterIncomeChange(ctx.tenantId, ctx.user.userId, { action: 'updateIncome' }, ctx.db);

        return {
          success: true,
          income: updated,
          debug: {
            incomeChainReorderedByDate: chronologyReordered,
            canonicalSaleIncomeId: chronologyCanonicalSaleId,
          },
        };
      }

      if (
        input.courseId !== undefined
        || input.tariffId !== undefined
        || input.subTariffId !== undefined
        || input.coursePriceAmount !== undefined
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Repayment rows do not support course or tariff edits.',
        });
      }

      const nextManagerUserId = input.managerUserId ?? income.managerUserId;

      await assertManagerBelongsToTenantWithOptions({
        tenantId: ctx.tenantId,
        managerUserId: nextManagerUserId,
        includeInactive: true,
        db: ctx.db,
      });

      const nextPaymentAmount = input.paymentAmount ?? income.paymentAmount;

      if (nextPaymentAmount <= 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Repayment amount must be greater than zero.',
        });
      }

      if (!income.relatedDebtIncomeId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This repayment does not have a source debt.',
        });
      }

      const sourceIncome = await ctx.db.income.findFirst({
        where: {
          id: income.relatedDebtIncomeId,
          tenantId: ctx.tenantId,
          type: 'new_sale',
        },
        select: {
          id: true,
          entryDate: true,
          debtAmount: true,
          remainingDebtAmount: true,
        },
      });

      if (!sourceIncome) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Debt source income was not found.',
        });
      }

      const sourceDebtAtRepaymentTime = income.debtAmount ?? (sourceIncome.remainingDebtAmount + income.paymentAmount);

      if (nextPaymentAmount > sourceDebtAtRepaymentTime) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Repayment amount cannot exceed source debt.',
        });
      }

      const paymentDelta = nextPaymentAmount - income.paymentAmount;
      const nextSourceRemainingDebtRaw = sourceIncome.remainingDebtAmount - paymentDelta;
      const nextSourceRemainingDebt = sourceIncome.debtAmount !== null
        ? Math.min(nextSourceRemainingDebtRaw, sourceIncome.debtAmount)
        : nextSourceRemainingDebtRaw;

      if (nextSourceRemainingDebt < 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Repayment amount cannot exceed source debt.',
        });
      }

      const nextRepaymentRemainingDebt = Math.max(sourceDebtAtRepaymentTime - nextPaymentAmount, 0);

      let chronologyReordered = false;
      let chronologyCanonicalSaleId: string | null = null;

      const updatedRepayment = await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
        await lockChainForEdit(tx);
        await tx.income.update({
          where: { id: sourceIncome.id },
          data: {
            remainingDebtAmount: nextSourceRemainingDebt,
          },
        });

        const updatedRow = await tx.income.update({
          where: { id: income.id },
          data: {
            managerUserId: nextManagerUserId,
            entryDate: parsedEntryDate ?? income.entryDate,
            deadline: parsedDeadline !== undefined ? parsedDeadline : income.deadline,
            debtAmount: sourceDebtAtRepaymentTime,
            paymentAmount: nextPaymentAmount,
            remainingDebtAmount: nextRepaymentRemainingDebt,
          },
        });

        const { normalized, refreshedIncome } = await normalizeChainOrder(tx, ctx.tenantId, sourceIncome.id, income.id);

        if (normalized.didReorder) {
          chronologyReordered = true;
          chronologyCanonicalSaleId = normalized.canonicalSaleId;

          return refreshedIncome ?? updatedRow;
        }

        await assertSaleChainDebtInvariant(tx, {
          tenantId: ctx.tenantId,
          saleId: sourceIncome.id,
        });

        return updatedRow;
      }, {
        // Repayment edit can trigger chronology normalize + chain invariant repair.
        maxWait: 15000,
        timeout: 60000,
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_update',
          resource: 'income',
          resourceId: income.id,
          metadata: {
            type: income.type,
            mode: chronologyReordered
              ? 'income_chain_reordered_by_date'
              : 'repayment',
            ...(chronologyReordered
              ? { canonicalSaleIncomeId: chronologyCanonicalSaleId }
              : {}),
          },
        },
      });

      await reconcileBonusAfterIncomeChange(ctx.tenantId, ctx.user.userId, { action: 'updateIncome' }, ctx.db);

      return {
        success: true,
        income: updatedRepayment,
        debug: {
          incomeChainReorderedByDate: chronologyReordered,
          canonicalSaleIncomeId: chronologyCanonicalSaleId,
        },
      };
    }),
};
