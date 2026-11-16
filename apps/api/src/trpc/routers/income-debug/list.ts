import { normalizeDigits } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { asObject } from '../../../lib/object';
import { extractRelinkedRepaymentIds, resolveUserLabel } from '../../../services/income-debug/labels';
import { adminProcedure } from '../../trpc';

const incomeDebugInput = z.object({
  mode: z.enum(['suspicious', 'future', 'unresolved', 'relink', 'imported', 'hidden', 'all']).default('suspicious'),
  query: z.string().trim().optional(),
  limit: z.number().int().positive().max(500).default(200),
}).optional();

export const incomeDebugListProcedures = {
  list: adminProcedure
    .input(incomeDebugInput)
    .query(async ({ ctx, input }) => {
      const mode = input?.mode ?? 'suspicious';
      const query = input?.query?.trim() ?? '';
      const limit = input?.limit ?? 200;
      const now = new Date();

      const where: Prisma.IncomeWhereInput = {
        tenantId: ctx.tenantId,
        ...(query
          ? {
              OR: [
                {
                  customer: {
                    customerNumber: {
                      contains: normalizeDigits(query),
                    },
                  },
                },
                {
                  customer: {
                    name: {
                      contains: query,
                      mode: 'insensitive',
                    },
                  },
                },
              ],
            }
          : {}),
        ...(mode === 'future'
          ? {
              entryDate: { gt: now },
            }
          : mode === 'imported'
            ? {
                legacyImportSource: { not: null },
              }
            : {}),
      };

      const fetchTake = mode === 'future' || mode === 'imported'
        ? Math.max(limit, 1000)
        : Math.min(Math.max(limit * 10, 2000), 5000);

      const [totalMatchingCount, incomes] = await Promise.all([
        ctx.db.income.count({ where }),
        ctx.db.income.findMany({
          where,
          take: fetchTake,
          orderBy: [{ createdAt: 'desc' }, { entryDate: 'desc' }],
          select: {
            id: true,
            type: true,
            entryDate: true,
            createdAt: true,
            paymentAmount: true,
            remainingDebtAmount: true,
            coursePriceAmount: true,
            debtAmount: true,
            lifecycleStatus: true,
            relatedDebtIncomeId: true,
            legacyImportSource: true,
            historicalImportSessionId: true,
            legacyImportMeta: true,
            customer: {
              select: {
                customerNumber: true,
                name: true,
              },
            },
            manager: {
              select: {
                name: true,
                username: true,
                id: true,
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
        }),
      ]);

      const incomeIds = incomes.map((income) => income.id);
      const createdAtValues = incomes.map((income) => income.createdAt.getTime());
      const minCreatedAt = createdAtValues.length
        ? new Date(Math.min(...createdAtValues) - 30 * 60 * 1000)
        : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const maxCreatedAt = createdAtValues.length
        ? new Date(Math.max(...createdAtValues) + 30 * 60 * 1000)
        : now;

      const [incomeCreateLogs, relinkLogs, exactRelinkLogs] = await Promise.all([
        incomeIds.length
          ? ctx.db.auditLog.findMany({
              where: {
                tenantId: ctx.tenantId,
                action: 'income_create',
                resource: 'income',
                resourceId: { in: incomeIds },
              },
              orderBy: { createdAt: 'desc' },
              select: {
                resourceId: true,
                createdAt: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    username: true,
                  },
                },
              },
            })
          : Promise.resolve([]),
        ctx.db.auditLog.findMany({
          where: {
            tenantId: ctx.tenantId,
            action: 'customer_course_relink',
            resource: 'income',
          },
          orderBy: { createdAt: 'desc' },
          select: {
            createdAt: true,
            metadata: true,
            user: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
          },
        }),
        ctx.db.auditLog.findMany({
          where: {
            tenantId: ctx.tenantId,
            action: 'customer_course_relink',
            resource: 'income',
            createdAt: {
              gte: minCreatedAt,
              lte: maxCreatedAt,
            },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            createdAt: true,
            metadata: true,
            user: {
              select: {
                id: true,
                name: true,
                username: true,
              },
            },
          },
        }),
      ]);

      const exactRelinkLogByIncomeId = new Map<string, (typeof exactRelinkLogs)[number]>();

      for (const log of exactRelinkLogs) {
        for (const repaymentId of extractRelinkedRepaymentIds(log.metadata)) {
          if (!exactRelinkLogByIncomeId.has(repaymentId)) {
            exactRelinkLogByIncomeId.set(repaymentId, log);
          }
        }
      }

      const exactRelinkIncomeIds = Array.from(exactRelinkLogByIncomeId.keys());
      const exactPossibleRelinkCount = exactRelinkIncomeIds.length > 0
        ? await ctx.db.income.count({
            where: {
              ...where,
              id: { in: exactRelinkIncomeIds },
            },
          })
        : 0;

      const createLogByIncomeId = new Map<string, (typeof incomeCreateLogs)[number]>();

      for (const log of incomeCreateLogs) {
        if (log.resourceId && !createLogByIncomeId.has(log.resourceId)) {
          createLogByIncomeId.set(log.resourceId, log);
        }
      }

      const rows = incomes.map((income) => {
        const legacyMeta = asObject(income.legacyImportMeta);
        const isDebugHidden = Boolean(legacyMeta?.debugHidden);
        const createLog = createLogByIncomeId.get(income.id);
        const isImported = Boolean(income.legacyImportSource);
        const isFutureDated = income.entryDate.getTime() > now.getTime();

        let matchedRelinkLog: (typeof relinkLogs)[number] | (typeof exactRelinkLogs)[number] | null = exactRelinkLogByIncomeId.get(income.id) || null;

        if (!matchedRelinkLog && !isImported && !createLog && income.type === 'repayment' && income.relatedDebtIncomeId) {
          matchedRelinkLog = relinkLogs.find((log) => {
            const metadata = asObject(log.metadata);
            const targetSaleIncomeId = String(metadata?.targetSaleIncomeId || '').trim();
            const transferAmountRaw = Number(metadata?.transferAmount || 0);
            const createdAtDiffMs = Math.abs(log.createdAt.getTime() - income.createdAt.getTime());

            return (
              targetSaleIncomeId === income.relatedDebtIncomeId
              && createdAtDiffMs <= 30 * 60 * 1000
              && Math.round(transferAmountRaw) === Math.round(income.paymentAmount)
            );
          }) || null;
        }

        const sourceType = isImported
          ? 'imported'
          : matchedRelinkLog
            ? 'possible_relink'
            : createLog
              ? 'user'
              : 'unresolved';

        const status = isFutureDated
          ? 'future'
          : sourceType === 'possible_relink'
            ? 'possible_relink'
            : sourceType === 'imported'
              ? 'imported'
              : sourceType === 'unresolved'
                ? 'unresolved'
                : 'normal';

        const createdByLabel = isImported
          ? 'import'
          : createLog
            ? resolveUserLabel(createLog.user)
            : matchedRelinkLog
              ? `relink:${resolveUserLabel(matchedRelinkLog.user)}`
              : "qo'lda";

        const reason = isFutureDated
          ? "Kelajak sanali tushum"
          : sourceType === 'possible_relink'
            ? "Kurs relink jarayonida yaratilgan bo'lishi mumkin"
            : sourceType === 'imported'
              ? "Tarixiy import orqali yaratilgan"
              : sourceType === 'unresolved'
                ? "income_create auditi topilmadi"
                : "Oddiy audit topildi";

        return {
          id: income.id,
          status,
          createdByLabel,
          reason,
          sourceType,
          isFutureDated,
          isDebugHidden,
          legacyImportSource: income.legacyImportSource,
          historicalImportSessionId: income.historicalImportSessionId,
          type: income.type,
          lifecycleStatus: income.lifecycleStatus,
          entryDate: income.entryDate,
          createdAt: income.createdAt,
          paymentAmount: income.paymentAmount,
          remainingDebtAmount: income.remainingDebtAmount,
          agreementAmount: income.coursePriceAmount ?? income.debtAmount ?? 0,
          relatedDebtIncomeId: income.relatedDebtIncomeId,
          customerNumber: income.customer?.customerNumber || '',
          customerName: income.customer?.name || '-',
          managerName: income.manager?.name || income.manager?.username || income.manager?.id || '-',
          courseName: income.course?.name || '-',
          tariffName: income.tariff?.name || '-',
        };
      });

      const filteredRows = rows.filter((row) => {
        if (mode !== 'hidden' && row.isDebugHidden) {
          return false;
        }
        switch (mode) {
          case 'future':
            return row.status === 'future';
          case 'unresolved':
            return row.status === 'unresolved';
          case 'relink':
            return row.status === 'possible_relink';
          case 'imported':
            return row.status === 'imported';
          case 'hidden':
            return row.isDebugHidden;
          case 'suspicious':
            return row.status !== 'normal';
          case 'all':
          default:
            return true;
        }
      }).slice(0, limit);

      return {
        rows: filteredRows,
        summary: {
          inspectedCount: totalMatchingCount,
          sampledCount: rows.length,
          shownCount: filteredRows.length,
          futureCount: rows.filter((row) => row.status === 'future').length,
          importedCount: rows.filter((row) => row.status === 'imported').length,
          unresolvedCount: rows.filter((row) => row.status === 'unresolved').length,
          possibleRelinkCount: exactPossibleRelinkCount,
          hiddenCount: rows.filter((row) => row.isDebugHidden).length,
        },
      };
    }),
};
