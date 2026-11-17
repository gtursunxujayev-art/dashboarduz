import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logger } from '../../../lib/logger';
import { ADJUSTMENT_STATUS_PENDING, ADJUSTMENT_TYPE_REFUND, INCOME_LIFECYCLE_PENDING_REFUND } from '../../../services/customer-income/constants';
import { notifyFinanceUsersRefundRequested, sendRefundRequestedTelegram } from '../../../services/customer-income/refund-notifications';
import { assertSaleChainDebtInvariant, lockSaleChainUnchanged, normalizeSaleChainChronology, readSaleChainState, reconcileBonusAfterIncomeChange, refreshCustomerProfileFromLatestActiveSale, withSaleSubTariffMeta } from '../../../services/customer-income/sale-chain';
import { extractSaleSubTariffId, getSaleAgreementAmount, INCOME_LIFECYCLE_ACTIVE } from '../../../services/income-chain';
import { adminProcedure } from '../../trpc';

export const customerCourseProcedures = {
  deleteCustomerCourse: adminProcedure
    .input(
      z.object({
        saleIncomeId: z.string().uuid(),
        action: z.enum(['delete', 'refund', 'relink']).default('delete'),
        targetSaleIncomeId: z.string().uuid().optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const saleIncome = await ctx.db.income.findFirst({
        where: {
          id: input.saleIncomeId,
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        },
        select: {
          id: true,
          customerId: true,
          managerUserId: true,
          courseId: true,
          tariffId: true,
          entryDate: true,
        },
      });

      if (!saleIncome) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: "O'chiriladigan aktiv kurs topilmadi.",
        });
      }

      // Amounts and checks below are computed from rows read now; the transaction locks the chain and refuses to
      // write if any of them changed meanwhile (a concurrent repayment, refund request or edit).
      const chainStateBefore = await readSaleChainState(ctx.db, { tenantId: ctx.tenantId, saleId: saleIncome.id });

      if (chainStateBefore.find((row) => row.id === saleIncome.id)?.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE) {
        throw new TRPCError({ code: 'CONFLICT', message: "Bu kurs hozirgina o'zgartirildi. Sahifani yangilab, qayta urinib ko'ring." });
      }
      const saleChain = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          OR: [
            { id: saleIncome.id },
            { relatedDebtIncomeId: saleIncome.id },
          ],
        },
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          paymentAmount: true,
          entryDate: true,
          createdAt: true,
        },
      });
      const saleChainIds = saleChain.map((item) => item.id);

      if (!saleChainIds.length) {
        return {
          success: true,
          deletedCount: 0,
          mode: input.action,
        };
      }

      const pendingAdjustmentCount = await ctx.db.incomeAdjustmentRequest.count({
        where: {
          tenantId: ctx.tenantId,
          incomeId: { in: saleChainIds },
          status: ADJUSTMENT_STATUS_PENDING,
        },
      });

      if (pendingAdjustmentCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Bu kurs bo'yicha kutilayotgan so'rovlar bor. Avval so'rovlarni yakunlang.",
        });
      }

      const transferAmount = saleChain.reduce((sum, item) => sum + (item.paymentAmount || 0), 0);
      const relinkedCount = saleChainIds.length;
      let targetSaleIncomeId: string | null = null;
      let createdRefundRequestId: string | null = null;
      let relinkedPaymentDates: string[] = [];
      let relinkedRepaymentIds: string[] = [];

      if (input.action === 'relink') {
        if (!input.targetSaleIncomeId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Daromadni o'tkazish uchun maqsad kurs tanlanishi shart.",
          });
        }
        if (input.targetSaleIncomeId === saleIncome.id) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Daromadni aynan shu kursga o'tkazib bo'lmaydi.",
          });
        }
      }

      const resultPayload = await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
        await lockSaleChainUnchanged(tx, { tenantId: ctx.tenantId, saleId: saleIncome.id, expected: chainStateBefore });
        if (await tx.incomeAdjustmentRequest.count({
          where: { tenantId: ctx.tenantId, incomeId: { in: saleChainIds }, status: ADJUSTMENT_STATUS_PENDING },
        }) > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: "Bu kurs bo'yicha kutilayotgan so'rovlar bor. Avval so'rovlarni yakunlang." });
        }
        if (input.action === 'refund') {
          const existingPending = await tx.incomeAdjustmentRequest.findFirst({
            where: {
              tenantId: ctx.tenantId,
              incomeId: saleIncome.id,
              status: ADJUSTMENT_STATUS_PENDING,
            },
            select: { id: true },
          });

          if (existingPending) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: "Bu kurs uchun allaqachon refund so'rovi mavjud.",
            });
          }

          await tx.income.updateMany({
            where: {
              tenantId: ctx.tenantId,
              id: { in: saleChainIds },
            },
            data: {
              lifecycleStatus: INCOME_LIFECYCLE_PENDING_REFUND,
            },
          });

          const request = await tx.incomeAdjustmentRequest.create({
            data: {
              tenantId: ctx.tenantId,
              type: ADJUSTMENT_TYPE_REFUND,
              status: ADJUSTMENT_STATUS_PENDING,
              incomeId: saleIncome.id,
              customerId: saleIncome.customerId,
              requestedByUserId: ctx.user.userId,
              reason: input.note?.trim() || "Mijoz kursini o'chirish oynasidan refund yaratildi.",
              requestedAmount: transferAmount,
            },
            select: { id: true },
          });

          createdRefundRequestId = request.id;

          await refreshCustomerProfileFromLatestActiveSale(tx, {
            tenantId: ctx.tenantId,
            customerId: saleIncome.customerId,
          });

          return {
            deletedCount: 0,
            mode: 'refund' as const,
          };
        }

        if (input.action === 'relink') {
          const targetSale = await tx.income.findFirst({
            where: {
              id: input.targetSaleIncomeId!,
              tenantId: ctx.tenantId,
              customerId: saleIncome.customerId,
              type: 'new_sale',
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
            },
            select: {
              id: true,
              courseId: true,
              tariffId: true,
              coursePriceAmount: true,
              debtAmount: true,
              paymentAmount: true,
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

          if (!targetSale) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: "Daromadni ulash uchun tanlangan kurs topilmadi.",
            });
          }

          const targetSaleSubTariffId = extractSaleSubTariffId(targetSale.legacyImportMeta);
          const profileMatchedTargetSubTariffId = (
            targetSale.customer.profileCourseId === targetSale.courseId
            && targetSale.customer.profileTariffId === targetSale.tariffId
          )
            ? targetSale.customer.profileSubTariffId || null
            : null;
          const effectiveTargetSubTariffId = targetSaleSubTariffId || profileMatchedTargetSubTariffId || null;

          const targetChainRows = await tx.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
              OR: [
                { id: targetSale.id },
                { relatedDebtIncomeId: targetSale.id },
              ],
            },
            select: {
              id: true,
              paymentAmount: true,
            },
          });
          const targetAgreementAmount = getSaleAgreementAmount(targetSale);
          const targetPaidAmount = targetChainRows.reduce((sum, row) => sum + Math.max(Number(row.paymentAmount || 0), 0), 0);
          const targetCurrentDebtAmount = Math.max(targetAgreementAmount - targetPaidAmount, 0);

          if (transferAmount > targetCurrentDebtAmount) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: `Summalar juda katta: o'tkaziladigan to'lov (${transferAmount.toLocaleString('uz-UZ')}) maqsad kurs qarzidan (${targetCurrentDebtAmount.toLocaleString('uz-UZ')}) katta.`,
            });
          }

          await tx.income.updateMany({
            where: {
              tenantId: ctx.tenantId,
              id: { in: saleChainIds },
            },
            data: {
              type: 'repayment',
              relatedDebtIncomeId: targetSale.id,
              courseId: targetSale.courseId,
              tariffId: targetSale.tariffId,
              coursePriceAmount: null,
              debtAmount: 0,
              remainingDebtAmount: 0,
              legacyImportMeta: Prisma.JsonNull,
            },
          });

          const normalized = await normalizeSaleChainChronology(tx, {
            tenantId: ctx.tenantId,
            saleId: targetSale.id,
          });

          if (normalized.didReorder) {
            relinkedRepaymentIds = normalized.reorderedIncomeIds.filter((id) => id !== normalized.canonicalSaleId);
          }
          await assertSaleChainDebtInvariant(tx, {
            tenantId: ctx.tenantId,
            saleId: normalized.canonicalSaleId,
          });

          targetSaleIncomeId = targetSale.id;
          relinkedPaymentDates = saleChain
            .map((row) => row.entryDate?.toISOString?.() || String(row.entryDate))
            .filter(Boolean);

          await refreshCustomerProfileFromLatestActiveSale(tx, {
            tenantId: ctx.tenantId,
            customerId: saleIncome.customerId,
          });

          return {
            deletedCount: 0,
            mode: 'relink' as const,
          };
        }

        const deleted = await tx.income.deleteMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: saleChainIds },
          },
        });

        await refreshCustomerProfileFromLatestActiveSale(tx, {
          tenantId: ctx.tenantId,
          customerId: saleIncome.customerId,
        });

        return {
          deletedCount: deleted.count,
          mode: 'delete' as const,
        };
      }, {
        // Relink/delete course actions can touch long payment chains.
        // Increase interactive transaction window to avoid premature close.
        maxWait: 15000,
        timeout: 60000,
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: input.action === 'refund'
            ? 'customer_course_refund_request_create'
            : (input.action === 'relink' ? 'customer_course_relink' : 'customer_course_delete'),
          resource: 'income',
          resourceId: saleIncome.id,
          metadata: {
            customerId: saleIncome.customerId,
            saleIncomeId: saleIncome.id,
            sourceCourseId: saleIncome.courseId,
            sourceTariffId: saleIncome.tariffId,
            sourceEntryDate: saleIncome.entryDate,
            transferAmount,
            targetSaleIncomeId,
            refundRequestId: createdRefundRequestId,
            action: input.action,
            managerUserId: saleIncome.managerUserId,
            deletedCount: resultPayload.deletedCount,
            relinkedRepaymentIds,
            relinkedPaymentDates,
          },
        },
      });

      if (createdRefundRequestId) {
        try {
          await sendRefundRequestedTelegram({
            tenantId: ctx.tenantId,
            requestId: createdRefundRequestId,
            requestedByUserId: ctx.user.userId,
            db: ctx.db,
          });
        } catch (error) {
          logger.error({
            tenantId: ctx.tenantId,
            requestId: createdRefundRequestId,
            error: String((error as any)?.message || error),
          }, '[Income][Telegram] Refund request notification failed (non-blocking)');
        }

        try {
          await notifyFinanceUsersRefundRequested({
            tenantId: ctx.tenantId,
            requestId: createdRefundRequestId,
            requestedByUserId: ctx.user.userId,
            db: ctx.db,
          });
        } catch (error) {
          logger.error({
            tenantId: ctx.tenantId,
            requestId: createdRefundRequestId,
            error: String((error as any)?.message || error),
          }, '[Income][Telegram] Finance direct notification for refund request failed (non-blocking)');
        }
      }

      await reconcileBonusAfterIncomeChange(ctx.tenantId, ctx.user.userId, { action: 'deleteCustomerCourse' }, ctx.db);

      return {
        success: true,
        deletedCount: resultPayload.deletedCount,
        relinkedCount: resultPayload.mode === 'relink' ? relinkedCount : 0,
        mode: resultPayload.mode,
        targetSaleIncomeId,
        refundRequestId: createdRefundRequestId,
      };
    }),
  updateCustomerCourseSale: adminProcedure
    .input(
      z.object({
        saleIncomeId: z.string().uuid(),
        newCourseId: z.string().uuid(),
        newTariffId: z.string().uuid().optional(),
        newSubTariffId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.newTariffId && input.newSubTariffId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tarif tanlanmasdan subtarif tanlab bo\'lmaydi.',
        });
      }

      const saleIncome = await ctx.db.income.findFirst({
        where: {
          id: input.saleIncomeId,
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: INCOME_LIFECYCLE_ACTIVE,
        },
        select: {
          id: true,
          customerId: true,
          legacyImportMeta: true,
        },
      });

      if (!saleIncome) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: "Tahrirlanadigan aktiv kurs topilmadi.",
        });
      }

      const [course, tariff, activeSubTariffs] = await Promise.all([
        ctx.db.course.findFirst({
          where: {
            id: input.newCourseId,
            tenantId: ctx.tenantId,
            isActive: true,
          },
          select: { id: true },
        }),
        input.newTariffId
          ? ctx.db.tariff.findFirst({
              where: {
                id: input.newTariffId,
                tenantId: ctx.tenantId,
                courseId: input.newCourseId,
                isActive: true,
              },
              select: { id: true },
            })
          : Promise.resolve(null),
        input.newTariffId
          ? ctx.db.subTariff.findMany({
              where: {
                tenantId: ctx.tenantId,
                tariffId: input.newTariffId,
                isActive: true,
              },
              orderBy: [{ name: 'asc' }],
              select: { id: true },
            })
          : Promise.resolve([]),
      ]);

      if (!course) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Yangi kurs topilmadi yoki faol emas.",
        });
      }
      if (input.newTariffId && !tariff) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Yangi tarif tanlangan kursga tegishli emas yoki faol emas.",
        });
      }
      let nextSubTariffId: string | null = input.newSubTariffId || null;

      if (input.newTariffId) {
        const subTariffIdSet = new Set(activeSubTariffs.map((item) => item.id));

        if (nextSubTariffId && !subTariffIdSet.has(nextSubTariffId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Yangi subtarif tanlangan tarifga tegishli emas yoki faol emas.",
          });
        }
        const firstActiveSubTariff = activeSubTariffs[0];

        if (!nextSubTariffId && firstActiveSubTariff) {
          nextSubTariffId = firstActiveSubTariff.id;
        }
      }

      // Amounts and checks below are computed from rows read now; the transaction locks the chain and refuses to
      // write if any of them changed meanwhile (a concurrent repayment, refund request or edit).
      const chainStateBefore = await readSaleChainState(ctx.db, { tenantId: ctx.tenantId, saleId: saleIncome.id });

      if (chainStateBefore.find((row) => row.id === saleIncome.id)?.lifecycleStatus !== INCOME_LIFECYCLE_ACTIVE) {
        throw new TRPCError({ code: 'CONFLICT', message: "Bu kurs hozirgina o'zgartirildi. Sahifani yangilab, qayta urinib ko'ring." });
      }
      const saleChain = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          OR: [{ id: saleIncome.id }, { relatedDebtIncomeId: saleIncome.id }],
        },
        select: { id: true },
      });
      const saleChainIds = saleChain.map((row) => row.id);

      const pendingAdjustmentCount = await ctx.db.incomeAdjustmentRequest.count({
        where: {
          tenantId: ctx.tenantId,
          incomeId: { in: saleChainIds },
          status: ADJUSTMENT_STATUS_PENDING,
        },
      });

      if (pendingAdjustmentCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Bu kurs bo'yicha kutilayotgan so'rovlar bor. Avval so'rovlarni yakunlang.",
        });
      }

      await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
        await lockSaleChainUnchanged(tx, { tenantId: ctx.tenantId, saleId: saleIncome.id, expected: chainStateBefore });
        if (await tx.incomeAdjustmentRequest.count({
          where: { tenantId: ctx.tenantId, incomeId: { in: saleChainIds }, status: ADJUSTMENT_STATUS_PENDING },
        }) > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: "Bu kurs bo'yicha kutilayotgan so'rovlar bor. Avval so'rovlarni yakunlang." });
        }
        await tx.income.update({
          where: { id: saleIncome.id },
          data: {
            courseId: input.newCourseId,
            tariffId: input.newTariffId || null,
            legacyImportMeta: withSaleSubTariffMeta(
              saleIncome.legacyImportMeta,
              nextSubTariffId,
            ),
          },
        });

        await tx.income.updateMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'repayment',
            relatedDebtIncomeId: saleIncome.id,
          },
          data: {
            courseId: input.newCourseId,
            tariffId: input.newTariffId || null,
          },
        });

        await tx.customer.update({
          where: { id: saleIncome.customerId },
          data: {
            profileSubTariffId: nextSubTariffId,
          },
        });

        await refreshCustomerProfileFromLatestActiveSale(tx, {
          tenantId: ctx.tenantId,
          customerId: saleIncome.customerId,
        });

        await assertSaleChainDebtInvariant(tx, {
          tenantId: ctx.tenantId,
          saleId: saleIncome.id,
        });
      }, {
        // Sale edit rewrites the chain + invariant repair; avoid premature transaction close.
        maxWait: 15000,
        timeout: 60000,
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'customer_course_sale_update',
          resource: 'income',
          resourceId: saleIncome.id,
          metadata: {
            newCourseId: input.newCourseId,
            newTariffId: input.newTariffId || null,
            newSubTariffId: nextSubTariffId,
          },
        },
      });

      await reconcileBonusAfterIncomeChange(ctx.tenantId, ctx.user.userId, { action: 'updateCustomerCourseSale' }, ctx.db);

      return {
        success: true,
      };
    }),
};
