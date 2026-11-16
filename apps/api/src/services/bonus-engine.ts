import { type DbClient, type Prisma, systemPrisma, type TenantPrismaClient } from '@dashboarduz/db';
import { TASHKENT_OFFSET_MS } from '@dashboarduz/shared';

import { asObjectOrEmpty } from '../lib/object';
import type { SalaryCategory } from '../trpc/routers/dashboard/helpers';

import { calculateBonusMonth } from './bonus/calculation';
import { amount, getTashkentMonthEnd, getTashkentMonthKey, getTashkentMonthStart, normalizeBonusPolicy } from './bonus/policy';
import { type BonusCalculationItem, type BonusMonthCalculation, ELIGIBLE_ROLES } from './bonus/types';

export { type CourseIncomeTier, type CourseBonusOverride, type BonusPolicy, type BonusCalculationItem, type BonusCalculationLine, type BonusMonthCalculation, type BonusIncomeRow } from './bonus/types';
export { getTashkentMonthStart, getTashkentMonthEnd, getTashkentMonthKey, normalizeCourseOverride, buildLegacyBonusPolicy, normalizeBonusPolicy, resolveCourseIncomePercent, resolveEffectiveBonusPolicy } from './bonus/policy';
export { resolveFullyPaidClosure, type SaleClosure, loadSaleClosures } from './bonus/closures';
export { calculateBonusMonth } from './bonus/calculation';

export const SYSTEM_FINALIZER_USER_ID = 'system:auto-finalize';

async function getBonusMonth(params: { tenantId: string; month: Date; preferSnapshot?: boolean; db?: DbClient }): Promise<BonusMonthCalculation> {
  const db = params.db ?? systemPrisma;
  const month = getTashkentMonthStart(params.month);

  if (params.preferSnapshot !== false) {
    const snapshot = await db.bonusMonthSnapshot.findUnique({
      where: { tenantId_month: { tenantId: params.tenantId, month } },
      include: { lines: true, items: true },
    });

    if (snapshot) {
      return {
        month,
        policy: normalizeBonusPolicy(snapshot.policy),
        policyVersionId: snapshot.policyVersionId,
        sourceDigest: snapshot.sourceDigest,
        totalBonusAmount: snapshot.totalBonusAmount,
        lines: snapshot.lines.map((line) => ({
          groupKey: line.groupKey,
          agentUserId: line.agentUserId,
          courseId: line.courseId,
          category: line.category as SalaryCategory,
          calculationMode: line.calculationMode as BonusCalculationItem['calculationMode'],
          qualifyingAmount: line.qualifyingAmount,
          appliedPercent: line.appliedPercent,
          bonusAmount: line.bonusAmount,
          sourceCount: line.sourceCount,
        })),
        items: snapshot.items.map((item) => {
          const metadata = asObjectOrEmpty(item.metadata);

          return {
            sourceKey: item.sourceKey,
            sourceIncomeId: item.sourceIncomeId,
            sourceSaleId: item.sourceSaleId,
            agentUserId: item.agentUserId,
            courseId: item.courseId,
            courseName: typeof metadata.courseName === 'string' ? metadata.courseName : null,
            category: item.category as SalaryCategory,
            calculationMode: item.calculationMode as BonusCalculationItem['calculationMode'],
            eventDate: item.eventDate,
            baseAmount: item.baseAmount,
            appliedPercent: item.appliedPercent,
            bonusAmount: item.bonusAmount,
            agreementAmount: amount(metadata.agreementAmount),
            closingIncomeId: typeof metadata.closingIncomeId === 'string' ? metadata.closingIncomeId : item.sourceIncomeId,
            closedCount: amount(metadata.closedCount),
            usedFallback: metadata.usedFallback === true,
          };
        }),
        finalized: true,
        finalizedAt: snapshot.finalizedAt,
      };
    }
  }

  return calculateBonusMonth({ tenantId: params.tenantId, month, db });
}

export async function calculateBonusRange(params: {
  tenantId: string;
  rangeStart: Date;
  rangeEnd: Date;
  db?: DbClient;
}): Promise<{ items: BonusCalculationItem[]; months: BonusMonthCalculation[]; totalBonusAmount: number }> {
  const db = params.db ?? systemPrisma;
  const months: BonusMonthCalculation[] = [];
  let cursor = getTashkentMonthStart(params.rangeStart);
  const finalMonth = getTashkentMonthStart(params.rangeEnd);

  while (cursor <= finalMonth) {
    months.push(await getBonusMonth({ tenantId: params.tenantId, month: cursor, db }));
    const shifted = new Date(cursor.getTime() + TASHKENT_OFFSET_MS);

    cursor = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1) - TASHKENT_OFFSET_MS);
  }
  const items = months.flatMap((month) => month.items).filter((item) => (
    item.eventDate >= params.rangeStart && item.eventDate <= params.rangeEnd
  ));

  return {
    items,
    months,
    totalBonusAmount: items.reduce((sum, item) => sum + item.bonusAmount, 0),
  };
}

