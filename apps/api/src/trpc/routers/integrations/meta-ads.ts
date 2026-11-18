import { dateKeyRangeInput, metaAdsConnectSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { thrownMessageOr } from '../../../lib/errors';
import { asObjectOrEmpty } from '../../../lib/object';
import { upsertActiveIntegration } from '../../../services/integration-settings/connection';
import { normalizeMetaAdAccountId, syncMetaAdInsightsForTenant, validateMetaAdAccount } from '../../../services/integrations/meta-ads';
import { encryptIntegrationTokens } from '../../../services/security/encryption';
import { adminProcedure } from '../../trpc';

export const metaAdsIntegrationProcedures = {
  connectMetaAds: adminProcedure
    .input(metaAdsConnectSchema)
    .mutation(async ({ input, ctx }) => {
      const accessToken = input.accessToken.trim();
      const adAccountId = normalizeMetaAdAccountId(input.adAccountId);
      const account = await validateMetaAdAccount(accessToken, adAccountId);

      if (!account?.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Meta Ad Account was not returned.' });
      }

      const validatedAt = new Date();
      const integration = await upsertActiveIntegration({
        db: ctx.db,
        tenantId: ctx.tenantId,
        type: 'meta_ads',
        data: {
          tokensEncrypted: encryptIntegrationTokens({ accessToken }),
          config: {
            adAccountId,
            accountId: String(account.id),
            accountName: account.name || null,
            accountStatus: account.account_status ?? null,
            currency: account.currency || null,
            pixelId: input.pixelId?.trim() || null,
            connectionMode: 'system_user_token',
            connectedAt: validatedAt.toISOString(),
            lastValidatedAt: validatedAt.toISOString(),
          },
          lastSyncAt: validatedAt,
        },
        clearError: true,
        connectAudit: { actorUserId: ctx.user.userId, metadata: { type: 'meta_ads', adAccountId } },
      });

      return {
        integration,
        connection: {
          verified: true,
          validatedAt: validatedAt.toISOString(),
          adAccountId,
          accountName: account.name || null,
          currency: account.currency || null,
        },
      };
    }),
  getMetaAdsStatus: adminProcedure.query(async ({ ctx }) => {
    const integration = await ctx.db.integration.findUnique({
      where: {
        tenantId_type: {
          tenantId: ctx.tenantId,
          type: 'meta_ads',
        },
      },
      select: {
        status: true,
        config: true,
        lastSyncAt: true,
        errorMessage: true,
        tokensEncrypted: true,
      },
    });

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let rowsLast30d = 0;
    const metaTableMissing = false;

    rowsLast30d = await ctx.db.metaAdInsight.count({
      where: {
        tenantId: ctx.tenantId,
        date: { gte: since },
      },
    });

    if (!integration || integration.status !== 'active') {
      return {
        connected: false,
        hasToken: false,
        accountName: null as string | null,
        adAccountId: null as string | null,
        pixelId: null as string | null,
        lastSyncAt: null as string | null,
        errorMessage: null as string | null,
        rowsLast30d,
        tableMissing: metaTableMissing,
      };
    }

    const config = asObjectOrEmpty(integration.config);

    return {
      connected: true,
      hasToken: Boolean(integration.tokensEncrypted),
      accountName: typeof config.accountName === 'string' ? config.accountName : null,
      adAccountId: typeof config.adAccountId === 'string' ? config.adAccountId : null,
      pixelId: typeof config.pixelId === 'string' ? config.pixelId : null,
      lastSyncAt: integration.lastSyncAt ? integration.lastSyncAt.toISOString() : null,
      errorMessage: integration.errorMessage,
      rowsLast30d,
      tableMissing: metaTableMissing,
    };
  }),
  syncMetaAds: adminProcedure
    .input(
      z.object({
        ...dateKeyRangeInput.partial().shape,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const now = new Date();
      const dateTo = input.dateTo ? new Date(`${input.dateTo}T00:00:00.000Z`) : now;
      const dateFrom = input.dateFrom
        ? new Date(`${input.dateFrom}T00:00:00.000Z`)
        : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      try {
        const result = await syncMetaAdInsightsForTenant(ctx.tenantId, dateFrom, dateTo, ctx.db);

        await ctx.db.auditLog.create({
          data: {
            tenantId: ctx.tenantId,
            userId: ctx.user.userId,
            action: 'integration_sync',
            resource: 'integration',
            metadata: {
              type: 'meta_ads',
              dateFrom: dateFrom.toISOString(),
              dateTo: dateTo.toISOString(),
              imported: result.imported,
            },
          },
        });

        return { success: true, ...result };
      } catch (error) {
        await ctx.db.integration.updateMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'meta_ads',
          },
          data: {
            status: 'error',
            errorMessage: thrownMessageOr(error, 'Meta Ads sync failed'),
          },
        });
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: thrownMessageOr(error, 'Meta Ads sync failed'),
        });
      }
    }),
};
