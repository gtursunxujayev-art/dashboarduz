import { amocrmConnectSchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { logger } from '../../../lib/logger';
import { amoFailureHelp, amoFailureMessage, detectAmoFailureReason, fetchAmoCRMAccountByToken, normalizeBaseUrl } from '../../../services/integration-settings/connection';
import { amocrmService } from '../../../services/integrations/amocrm';
import { getTenantAmoCRMContext } from '../../../services/integrations/amocrm-live';
import { encryptIntegrationTokens } from '../../../services/security/encryption';
import { adminProcedure } from '../../trpc';

export const amocrmIntegrationProcedures = {
  connectAmoCRM: adminProcedure
    .input(amocrmConnectSchema)
    .mutation(async ({ input, ctx }) => {
      const resolvedBaseUrl = normalizeBaseUrl(input.baseUrl || process.env.AMOCRM_BASE_URL || 'https://www.amocrm.ru');

      if (!resolvedBaseUrl) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid AmoCRM base URL' });
      }

      let accountInfo: Awaited<ReturnType<typeof fetchAmoCRMAccountByToken>>;

      try {
        accountInfo = await fetchAmoCRMAccountByToken(input.longLivedToken.trim(), resolvedBaseUrl);
      } catch (error: any) {
        if (error instanceof TRPCError) {
          throw error;
        }
        const reason = detectAmoFailureReason(error);

        throw new TRPCError({
          code: reason === 'network_timeout' ? 'TIMEOUT' : 'BAD_REQUEST',
          message: amoFailureMessage('AmoCRM ulanishini tekshirib bo‘lmadi', reason),
        });
      }
      const accountId = accountInfo.id ? String(accountInfo.id) : null;

      if (!accountId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'AmoCRM account id was not returned' });
      }

      const validatedAt = new Date();
      const integration = await ctx.db.integration.upsert({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'amocrm',
          },
        },
        update: {
          status: 'active',
          tokensEncrypted: encryptIntegrationTokens({
            access_token: input.longLivedToken.trim(),
            token_type: 'Bearer',
            source: 'long_lived_token',
          }),
          refreshToken: null,
          expiresAt: null,
          config: {
            account_id: accountId,
            account_name: accountInfo.name || null,
            domain: accountInfo.domain || null,
            subdomain: accountInfo.subdomain || null,
            base_url: resolvedBaseUrl,
            connectionMode: 'long_lived_token',
            connectedAt: validatedAt.toISOString(),
            lastValidatedAt: validatedAt.toISOString(),
          },
          lastSyncAt: validatedAt,
          errorMessage: null,
        },
        create: {
          tenantId: ctx.tenantId,
          type: 'amocrm',
          status: 'active',
          tokensEncrypted: encryptIntegrationTokens({
            access_token: input.longLivedToken.trim(),
            token_type: 'Bearer',
            source: 'long_lived_token',
          }),
          refreshToken: null,
          expiresAt: null,
          config: {
            account_id: accountId,
            account_name: accountInfo.name || null,
            domain: accountInfo.domain || null,
            subdomain: accountInfo.subdomain || null,
            base_url: resolvedBaseUrl,
            connectionMode: 'long_lived_token',
            connectedAt: validatedAt.toISOString(),
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
          metadata: { type: 'amocrm', mode: 'long_lived_token' },
        },
      });

      return {
        integration,
        connection: {
          verified: true,
          validatedAt: validatedAt.toISOString(),
          mode: 'long_lived_token',
          accountId,
          baseUrl: resolvedBaseUrl,
        },
      };
    }),
  getAmoCRMPipelines: adminProcedure.query(async ({ ctx }) => {
    let amoContext: Awaited<ReturnType<typeof getTenantAmoCRMContext>> = null;
    let contextError: unknown = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        amoContext = await getTenantAmoCRMContext(ctx.tenantId, ctx.db);
        contextError = null;
        break;
      } catch (error: any) {
        contextError = error;
        if (attempt < 2) {
          continue;
        }
      }
    }
    if (contextError) {
      const reason = detectAmoFailureReason(contextError);
      const help = amoFailureHelp(reason);

      logger.warn({
        tenantId: ctx.tenantId,
        reason,
        retried: true,
        error: String((contextError as any)?.message || contextError),
      }, '[AmoCRM][Pipelines] Context load failed');
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: [amoFailureMessage('AmoCRM context yuklanmadi', reason), help].filter(Boolean).join('. '),
      });
    }
    if (!amoContext) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'AmoCRM integration is not connected.',
      });
    }

    let pipelinesResponse: Awaited<ReturnType<typeof amocrmService.fetchPipelines>>;

    try {
      pipelinesResponse = await amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl);
    } catch (firstError: any) {
      try {
        pipelinesResponse = await amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl);
      } catch (secondError: any) {
        const reason = detectAmoFailureReason(secondError || firstError);

        logger.warn({
          tenantId: ctx.tenantId,
          reason,
          retried: true,
          error: String((secondError as any)?.message || (firstError as any)?.message || secondError || firstError),
        }, '[AmoCRM][Pipelines] Fetch failed');
        const help = amoFailureHelp(reason);

        throw new TRPCError({
          code: reason === 'network_timeout' ? 'TIMEOUT' : 'BAD_REQUEST',
          message: [amoFailureMessage("AmoCRM pipeline'larini yuklab bo'lmadi", reason), help].filter(Boolean).join('. '),
        });
      }
    }
    const pipelines = Array.isArray(pipelinesResponse._embedded?.pipelines) ? pipelinesResponse._embedded.pipelines : [];

    return {
      hasExplicitSelection: Array.isArray((amoContext.config as Record<string, unknown>).selectedPipelineIds),
      selectedPipelineIds: amoContext.selectedPipelineIds || [],
      pipelines: pipelines.map((pipeline) => ({
        id: String(pipeline.id || ''),
        name: String(pipeline.name || pipeline.id || 'Unnamed pipeline'),
        statuses: Array.isArray(pipeline._embedded?.statuses)
          ? pipeline._embedded.statuses.map((status) => ({
              id: String(status.id || ''),
              name: String(status.name || status.id || 'Unnamed status'),
            }))
          : [],
      })),
    };
  }),
  updateAmoCRMPipelines: adminProcedure
    .input(z.object({ pipelineIds: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      const amoContext = await getTenantAmoCRMContext(ctx.tenantId, ctx.db);

      if (!amoContext) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AmoCRM integration is not connected.',
        });
      }

      const pipelinesResponse = await amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl);
      const pipelines = Array.isArray(pipelinesResponse._embedded?.pipelines) ? pipelinesResponse._embedded.pipelines : [];
      const availablePipelineIds = new Set(
        pipelines
          .map((pipeline) => String(pipeline.id || '').trim())
          .filter(Boolean),
      );

      const nextPipelineIds = input.pipelineIds
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

      for (const pipelineId of nextPipelineIds) {
        if (!availablePipelineIds.has(pipelineId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Unknown AmoCRM pipeline id: ${pipelineId}`,
          });
        }
      }

      const nextConfig = {
        ...amoContext.config,
        selectedPipelineIds: nextPipelineIds,
        pipelineCatalog: pipelines.map((pipeline) => ({
          id: String(pipeline.id || ''),
          name: String(pipeline.name || pipeline.id || 'Unnamed pipeline'),
        })),
        lastPipelineSyncAt: new Date().toISOString(),
      };

      const integration = await ctx.db.integration.update({
        where: { id: amoContext.integrationId },
        data: {
          config: nextConfig,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'integration_update',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            type: 'amocrm',
            selectedPipelineIds: nextPipelineIds,
          },
        },
      });

      return {
        success: true,
        selectedPipelineIds: nextPipelineIds,
      };
    }),
};
