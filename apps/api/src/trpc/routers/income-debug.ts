import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@dashboarduz/db';
import { adminProcedure, router } from '../trpc';

const incomeDebugInput = z.object({
  mode: z.enum(['suspicious', 'future', 'unresolved', 'relink', 'imported', 'all']).default('suspicious'),
  query: z.string().trim().optional(),
  limit: z.number().int().positive().max(500).default(200),
}).optional();

function normalizeDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function resolveUserLabel(user: { name: string | null; username: string | null; id: string } | null | undefined): string {
  if (!user) return "qo'lda";
  return user.name || user.username || user.id;
}

export const incomeDebugRouter = router({
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
        ? limit
        : Math.min(limit * 3, 500);

      const incomes = await prisma.income.findMany({
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
      });

      const incomeIds = incomes.map((income) => income.id);
      const createdAtValues = incomes.map((income) => income.createdAt.getTime());
      const minCreatedAt = createdAtValues.length
        ? new Date(Math.min(...createdAtValues) - 30 * 60 * 1000)
        : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const maxCreatedAt = createdAtValues.length
        ? new Date(Math.max(...createdAtValues) + 30 * 60 * 1000)
        : now;

      const [incomeCreateLogs, relinkLogs] = await Promise.all([
        incomeIds.length
          ? prisma.auditLog.findMany({
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
        prisma.auditLog.findMany({
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

      const createLogByIncomeId = new Map<string, (typeof incomeCreateLogs)[number]>();
      for (const log of incomeCreateLogs) {
        if (log.resourceId && !createLogByIncomeId.has(log.resourceId)) {
          createLogByIncomeId.set(log.resourceId, log);
        }
      }

      const rows = incomes.map((income) => {
        const createLog = createLogByIncomeId.get(income.id);
        const isImported = Boolean(income.legacyImportSource);
        const isFutureDated = income.entryDate.getTime() > now.getTime();

        let matchedRelinkLog: (typeof relinkLogs)[number] | null = null;
        if (!isImported && !createLog && income.type === 'repayment' && income.relatedDebtIncomeId) {
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
        switch (mode) {
          case 'future':
            return row.status === 'future';
          case 'unresolved':
            return row.status === 'unresolved';
          case 'relink':
            return row.status === 'possible_relink';
          case 'imported':
            return row.status === 'imported';
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
          inspectedCount: rows.length,
          shownCount: filteredRows.length,
          futureCount: rows.filter((row) => row.status === 'future').length,
          importedCount: rows.filter((row) => row.status === 'imported').length,
          unresolvedCount: rows.filter((row) => row.status === 'unresolved').length,
          possibleRelinkCount: rows.filter((row) => row.status === 'possible_relink').length,
        },
      };
    }),
});