/** `userId` is the admin who pressed finalize, or SYSTEM_FINALIZER_USER_ID for the automatic month-end freeze. */
export async function finalizeBonusMonth(params: { tenantId: string; month: Date; userId: string; db?: TenantPrismaClient }): Promise<BonusMonthCalculation> {
  const db = params.db ?? systemPrisma;
  const month = getTashkentMonthStart(params.month);

  if (getTashkentMonthEnd(month) >= new Date()) throw new Error('Only completed months can be finalized.');
  const existing = await db.bonusMonthSnapshot.findUnique({ where: { tenantId_month: { tenantId: params.tenantId, month } } });

  if (existing) return getBonusMonth({ tenantId: params.tenantId, month, db });
  const calculation = await calculateBonusMonth({ tenantId: params.tenantId, month, db });

  await db.$transaction(async (tx) => {
    const snapshot = await tx.bonusMonthSnapshot.create({
      data: {
        tenantId: params.tenantId,
        month,
        policyVersionId: calculation.policyVersionId,
        policy: calculation.policy as Prisma.InputJsonValue,
        sourceDigest: calculation.sourceDigest,
        totalBonusAmount: calculation.totalBonusAmount,
        finalizedByUserId: params.userId,
      },
    });

    if (calculation.lines.length) {
      await tx.bonusSnapshotLine.createMany({ data: calculation.lines.map((line) => ({ ...line, tenantId: params.tenantId, snapshotId: snapshot.id })) });
    }
    if (calculation.items.length) {
      await tx.bonusSnapshotItem.createMany({
        data: calculation.items.map((item) => ({
          tenantId: params.tenantId,
          snapshotId: snapshot.id,
          sourceKey: item.sourceKey,
          sourceIncomeId: item.sourceIncomeId,
          sourceSaleId: item.sourceSaleId,
          agentUserId: item.agentUserId,
          courseId: item.courseId,
          category: item.category,
          calculationMode: item.calculationMode,
          eventDate: item.eventDate,
          baseAmount: item.baseAmount,
          appliedPercent: item.appliedPercent,
          bonusAmount: item.bonusAmount,
          metadata: {
            courseName: item.courseName,
            agreementAmount: item.agreementAmount,
            closingIncomeId: item.closingIncomeId,
            closedCount: item.closedCount,
            usedFallback: item.usedFallback,
          },
        })),
      });
    }
  });

  return getBonusMonth({ tenantId: params.tenantId, month, db });
}

