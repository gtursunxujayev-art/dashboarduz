import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { asObject } from '../../../lib/object';
import { buildSaleChainMetricsBySaleId, evaluateSaleChainConsistency, getSaleAgreementAmount } from '../../../services/income-chain';
import { adminProcedure } from '../../trpc';

export const incomeDebugIntegrityProcedures = {
  integrityReport: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(5000).default(2000),
      onlyMismatches: z.boolean().default(true),
    }))
    .query(async ({ ctx, input }) => {
      const sales = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          type: 'new_sale',
          lifecycleStatus: 'active',
        },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        take: input.limit,
        select: {
          id: true,
          entryDate: true,
          coursePriceAmount: true,
          debtAmount: true,
          paymentAmount: true,
          remainingDebtAmount: true,
          customer: {
            select: {
              customerNumber: true,
              name: true,
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
      });
      const saleIds = sales.map((sale) => sale.id);
      const chainRows = saleIds.length > 0
        ? await ctx.db.income.findMany({
            where: {
              tenantId: ctx.tenantId,
              lifecycleStatus: 'active',
              OR: [
                { id: { in: saleIds } },
                { relatedDebtIncomeId: { in: saleIds } },
              ],
            },
            select: {
              id: true,
              type: true,
              relatedDebtIncomeId: true,
              paymentAmount: true,
              entryDate: true,
              createdAt: true,
              debtAmount: true,
              remainingDebtAmount: true,
            },
          })
        : [];
      const metricsBySaleId = buildSaleChainMetricsBySaleId({
        sales,
        chainRows,
      });
      const chainRowsBySaleId = new Map<string, typeof chainRows>();

      for (const row of chainRows) {
        const saleId = row.relatedDebtIncomeId || row.id;

        if (!chainRowsBySaleId.has(saleId)) {
          chainRowsBySaleId.set(saleId, []);
        }
        chainRowsBySaleId.get(saleId)!.push(row);
      }
      const rows = sales.map((sale) => {
        const metric = metricsBySaleId.get(sale.id);
        const consistency = evaluateSaleChainConsistency({
          saleId: sale.id,
          agreementAmount: getSaleAgreementAmount(sale),
          chainRows: chainRowsBySaleId.get(sale.id) || [],
        });
        const expectedDebt = metric?.currentDebtAmount ?? 0;
        const expectedPaid = metric?.paidAmount ?? Number(sale.paymentAmount || 0);
        const storedDebt = Number(sale.remainingDebtAmount || 0);
        const mismatch = !consistency.ok;

        return {
          saleIncomeId: sale.id,
          customerNumber: sale.customer?.customerNumber || '',
          customerName: sale.customer?.name || '-',
          courseName: sale.course?.name || '-',
          tariffName: sale.tariff?.name || '-',
          entryDate: sale.entryDate,
          storedDebt,
          expectedDebt,
          expectedPaid,
          agreementAmount: metric?.agreementAmount ?? Number(sale.coursePriceAmount ?? sale.debtAmount ?? sale.paymentAmount ?? 0),
          mismatch,
          mismatchReasons: consistency.issues,
        };
      });
      const mismatchRows = rows.filter((row) => row.mismatch);

      return {
        scannedCount: sales.length,
        mismatchCount: mismatchRows.length,
        okCount: rows.length - mismatchRows.length,
        rows: input.onlyMismatches ? mismatchRows : rows,
      };
    }),
  hideSelected: adminProcedure
    .input(z.object({
      incomeIds: z.array(z.string().uuid()).min(1).max(200),
      hidden: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const incomes = await ctx.db.income.findMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: input.incomeIds },
        },
        select: {
          id: true,
          legacyImportMeta: true,
        },
      });

      const updates = incomes.map((income) => {
        const nextMeta = {
          ...(asObject(income.legacyImportMeta) || {}),
          debugHidden: input.hidden,
        } as Prisma.InputJsonValue;

        return ctx.db.income.update({
          where: { id: income.id },
          data: {
            legacyImportMeta: nextMeta,
          },
        });
      });

      if (updates.length) {
        await ctx.db.$transaction(updates);
      }

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: input.hidden ? 'income_debug_hide' : 'income_debug_unhide',
          resource: 'income',
          metadata: {
            incomeIds: input.incomeIds,
            count: input.incomeIds.length,
          },
        },
      });

      return {
        success: true,
        updatedCount: updates.length,
      };
    }),
};
