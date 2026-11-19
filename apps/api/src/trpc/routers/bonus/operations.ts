import { hasPrivilegedRole, reviewActionSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveCallerDataScope } from '../../../lib/access';
import { isOnlineScopedAdmin, limitBonusResultToUsers } from '../../../services/bonus-config/access';
import { calculateBonusMonth, finalizeBonusMonth, getTashkentMonthKey, getTashkentMonthStart, reconcileBonusMonth, reconcileFinalizedBonusMonths, reviewBonusAdjustment } from '../../../services/bonus-engine';
import { isUserIdInScope } from '../../../services/dashboard/data-scope';
import { adminProcedure, protectedProcedure, scopedAdminProcedure } from '../../trpc';

import { bonusMonthInput } from './schemas';

export const bonusOperationProcedures = {
  getBonusOperations: protectedProcedure.query(async ({ ctx }) => {
    if (!hasPrivilegedRole(ctx.user.roles)) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    if (ctx.user.roles.includes('Admin')) {
      await reconcileFinalizedBonusMonths({ tenantId: ctx.tenantId, actorUserId: ctx.user.userId, db: ctx.db });
    }
    // Team leaders and OnlineAdmin: their group's adjustments, and month totals of their group only.
    const { userIds } = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
    const [snapshots, adjustments] = await Promise.all([
      ctx.db.bonusMonthSnapshot.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { month: 'desc' },
        take: 24,
        select: { id: true, month: true, totalBonusAmount: true, sourceDigest: true, finalizedAt: true },
      }),
      ctx.db.bonusAdjustment.findMany({
        where: { tenantId: ctx.tenantId, ...(userIds ? { agentUserId: { in: userIds } } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { audits: { orderBy: { createdAt: 'desc' }, take: 5 }, snapshot: { select: { month: true } } },
      }),
    ]);

    const scopedTotals = userIds && snapshots.length
      ? new Map((await ctx.db.bonusSnapshotLine.groupBy({
          by: ['snapshotId'],
          where: { tenantId: ctx.tenantId, snapshotId: { in: snapshots.map((snapshot) => snapshot.id) }, agentUserId: { in: userIds } },
          _sum: { bonusAmount: true },
        })).map((group) => [group.snapshotId, group._sum.bonusAmount ?? 0]))
      : null;

    return {
      snapshots: snapshots.map((snapshot) => ({
        ...snapshot,
        ...(scopedTotals ? { totalBonusAmount: scopedTotals.get(snapshot.id) ?? 0 } : {}),
        month: getTashkentMonthKey(snapshot.month),
      })),
      adjustments: adjustments.map((adjustment) => ({
        ...adjustment,
        sourceMonth: getTashkentMonthKey(adjustment.snapshot.month),
        payoutMonth: adjustment.payoutMonth ? getTashkentMonthKey(adjustment.payoutMonth) : null,
      })),
    };
  }),
  // OnlineAdmin previews the online group's lines only.
  previewBonusMonth: scopedAdminProcedure.input(bonusMonthInput).mutation(async ({ ctx, input }) => {
    const full = await calculateBonusMonth({ tenantId: ctx.tenantId, month: getTashkentMonthStart(input.month), db: ctx.db });
    const result = isOnlineScopedAdmin(ctx.user.roles)
      ? limitBonusResultToUsers(full, (await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db)).userIds)
      : full;

    return { ...result, month: getTashkentMonthKey(result.month) };
  }),
  // Finalize and reconcile cover the whole company: Admin only.
  finalizeBonusMonth: adminProcedure.input(bonusMonthInput).mutation(async ({ ctx, input }) => {
    try {
      const result = await finalizeBonusMonth({ tenantId: ctx.tenantId, month: getTashkentMonthStart(input.month), userId: ctx.user.userId, db: ctx.db });

      return { ...result, month: getTashkentMonthKey(result.month) };
    } catch (error) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Bonus month could not be finalized.' });
    }
  }),
  reconcileBonusMonth: adminProcedure.input(bonusMonthInput).mutation(async ({ ctx, input }) => ({
    pendingCount: await reconcileBonusMonth({ tenantId: ctx.tenantId, month: getTashkentMonthStart(input.month), actorUserId: ctx.user.userId, db: ctx.db }),
  })),
  // OnlineAdmin reviews adjustments of online-group agents only.
  reviewBonusAdjustment: scopedAdminProcedure.input(z.object({
    adjustmentId: z.string().uuid(),
    action: reviewActionSchema,
    note: z.string().trim().max(1000).optional(),
  })).mutation(async ({ ctx, input }) => {
    if (isOnlineScopedAdmin(ctx.user.roles)) {
      const [adjustment, scope] = await Promise.all([
        ctx.db.bonusAdjustment.findFirst({ where: { id: input.adjustmentId, tenantId: ctx.tenantId }, select: { agentUserId: true } }),
        resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db),
      ]);

      if (adjustment && !isUserIdInScope(scope, adjustment.agentUserId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'This adjustment belongs to an agent outside your group.' });
      }
    }
    try {
      return await reviewBonusAdjustment({ tenantId: ctx.tenantId, userId: ctx.user.userId, ...input, db: ctx.db });
    } catch (error) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Adjustment review failed.' });
    }
  }),
};