export async function reconcileBonusMonth(params: { tenantId: string; month: Date; actorUserId?: string | null; db?: DbClient }): Promise<number> {
  const db = params.db ?? systemPrisma;
  const month = getTashkentMonthStart(params.month);
  const snapshot = await db.bonusMonthSnapshot.findUnique({
    where: { tenantId_month: { tenantId: params.tenantId, month } },
    include: { lines: true, adjustments: true },
  });

  if (!snapshot) return 0;
  const current = await calculateBonusMonth({
    tenantId: params.tenantId,
    month,
    policy: normalizeBonusPolicy(snapshot.policy),
    policyVersionId: snapshot.policyVersionId,
    db,
  });

  if (current.sourceDigest === snapshot.sourceDigest || current.legacySourceDigest === snapshot.sourceDigest) {
    // Data is back to what was finalized, so any pending correction is stale.
    await db.bonusAdjustment.deleteMany({ where: { snapshotId: snapshot.id, status: 'pending' } });

    return 0;
  }
  const eligibleAgentIds = new Set((await db.user.findMany({
    where: { tenantId: params.tenantId, isActive: true, roles: { hasSome: [...ELIGIBLE_ROLES] } },
    select: { id: true },
  })).map((user) => user.id));
  const originalByKey = new Map(snapshot.lines.map((line) => [line.groupKey, line]));
  const currentByKey = new Map(current.lines.map((line) => [line.groupKey, line]));
  const keys = new Set([...originalByKey.keys(), ...currentByKey.keys()]);
  let pendingCount = 0;

  for (const groupKey of keys) {
    const original = originalByKey.get(groupKey);
    const next = currentByKey.get(groupKey);
    const approved = snapshot.adjustments
      .filter((adjustment) => adjustment.groupKey === groupKey && adjustment.status === 'approved')
      .reduce((sum, adjustment) => sum + adjustment.deltaAmount, 0);
    const pending = snapshot.adjustments.find((adjustment) => adjustment.groupKey === groupKey && adjustment.status === 'pending');
    // An agent who was deactivated or lost the agent role after finalization drops out of the live calculation;
    // that is not a reason to claw back bonus they were already paid.
    const droppedOnlyByEligibility = !next && original && !eligibleAgentIds.has(original.agentUserId);
    const delta = droppedOnlyByEligibility ? 0 : (next?.bonusAmount || 0) - (original?.bonusAmount || 0) - approved;

    if (delta === 0) {
      if (pending) await db.bonusAdjustment.delete({ where: { id: pending.id } });
      continue;
    }
    const rejectedSameDigest = snapshot.adjustments.some((adjustment) => (
      adjustment.groupKey === groupKey && adjustment.status === 'rejected' && adjustment.sourceDigest === current.sourceDigest
    ));

    if (rejectedSameDigest) continue;
    const data = {
      deltaAmount: delta,
      outstandingAmount: delta,
      sourceDigest: current.sourceDigest,
      agentUserId: next?.agentUserId || original!.agentUserId,
      courseId: next?.courseId ?? original?.courseId ?? null,
      category: next?.category || original!.category,
    };
    const adjustment = pending
      ? await db.bonusAdjustment.update({ where: { id: pending.id }, data })
      : await db.bonusAdjustment.create({ data: { ...data, tenantId: params.tenantId, snapshotId: snapshot.id, groupKey } });

    await db.bonusAdjustmentAudit.create({
      data: {
        tenantId: params.tenantId,
        adjustmentId: adjustment.id,
        action: pending ? 'recalculated' : 'created',
        actorUserId: params.actorUserId || null,
        metadata: { previousMonth: getTashkentMonthKey(month), sourceDigest: current.sourceDigest },
      },
    });
    pendingCount += 1;
  }

  return pendingCount;
}

export async function reconcileFinalizedBonusMonths(params: { tenantId: string; actorUserId?: string | null; db?: DbClient }): Promise<number> {
  const db = params.db ?? systemPrisma;
  const snapshots = await db.bonusMonthSnapshot.findMany({
    where: { tenantId: params.tenantId },
    select: { month: true },
    orderBy: { month: 'asc' },
  });
  let total = 0;

  for (const snapshot of snapshots) {
    total += await reconcileBonusMonth({ tenantId: params.tenantId, month: snapshot.month, actorUserId: params.actorUserId, db });
  }

  return total;
}

export async function reviewBonusAdjustment(params: {
  tenantId: string;
  adjustmentId: string;
  userId: string;
  action: 'approve' | 'reject';
  note?: string;
  db?: TenantPrismaClient;
}) {
  const db = params.db ?? systemPrisma;
  const adjustment = await db.bonusAdjustment.findFirst({ where: { id: params.adjustmentId, tenantId: params.tenantId, status: 'pending' } });

  if (!adjustment) throw new Error('Pending bonus adjustment was not found.');
  if (params.action === 'reject' && !params.note?.trim()) throw new Error('A rejection reason is required.');
  const payoutMonth = params.action === 'approve' ? getTashkentMonthStart(new Date()) : null;

  return db.$transaction(async (tx) => {
    const updated = await tx.bonusAdjustment.update({
      where: { id: adjustment.id },
      data: {
        status: params.action === 'approve' ? 'approved' : 'rejected',
        payoutMonth,
        reviewedByUserId: params.userId,
        reviewNote: params.note?.trim() || null,
        reviewedAt: new Date(),
      },
    });

    await tx.bonusAdjustmentAudit.create({
      data: {
        tenantId: params.tenantId,
        adjustmentId: adjustment.id,
        action: params.action === 'approve' ? 'approved' : 'rejected',
        actorUserId: params.userId,
        metadata: { note: params.note?.trim() || null, payoutMonth: payoutMonth?.toISOString() || null },
      },
    });

    return updated;
  });
}

export async function getApprovedAdjustmentsForMonth(tenantId: string, month: Date, db: DbClient = systemPrisma) {
  const monthStart = getTashkentMonthStart(month);
  const monthEnd = getTashkentMonthEnd(month);

  return db.bonusAdjustment.findMany({
    where: {
      tenantId,
      status: 'approved',
      outstandingAmount: { not: 0 },
      payoutMonth: { lte: monthEnd },
    },
    orderBy: [{ payoutMonth: 'asc' }, { createdAt: 'asc' }],
  });
}
