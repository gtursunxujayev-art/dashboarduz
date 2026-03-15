import crypto from 'crypto';
import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { amocrmConnectSchema, telegramBotConnectSchema, voipConnectSchema } from '@dashboarduz/shared';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { encryptIntegrationTokens } from '../../services/security/encryption';
import { amocrmService } from '../../services/integrations/amocrm';
import { asObject, getSelectedPipelineIds, getTenantAmoCRMContext } from '../../services/integrations/amocrm-live';

function normalizeBaseUrl(url?: string): string | null {
  if (!url) {
    return null;
  }
  return url.replace(/\/+$/, '');
}

function getPublicApiBaseUrl(): string {
  const explicit = normalizeBaseUrl(process.env.PUBLIC_API_URL || process.env.API_URL);
  if (explicit) {
    return explicit;
  }

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railwayDomain) {
    return `https://${railwayDomain.replace(/\/+$/, '')}`;
  }

  const port = process.env.PORT || '3001';
  return `http://localhost:${port}`;
}

async function fetchAmoCRMAccountByToken(accessToken: string, baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/v4/account`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Failed to validate AmoCRM long-lived token (${response.status})`,
    });
  }

  return response.json() as Promise<{
    id?: number | string;
    name?: string;
    domain?: string;
    subdomain?: string;
  }>;
}

export const integrationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return prisma.integration.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }),

  getByType: protectedProcedure
    .input(z.object({ type: z.enum(['amocrm', 'telegram', 'google_sheets', 'voip_utel']) }))
    .query(async ({ input, ctx }) => {
      return prisma.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: input.type,
          },
        },
      });
    }),

  connectAmoCRM: protectedProcedure
    .input(amocrmConnectSchema)
    .mutation(async ({ input, ctx }) => {
      const resolvedBaseUrl = normalizeBaseUrl(input.baseUrl || process.env.AMOCRM_BASE_URL || 'https://www.amocrm.ru');
      if (!resolvedBaseUrl) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid AmoCRM base URL' });
      }

      const accountInfo = await fetchAmoCRMAccountByToken(input.longLivedToken.trim(), resolvedBaseUrl);
      const accountId = accountInfo.id ? String(accountInfo.id) : null;
      if (!accountId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'AmoCRM account id was not returned' });
      }

      const validatedAt = new Date();
      const integration = await prisma.integration.upsert({
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

      await prisma.auditLog.create({
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

  getAmoCRMPipelines: protectedProcedure.query(async ({ ctx }) => {
    const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
    if (!amoContext) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'AmoCRM integration is not connected.',
      });
    }

    const pipelinesResponse = await amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl);
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

  updateAmoCRMPipelines: protectedProcedure
    .input(z.object({ pipelineIds: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
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

      const integration = await prisma.integration.update({
        where: { id: amoContext.integrationId },
        data: {
          config: nextConfig,
        },
      });

      await prisma.auditLog.create({
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

  connectTelegram: protectedProcedure
    .input(telegramBotConnectSchema)
    .mutation(async ({ input, ctx }) => {
      const { telegramService } = await import('../../services/integrations/telegram');
      const verification = await telegramService.verifyBotToken(input.botToken);
      if (!verification.isValid || !verification.bot) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Telegram bot token' });
      }

      const webhookSecret = crypto.randomBytes(24).toString('hex');
      const webhookUrl = `${getPublicApiBaseUrl()}/webhooks/telegram`;
      const webhookResult = await telegramService.setWebhook(input.botToken, webhookUrl, webhookSecret);
      if (!webhookResult?.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Failed to register Telegram webhook' });
      }

      const validatedAt = new Date();
      const integration = await prisma.integration.upsert({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'telegram',
          },
        },
        update: {
          status: 'active',
          tokensEncrypted: encryptIntegrationTokens({ botToken: input.botToken }),
          config: {
            botId: String(verification.bot.id),
            botUsername: verification.bot.username || null,
            botName: verification.bot.first_name || null,
            webhookUrl,
            webhookSecret,
            lastValidatedAt: validatedAt.toISOString(),
          },
          lastSyncAt: validatedAt,
        },
        create: {
          tenantId: ctx.tenantId,
          type: 'telegram',
          status: 'active',
          tokensEncrypted: encryptIntegrationTokens({ botToken: input.botToken }),
          config: {
            botId: String(verification.bot.id),
            botUsername: verification.bot.username || null,
            botName: verification.bot.first_name || null,
            webhookUrl,
            webhookSecret,
            lastValidatedAt: validatedAt.toISOString(),
          },
          lastSyncAt: validatedAt,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'integration_connect',
          resource: 'integration',
          resourceId: integration.id,
          metadata: { type: 'telegram' },
        },
      });

      return {
        integration,
        connection: {
          verified: true,
          validatedAt: validatedAt.toISOString(),
          bot: {
            id: verification.bot.id,
            username: verification.bot.username,
            name: verification.bot.first_name,
          },
          webhookUrl,
        },
      };
    }),

  connectGoogleSheets: protectedProcedure.mutation(async () => {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Google Sheets integration is disabled in MVP',
    });
  }),

  connectVoIP: protectedProcedure
    .input(voipConnectSchema)
    .mutation(async ({ ctx }) => {
      const webhookKey = crypto.randomBytes(24).toString('hex');
      const webhookUrl = `${getPublicApiBaseUrl()}/webhooks/voip?integration_key=${webhookKey}`;
      const validatedAt = new Date();

      const integration = await prisma.integration.upsert({
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

      await prisma.auditLog.create({
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

  disconnect: protectedProcedure
    .input(z.object({ type: z.enum(['amocrm', 'telegram', 'google_sheets', 'voip_utel']) }))
    .mutation(async ({ input, ctx }) => {
      await prisma.integration.updateMany({
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

      await prisma.auditLog.create({
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
});
