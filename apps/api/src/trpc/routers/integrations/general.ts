import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { adminProcedure } from '../../trpc';

export const generalIntegrationProcedures = {
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.integration.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }),
  getByType: adminProcedure
    .input(z.object({ type: z.enum(['amocrm', 'telegram', 'google_sheets', 'faceid_attendance', 'meta_ads']) }))
    .query(async ({ input, ctx }) => {
      return ctx.db.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: input.type,
          },
        },
      });
    }),
  connectGoogleSheets: adminProcedure.mutation(async () => {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Google Sheets integration is disabled in MVP',
    });
  }),
  disconnect: adminProcedure
    .input(z.object({ type: z.enum(['amocrm', 'telegram', 'google_sheets', 'faceid_attendance', 'meta_ads']) }))
    .mutation(async ({ input, ctx }) => {
      await ctx.db.integration.updateMany({
        where: {
          tenantId: ctx.tenantId,
          type: input.type,
        },
        data: {
          status: 'disconnected',
          tokensEncrypted: null,
          refreshToken: null,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'integration_disconnect',
          resource: 'integration',
          metadata: { type: input.type },
        },
      });

      return { success: true };
    }),
};
