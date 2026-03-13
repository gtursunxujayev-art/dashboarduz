import { router, protectedProcedure } from '../trpc';
import { z } from 'zod';
import { amocrmConnectSchema, telegramBotConnectSchema, voipConnectSchema } from '@dashboarduz/shared';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';

export const integrationsRouter = router({
  // List all integrations for tenant
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.tenantId) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }

    return await prisma.integration.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }),

  // Get integration by type
  getByType: protectedProcedure
    .input(z.object({ type: z.enum(['amocrm', 'telegram', 'google_sheets', 'voip_utel']) }))
    .query(async ({ input, ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      return await prisma.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: input.type,
          },
        },
      });
    }),

  // Connect AmoCRM
  connectAmoCRM: protectedProcedure
    .input(amocrmConnectSchema)
    .mutation(async ({ input: _input, ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      const { amocrmService } = await import('../../services/integrations/amocrm');
      const oauthState = `tenant:${ctx.tenantId}`;
      const authUrl = amocrmService.getAuthUrl(oauthState);

      const integration = await prisma.integration.upsert({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'amocrm',
          },
        },
        update: {
          status: 'pending',
          config: { authUrl },
        },
        create: {
          tenantId: ctx.tenantId,
          type: 'amocrm',
          status: 'pending',
          config: { authUrl },
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'integration_connect',
          resource: 'integration',
          resourceId: integration.id,
          metadata: { type: 'amocrm' },
        },
      });

      return { integration, authUrl };
    }),

  // Connect Telegram Bot
  connectTelegram: protectedProcedure
    .input(telegramBotConnectSchema)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      const { telegramService } = await import('../../services/integrations/telegram');
      const isValidToken = await telegramService.verifyBotToken(input.botToken);
      if (!isValidToken) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Telegram bot token' });
      }

      const integration = await prisma.integration.upsert({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'telegram',
          },
        },
        update: {
          status: 'active',
          config: { botToken: input.botToken },
        },
        create: {
          tenantId: ctx.tenantId,
          type: 'telegram',
          status: 'active',
          config: { botToken: input.botToken },
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

      return integration;
    }),

  // Connect Google Sheets
  connectGoogleSheets: protectedProcedure
    .mutation(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Google Sheets integration is disabled in MVP',
      });
    }),

  // Connect VoIP (UTeL)
  connectVoIP: protectedProcedure
    .input(voipConnectSchema)
    .mutation(async ({ input, ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      const { createVoIPService } = await import('../../services/integrations/voip');
      const voipService = createVoIPService({
        apiToken: input.apiToken,
        apiUrl: input.apiUrl || 'https://api.utel.uz',
      });
      const isValidToken = await voipService.validateToken();
      if (!isValidToken) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid VoIP API token' });
      }

      const integration = await prisma.integration.upsert({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'voip_utel',
          },
        },
        update: {
          status: 'active',
          config: { apiToken: input.apiToken, apiUrl: input.apiUrl },
        },
        create: {
          tenantId: ctx.tenantId,
          type: 'voip_utel',
          status: 'active',
          config: { apiToken: input.apiToken, apiUrl: input.apiUrl },
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

      return integration;
    }),

  // Disconnect integration
  disconnect: protectedProcedure
    .input(z.object({ type: z.enum(['amocrm', 'telegram', 'google_sheets', 'voip_utel']) }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

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
