import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { parseSnapshotDate, recomputeSaleChainState, recomputeSaleChainStateFully } from '../../../services/income-debug/chain-recompute';
import { findSnapshotMatch, getSaleChainConsistencySnapshot } from '../../../services/income-debug/snapshots';
import { getActiveSnapshot } from '../../../services/income-problems/finance-snapshot';
import { adminProcedure } from '../../trpc';

export const incomeDebugRepairProcedures = {
  repairDatesFromSnapshot: adminProcedure
    .input(z.object({
      incomeIds: z.array(z.string().uuid()).min(1).max(300),
    }))
    .mutation(async ({ ctx, input }) => {
      const activeSnapshot = await getActiveSnapshot(ctx.tenantId, ctx.db);

      if (!activeSnapshot || !Array.isArray(activeSnapshot.rows) || activeSnapshot.rows.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Faol moliya snapshot topilmadi. Avval Tushum muammolari sahifasida snapshotni faollashtiring.',
        });
      }

      const incomes = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: input.incomeIds },
        },
        select: {
          id: true,
          type: true,
          entryDate: true,
          paymentAmount: true,
          remainingDebtAmount: true,
          relatedDebtIncomeId: true,
          lifecycleStatus: true,
          customer: {
            select: {
              customerNumber: true,
              name: true,
            },
          },
          manager: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
          course: {
            select: { name: true },
          },
          tariff: {
            select: { name: true },
          },
        },
      });

      const incomeById = new Map(incomes.map((income) => [income.id, income]));
      const orderedIncomes = input.incomeIds
        .map((incomeId) => incomeById.get(incomeId))
        .filter((income): income is NonNullable<typeof incomeById extends Map<string, infer T> ? T : never> => Boolean(income));

      const snapshotRows = activeSnapshot.rows.filter((row) => row.paymentDate);
      const usedRowKeys = new Set<string>();
      const results: Array<Record<string, unknown>> = [];

      for (const income of orderedIncomes) {
        const match = findSnapshotMatch({
          income: {
            id: income.id,
            type: income.type,
            paymentAmount: Number(income.paymentAmount || 0),
            remainingDebtAmount: Number(income.remainingDebtAmount || 0),
            customerNumber: income.customer?.customerNumber || '',
            customerName: income.customer?.name || '',
            managerName: income.manager?.name || income.manager?.username || income.manager?.id || '',
            courseName: income.course?.name || '',
            tariffName: income.tariff?.name || '',
          },
          snapshotRows,
          usedRowKeys,
        });

        if (match.status !== 'matched') {
          results.push({
            incomeId: income.id,
            customerNumber: income.customer?.customerNumber || '',
            customerName: income.customer?.name || '-',
            oldDate: income.entryDate.toISOString().slice(0, 10),
            status: match.status,
            reason: match.status === 'ambiguous'
              ? `Bir nechta mos qator topildi (${match.candidateCount}).`
              : 'Snapshotda mos qator topilmadi.',
          });
          continue;
        }

        const snapshotDate = parseSnapshotDate(match.row.paymentDate);

        if (!snapshotDate) {
          results.push({
            incomeId: income.id,
            customerNumber: income.customer?.customerNumber || '',
            customerName: income.customer?.name || '-',
            oldDate: income.entryDate.toISOString().slice(0, 10),
            status: 'invalid_snapshot_date',
            reason: 'Snapshot sanasi yaroqsiz.',
          });
          continue;
        }

        const snapshotRowKey = `${match.row.normalizedPhone || match.row.normalizedName}:${match.row.rowIndex}`;

        usedRowKeys.add(snapshotRowKey);

        const oldDate = income.entryDate.toISOString().slice(0, 10);
        const nextDate = snapshotDate.toISOString().slice(0, 10);

        if (oldDate === nextDate) {
          results.push({
            incomeId: income.id,
            customerNumber: income.customer?.customerNumber || '',
            customerName: income.customer?.name || '-',
            oldDate,
            newDate: nextDate,
            status: 'unchanged',
            reason: "Sana allaqachon to'g'ri.",
          });
          continue;
        }

        try {
          const transactionResult = await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
            await tx.income.update({
              where: { id: income.id },
              data: { entryDate: snapshotDate },
            });

            const saleId = income.type === 'new_sale' ? income.id : income.relatedDebtIncomeId;
            let canonicalSaleIncomeId: string | null = null;
            let didReorder = false;

            if (saleId) {
              const recomputed = await recomputeSaleChainState(tx, {
                tenantId: ctx.tenantId,
                saleId,
              });

              canonicalSaleIncomeId = recomputed.canonicalSaleId;
              didReorder = recomputed.didReorder;
            }

            return {
              canonicalSaleIncomeId,
              didReorder,
            };
          });

          results.push({
            incomeId: income.id,
            customerNumber: income.customer?.customerNumber || '',
            customerName: income.customer?.name || '-',
            oldDate,
            newDate: nextDate,
            status: 'updated',
            reason: transactionResult.didReorder
              ? 'Snapshot sanasi tiklandi va chain qayta hisoblandi.'
              : 'Snapshot sanasi tiklandi.',
            canonicalSaleIncomeId: transactionResult.canonicalSaleIncomeId,
          });
        } catch (error) {
          results.push({
            incomeId: income.id,
            customerNumber: income.customer?.customerNumber || '',
            customerName: income.customer?.name || '-',
            oldDate,
            newDate: nextDate,
            status: 'failed',
            reason: error instanceof Error ? error.message : 'Sana tiklashda xatolik yuz berdi.',
          });
        }
      }

      const updatedCount = results.filter((row) => row.status === 'updated').length;
      const skippedCount = results.length - updatedCount;

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_debug_repair_dates_from_snapshot',
          resource: 'income',
          metadata: {
            incomeIds: input.incomeIds,
            updatedCount,
            skippedCount,
            workbookName: activeSnapshot.workbookName,
            sheetName: activeSnapshot.sheetName,
            results: JSON.parse(JSON.stringify(results.slice(0, 50))) as Prisma.InputJsonValue,
          },
        },
      });

      return {
        success: true,
        updatedCount,
        skippedCount,
        results,
      };
    }),
  repairAllActiveChains: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(5000).default(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const activeSales = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: 'active',
        },
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
        take: input.limit,
        select: {
          id: true,
          customerId: true,
          customer: {
            select: {
              customerNumber: true,
              name: true,
            },
          },
        },
      });

      const results: Array<{
        saleIncomeId: string;
        customerNumber: string;
        customerName: string;
        status: 'fixed' | 'skipped' | 'failed';
        reason: string;
        canonicalSaleId?: string;
        didReorder?: boolean;
      }> = [];

      for (const sale of activeSales) {
        try {
          const before = await getSaleChainConsistencySnapshot({
            tenantId: ctx.tenantId,
            saleId: sale.id,
            db: ctx.db,
          });

          if (!before) {
            results.push({
              saleIncomeId: sale.id,
              customerNumber: sale.customer?.customerNumber || '',
              customerName: sale.customer?.name || '-',
              status: 'failed',
              reason: 'Aktiv sotuv topilmadi.',
            });
            continue;
          }

          if (before.consistency.ok) {
            results.push({
              saleIncomeId: sale.id,
              customerNumber: sale.customer?.customerNumber || '',
              customerName: sale.customer?.name || '-',
              status: 'skipped',
              reason: 'Chain allaqachon to‘g‘ri holatda.',
              canonicalSaleId: before.saleId,
              didReorder: false,
            });
            continue;
          }

          const normalized = await ctx.db.$transaction(async (tx: Prisma.TransactionClient) => {
            return recomputeSaleChainStateFully(tx, {
              tenantId: ctx.tenantId,
              saleId: sale.id,
            });
          });

          const after = await getSaleChainConsistencySnapshot({
            tenantId: ctx.tenantId,
            saleId: normalized.canonicalSaleId,
            db: ctx.db,
          });

          if (!after?.consistency.ok) {
            results.push({
              saleIncomeId: sale.id,
              customerNumber: sale.customer?.customerNumber || '',
              customerName: sale.customer?.name || '-',
              status: 'failed',
              reason: `Qayta hisobdan keyin ham mismatch: ${(after?.consistency.issues || ['unknown']).join(', ')}`,
              canonicalSaleId: normalized.canonicalSaleId,
              didReorder: normalized.didReorder,
            });
            continue;
          }

          results.push({
            saleIncomeId: sale.id,
            customerNumber: sale.customer?.customerNumber || '',
            customerName: sale.customer?.name || '-',
            status: 'fixed',
            reason: normalized.didReorder
              ? `Chain qayta tartiblandi va qarz qayta hisoblandi. (${before.consistency.issues.join(', ')})`
              : `Chain qarzi qayta hisoblandi. (${before.consistency.issues.join(', ')})`,
            canonicalSaleId: normalized.canonicalSaleId,
            didReorder: normalized.didReorder,
          });
        } catch (error) {
          results.push({
            saleIncomeId: sale.id,
            customerNumber: sale.customer?.customerNumber || '',
            customerName: sale.customer?.name || '-',
            status: 'failed',
            reason: error instanceof Error ? error.message : 'Qayta hisoblash xatosi.',
          });
        }
      }

      const fixedCount = results.filter((row) => row.status === 'fixed').length;
      const failedCount = results.filter((row) => row.status === 'failed').length;
      const skippedCount = results.filter((row) => row.status === 'skipped').length;

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'income_debug_repair_all_active_chains',
          resource: 'income',
          metadata: {
            scannedCount: activeSales.length,
            fixedCount,
            failedCount,
            skippedCount,
            sample: JSON.parse(JSON.stringify(results.slice(0, 100))) as Prisma.InputJsonValue,
          },
        },
      });

      return {
        success: true,
        scannedCount: activeSales.length,
        fixedCount,
        failedCount,
        skippedCount,
        results,
      };
    }),
};
