import { reviewActionSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { calculateBonusMonth, finalizeBonusMonth, getTashkentMonthKey, getTashkentMonthStart, reconcileBonusMonth, reconcileFinalizedBonusMonths, reviewBonusAdjustment } from '../../../services/bonus-engine';
import { adminProcedure, protectedProcedure } from '../../trpc';

import { bonusMonthInput } from './schemas';

export const bonusOperationProcedures = {
  getBonusOperations: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.roles.some((role) => ['Admin', 'Manager', 'TeamLeader', 'Finance'].includes(role))) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    if (ctx.user.roles.includes('Admin')) {
      await reconcileFinalizedBonusMonths({ tenantId: ctx.tenantId, actorUserId: ctx.user.userId, db: ctx.db });
    }
    const [snapshots, adjustments] = await Promise.all([
      ctx.db.bonusMonthSnapshot.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { month: 'desc' },
        take: 24,
        select: { id: true, month: true, totalBonusAmount: true, sourceDigest: true, finalizedAt: true },
      }),
      ctx.db.bonusAdjustment.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { audits: { orderBy: { createdAt: 'desc' }, take: 5 }, snapshot: { select: { month: true } } },
      }),
    ]);

    return {
      snapshots: snapshots.map((snapshot) => ({ ...snapshot, month: getTashkentMonthKey(snapshot.month) })),
      adjustments: adjustments.map((adjustment) => ({
        ...adjustment,
        sourceMonth: getTashkentMonthKey(adjustment.snapshot.month),
        payoutMonth: adjustment.payoutMonth ? getTashkentMonthKey(adjustment.payoutMonth) : null,
      })),
    };
  }),
  previewBonusMonth: adminProcedure.input(bonusMonthInput).mutation(async ({ ctx, input }) => {
    const result = await calculateBonusMonth({ tenantId: ctx.tenantId, month: getTashkentMonthStart(input.month), db: ctx.db });

    return { ...result, month: getTashkentMonthKey(result.month) };
  }),
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
  reviewBonusAdjustment: adminProcedure.input(z.object({
    adjustmentId: z.string().uuid(),
    action: reviewActionSchema,
    note: z.string().trim().max(1000).optional(),
  })).mutation(async ({ ctx, input }) => {
    try {
      return await reviewBonusAdjustment({ tenantId: ctx.tenantId, userId: ctx.user.userId, ...input, db: ctx.db });
    } catch (error) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Adjustment review failed.' });
    }
  }),
};
