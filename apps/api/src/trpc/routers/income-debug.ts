import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { prisma } from '@dashboarduz/db';
import { adminProcedure, router } from '../trpc';

const incomeDebugInput = z.object({
  mode: z.enum(['suspicious', 'future', 'unresolved', 'relink', 'imported', 'hidden', 'all']).default('suspicious'),
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

type SnapshotMapping = {
  paymentDate: number | null;
  customerPhone: number | null;
  customerName: number | null;
  telegramUsername: number | null;
  managerLabel: number | null;
  courseName: number | null;
  tariffName: number | null;
  subTariffName: number | null;
  paymentType: number | null;
  agreementAmount: number | null;
  paymentAmount: number | null;
  remainingDebtAmount: number | null;
  deadline: number | null;
};

type FinanceSnapshotRow = {
  rowIndex: number;
  paymentDate: string | null;
  customerPhone: string;
  customerName: string;
  telegramUsername: string;
  managerLabel: string;
  courseName: string;
  tariffName: string;
  subTariffName: string;
  paymentType: string;
  agreementAmount: number;
  paymentAmount: number;
  remainingDebtAmount: number;
  deadline: string | null;
  normalizedPhone: string;
  normalizedName: string;
};

type ActiveSnapshot = {
  version: 1;
  workbookName: string;
  sheetName: string;
  activatedAt: string;
  mapping: SnapshotMapping;
  rowCount: number;
  rows: FinanceSnapshotRow[];
};

function asSettingsObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[’']/g, "'");
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[’']/g, "'")
    .replace(/-/g, ' ');
}

function parseSnapshotDate(value: string | null): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : raw.slice(0, 10);
  const parsed = new Date(`${iso}T12:00:00+05:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function getActiveSnapshot(tenantId: string): Promise<ActiveSnapshot | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  if (!tenant) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Ish maydoni topilmadi.' });
  }
  const settings = asSettingsObject(tenant.settings);
  const incomeProblems = asSettingsObject(settings.incomeProblems);
  const activeSnapshot = incomeProblems.activeSnapshot;
  if (!activeSnapshot || typeof activeSnapshot !== 'object' || Array.isArray(activeSnapshot)) {
    return null;
  }
  return activeSnapshot as ActiveSnapshot;
}

async function recomputeSaleChainState(tx: Prisma.TransactionClient, params: {
  tenantId: string;
  saleId: string;
}): Promise<{ canonicalSaleId: string; reorderedIncomeIds: string[]; didReorder: boolean }> {
  const sourceSale = await tx.income.findFirst({
    where: {
      id: params.saleId,
      tenantId: params.tenantId,
      type: 'new_sale',
      lifecycleStatus: 'active',
    },
    select: {
      id: true,
      customerId: true,
      managerUserId: true,
      courseId: true,
      tariffId: true,
      entryDate: true,
      createdAt: true,
      deadline: true,
      coursePriceAmount: true,
      debtAmount: true,
      paymentAmount: true,
      legacyImportMeta: true,
    },
  });

  if (!sourceSale) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Aktiv yangi sotuv topilmadi.',
    });
  }

  const repayments = await tx.income.findMany({
    where: {
      tenantId: params.tenantId,
      type: 'repayment',
      lifecycleStatus: 'active',
      relatedDebtIncomeId: sourceSale.id,
    },
    select: {
      id: true,
      entryDate: true,
      createdAt: true,
      deadline: true,
      paymentAmount: true,
    },
    orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
  });

  const chain = [
    {
      id: sourceSale.id,
      type: 'new_sale' as const,
      entryDate: sourceSale.entryDate,
      createdAt: sourceSale.createdAt,
      deadline: sourceSale.deadline,
      paymentAmount: Number(sourceSale.paymentAmount || 0),
    },
    ...repayments.map((repayment) => ({
      id: repayment.id,
      type: 'repayment' as const,
      entryDate: repayment.entryDate,
      createdAt: repayment.createdAt,
      deadline: repayment.deadline,
      paymentAmount: Number(repayment.paymentAmount || 0),
    })),
  ].sort((left, right) => {
    const byDate = left.entryDate.getTime() - right.entryDate.getTime();
    if (byDate !== 0) {
      return byDate;
    }
    return left.createdAt.getTime() - right.createdAt.getTime();
  });

  const canonicalRow = chain[0]!;
  const canonicalSaleId = canonicalRow.id;
  const agreementAmount = Number(sourceSale.coursePriceAmount ?? sourceSale.debtAmount ?? 0);
  let rollingDebt = Math.max(agreementAmount - canonicalRow.paymentAmount, 0);

  await tx.income.update({
    where: { id: canonicalSaleId },
    data: {
      type: 'new_sale',
      relatedDebtIncomeId: null,
      managerUserId: sourceSale.managerUserId,
      courseId: sourceSale.courseId,
      tariffId: sourceSale.tariffId,
      coursePriceAmount: agreementAmount,
      debtAmount: agreementAmount,
      remainingDebtAmount: rollingDebt,
      deadline: rollingDebt > 0 ? sourceSale.deadline : null,
      legacyImportMeta: sourceSale.legacyImportMeta ?? Prisma.JsonNull,
    },
  });

  for (const repayment of chain.slice(1)) {
    const debtAmount = rollingDebt;
    rollingDebt = Math.max(debtAmount - repayment.paymentAmount, 0);

    await tx.income.update({
      where: { id: repayment.id },
      data: {
        type: 'repayment',
        relatedDebtIncomeId: canonicalSaleId,
        courseId: sourceSale.courseId,
        tariffId: sourceSale.tariffId,
        coursePriceAmount: null,
        debtAmount,
        remainingDebtAmount: rollingDebt,
        legacyImportMeta: Prisma.JsonNull,
      },
    });
  }

  const latestActiveSale = await tx.income.findFirst({
    where: {
      tenantId: params.tenantId,
      customerId: sourceSale.customerId,
      type: 'new_sale',
      lifecycleStatus: 'active',
    },
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      courseId: true,
      tariffId: true,
    },
  });

  await tx.customer.update({
    where: { id: sourceSale.customerId },
    data: {
      profileCourseId: latestActiveSale?.courseId ?? null,
      profileTariffId: latestActiveSale?.tariffId ?? null,
    },
  });

  return {
    canonicalSaleId,
    reorderedIncomeIds: chain.map((row) => row.id),
    didReorder: canonicalSaleId !== sourceSale.id,
  };
}

function findSnapshotMatch(params: {
  income: {
    id: string;
    type: string;
    paymentAmount: number;
    remainingDebtAmount: number;
    customerNumber: string;
    customerName: string;
    managerName: string;
    courseName: string;
    tariffName: string;
  };
  snapshotRows: FinanceSnapshotRow[];
  usedRowKeys: Set<string>;
}) {
  const normalizedPhone = normalizeDigits(params.income.customerNumber);
  const normalizedNameValue = normalizeName(params.income.customerName);
  const managerNeedle = normalizeText(params.income.managerName);
  const courseNeedle = normalizeText(params.income.courseName);
  const tariffNeedle = normalizeText(params.income.tariffName);
  const amount = Math.round(params.income.paymentAmount || 0);
  const debt = Math.round(params.income.remainingDebtAmount || 0);

  const scored = params.snapshotRows
    .filter((row) => {
      const rowKey = `${row.normalizedPhone || row.normalizedName}:${row.rowIndex}`;
      if (params.usedRowKeys.has(rowKey)) {
        return false;
      }
      const sameIdentity = normalizedPhone
        ? row.normalizedPhone === normalizedPhone
        : row.normalizedName === normalizedNameValue;
      return sameIdentity && Math.round(row.paymentAmount || 0) === amount;
    })
    .map((row) => {
      let score = 0;
      if (normalizedPhone && row.normalizedPhone === normalizedPhone) score += 100;
      if (normalizedNameValue && row.normalizedName === normalizedNameValue) score += 20;
      if (managerNeedle && normalizeText(row.managerLabel) === managerNeedle) score += 15;
      const financeCourseHaystack = normalizeText(`${row.courseName} ${row.tariffName} ${row.subTariffName}`);
      if (courseNeedle && financeCourseHaystack.includes(courseNeedle)) score += 10;
      if (tariffNeedle && financeCourseHaystack.includes(tariffNeedle)) score += 10;
      if (Math.round(row.remainingDebtAmount || 0) === debt) score += 5;
      return {
        row,
        score,
      };
    })
    .sort((left, right) => right.score - left.score || left.row.rowIndex - right.row.rowIndex);

  if (scored.length === 0) {
    return { status: 'no_match' as const };
  }

  const best = scored[0]!;
  const second = scored[1];
  if (second && second.score === best.score) {
    return {
      status: 'ambiguous' as const,
      candidateCount: scored.length,
      topScore: best.score,
    };
  }

  return {
    status: 'matched' as const,
    row: best.row,
    score: best.score,
  };
}

function extractRelinkedRepaymentIds(metadata: unknown): string[] {
  const obj = asObject(metadata);
  const raw = obj?.relinkedRepaymentIds;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((value) => String(value || '').trim())
    .filter((value) => /^[0-9a-f-]{36}$/i.test(value));
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
        ? Math.max(limit, 1000)
        : Math.min(Math.max(limit * 10, 2000), 5000);

      const [totalMatchingCount, incomes] = await Promise.all([
        prisma.income.count({ where }),
        prisma.income.findMany({
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
        ? await prisma.income.count({
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

  repairDatesFromSnapshot: adminProcedure
    .input(z.object({
      incomeIds: z.array(z.string().uuid()).min(1).max(300),
    }))
    .mutation(async ({ ctx, input }) => {
      const activeSnapshot = await getActiveSnapshot(ctx.tenantId);
      if (!activeSnapshot || !Array.isArray(activeSnapshot.rows) || activeSnapshot.rows.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Faol moliya snapshot topilmadi. Avval Tushum muammolari sahifasida snapshotni faollashtiring.',
        });
      }

      const incomes = await prisma.income.findMany({
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
          const transactionResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

      await prisma.auditLog.create({
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

  hideSelected: adminProcedure
    .input(z.object({
      incomeIds: z.array(z.string().uuid()).min(1).max(200),
      hidden: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const incomes = await prisma.income.findMany({
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

        return prisma.income.update({
          where: { id: income.id },
          data: {
            legacyImportMeta: nextMeta,
          },
        });
      });

      if (updates.length) {
        await prisma.$transaction(updates);
      }

      await prisma.auditLog.create({
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
});
