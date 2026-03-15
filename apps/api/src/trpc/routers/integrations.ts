import crypto from 'crypto';
import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { amocrmConnectSchema, telegramBotConnectSchema, voipConnectSchema } from '@dashboarduz/shared';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { encryptIntegrationTokens } from '../../services/security/encryption';

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
    .mutation(async ({ input, ctx }) => {
      const { createVoIPService } = await import('../../services/integrations/voip');
      const resolvedApiUrl = input.apiUrl || process.env.UTEL_API_URL || 'https://api.utel.uz';
      const voipService = createVoIPService({
        apiToken: input.apiToken,
        apiUrl: resolvedApiUrl,
      });
      const isValidToken = await voipService.validateToken();
      if (!isValidToken) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid VoIP API token' });
      }

      const webhookKey = crypto.randomBytes(24).toString('hex');
      const webhookUrl = `${getPublicApiBaseUrl()}/webhooks/utel?integration_key=${webhookKey}`;
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
          tokensEncrypted: encryptIntegrationTokens({ apiToken: input.apiToken }),
          config: {
            apiUrl: resolvedApiUrl,
            webhookKey,
            webhookUrl,
            lastValidatedAt: validatedAt.toISOString(),
          },
          lastSyncAt: validatedAt,
        },
        create: {
          tenantId: ctx.tenantId,
          type: 'voip_utel',
          status: 'active',
          tokensEncrypted: encryptIntegrationTokens({ apiToken: input.apiToken }),
          config: {
            apiUrl: resolvedApiUrl,
            webhookKey,
            webhookUrl,
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
          apiUrl: resolvedApiUrl,
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
