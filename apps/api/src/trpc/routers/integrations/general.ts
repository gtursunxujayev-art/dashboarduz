import crypto from 'crypto';

import { voipConnectSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getPublicApiBaseUrl } from '../../../services/integration-settings/connection';
import { adminProcedure } from '../../trpc';

export const generalIntegrationProcedures = {
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.integration.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }),
  getByType: adminProcedure
    .input(z.object({ type: z.enum(['amocrm', 'telegram', 'google_sheets', 'voip_utel', 'faceid_attendance', 'meta_ads']) }))
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
  connectVoIP: adminProcedure
    .input(voipConnectSchema)
    .mutation(async ({ ctx }) => {
      const webhookKey = crypto.randomBytes(24).toString('hex');
      const webhookUrl = `${getPublicApiBaseUrl()}/webhooks/voip?integration_key=${webhookKey}`;
      const validatedAt = new Date();

      const integration = await ctx.db.integration.upsert({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'voip_utel',
          },
        },
        update: {
          status: 'active',
          tokensEncrypted: null,
          config: {
            webhookKey,
            webhookUrl,
            connectionMode: 'webhook_only',
            lastValidatedAt: validatedAt.toISOString(),
          },
          lastSyncAt: validatedAt,
        },
        create: {
          tenantId: ctx.tenantId,
          type: 'voip_utel',
          status: 'active',
          tokensEncrypted: null,
          config: {
            webhookKey,
            webhookUrl,
            connectionMode: 'webhook_only',
            lastValidatedAt: validatedAt.toISOString(),
          },
          lastSyncAt: validatedAt,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'integration_connect',
          resource: 'integration',
          resourceId: integration.id,
          metadata: { type: 'voip_utel' },
        },
      });

      return {
        integration,
        connection: {
          verified: true,
          validatedAt: validatedAt.toISOString(),
          webhookUrl,
          mode: 'webhook_only',
        },
      };
    }),
  disconnect: adminProcedure
    .input(z.object({ type: z.enum(['amocrm', 'telegram', 'google_sheets', 'voip_utel', 'faceid_attendance', 'meta_ads']) }))
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
