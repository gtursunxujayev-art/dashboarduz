import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asObjectOrEmpty } from '../../../lib/object';
import { adminProcedure } from '../../trpc';

/** What the integrations page reads. Never the encrypted tokens, the refresh token or the webhook secrets in config. */
const integrationPublicSelect = {
  id: true,
  type: true,
  status: true,
  config: true,
  expiresAt: true,
  lastSyncAt: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Config keys that authenticate webhooks (Telegram secret token, Face ID token hash): server-side only. */
const SECRET_CONFIG_KEYS = ['webhookSecret', 'webhookTokenHash'];

function withoutSecrets<T extends { config: unknown }>(integration: T): T {
  if (integration.config === null || typeof integration.config !== 'object' || Array.isArray(integration.config)) {
    return integration;
  }
  const config = Object.fromEntries(Object.entries(asObjectOrEmpty(integration.config)).filter(([key]) => !SECRET_CONFIG_KEYS.includes(key)));

  return { ...integration, config };
}

export const generalIntegrationProcedures = {
  list: adminProcedure.query(async ({ ctx }) => {
    const integrations = await ctx.db.integration.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
      select: integrationPublicSelect,
    });

    return integrations.map(withoutSecrets);
  }),
  getByType: adminProcedure
    .input(z.object({ type: z.enum(['amocrm', 'telegram', 'google_sheets', 'faceid_attendance', 'meta_ads']) }))
    .query(async ({ input, ctx }) => {
      const integration = await ctx.db.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: input.type,
          },
        },
        select: integrationPublicSelect,
      });

      return integration ? withoutSecrets(integration) : null;
    }),
  connectGoogleSheets: adminProcedure.mutation(() => {
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
