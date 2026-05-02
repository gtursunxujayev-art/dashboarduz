import crypto from 'crypto';
import { adminProcedure, router } from '../trpc';
import { z } from 'zod';
import { amocrmConnectSchema, faceIdConnectSchema, metaAdsConnectSchema, telegramBotConnectSchema, voipConnectSchema } from '@dashboarduz/shared';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { encryptIntegrationTokens } from '../../services/security/encryption';
import { amocrmService } from '../../services/integrations/amocrm';
import { getTenantAmoCRMContext } from '../../services/integrations/amocrm-live';
import { normalizeMetaAdAccountId, syncMetaAdInsightsForTenant, validateMetaAdAccount } from '../../services/integrations/meta-ads';
import {
  parseTelegramRecipients,
  updateTelegramReportSelection,
} from '../../services/integrations/telegram-recipients';
import { sendImmediateTodayReportForTenant, sendManualTelegramReportForTenant } from '../../services/reports/telegram-report-scheduler';

function normalizeBaseUrl(url?: string): string | null {
  if (!url) {
    return null;
  }
  return url.replace(/\/+$/, '');
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
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

function buildFaceIdWebhookToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function hashFaceIdWebhookToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeBranchWhitelist(branchWhitelist?: string[]): string[] {
  if (!Array.isArray(branchWhitelist)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of branchWhitelist) {
    const branch = String(raw || '').trim();
    if (!branch) continue;
    const key = branch.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(branch);
  }
  return normalized;
}

function normalizeUnmatchedUserPolicy(value: unknown): 'store' | 'ignore' {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'ignore' ? 'ignore' : 'store';
}

function isMissingMetaTableError(error: unknown): boolean {
  const message = String((error as any)?.message || '');
  return message.includes('meta_ad_insights') && (
    message.includes('does not exist')
    || message.includes('does not exist in the current database')
    || message.includes('relation')
  );
}

function parseFaceIdUserExternalMap(config: unknown): Record<string, string> {
  const raw = asObject(asObject(config).userExternalMap);
  const result: Record<string, string> = {};
  for (const [externalUserIdRaw, userIdRaw] of Object.entries(raw)) {
    const externalUserId = String(externalUserIdRaw || '').trim();
    const userId = String(userIdRaw || '').trim();
    if (!externalUserId || !userId) {
      continue;
    }
    result[externalUserId] = userId;
  }
  return result;
}

function toTashkentDateKey(date: Date): string {
  const shifted = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  list: adminProcedure.query(async ({ ctx }) => {
    return prisma.integration.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }),

  getByType: adminProcedure
    .input(z.object({ type: z.enum(['amocrm', 'telegram', 'google_sheets', 'voip_utel', 'faceid_attendance', 'meta_ads']) }))
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

  connectAmoCRM: adminProcedure
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

  getAmoCRMPipelines: adminProcedure.query(async ({ ctx }) => {
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

  updateAmoCRMPipelines: adminProcedure
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

  connectTelegram: adminProcedure
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

      const existing = await prisma.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'telegram',
          },
        },
        select: {
          config: true,
        },
      });
      const existingRecipients = parseTelegramRecipients(existing?.config);

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
            telegramReportRecipients: existingRecipients,
            reportRecipientChatIds: existingRecipients
              .filter((recipient) => recipient.started && recipient.selectedForReports)
              .map((recipient) => recipient.chatId),
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
            telegramReportRecipients: existingRecipients,
            reportRecipientChatIds: existingRecipients
              .filter((recipient) => recipient.started && recipient.selectedForReports)
              .map((recipient) => recipient.chatId),
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

  getTelegramReportRecipients: adminProcedure.query(async ({ ctx }) => {
    const integration = await prisma.integration.findUnique({
      where: {
        tenantId_type: {
          tenantId: ctx.tenantId,
          type: 'telegram',
        },
      },
      select: {
        id: true,
        status: true,
        config: true,
      },
    });

    if (!integration || integration.status !== 'active') {
      return {
        connected: false,
        recipients: [] as Array<{
          chatId: string;
          displayName: string;
          username: string | null;
          firstName: string | null;
          lastName: string | null;
          selectedForReports: boolean;
          startedAt: string | null;
          lastSeenAt: string | null;
        }>,
      };
    }

    const recipients = parseTelegramRecipients(integration.config)
      .filter((recipient) => recipient.started)
      .map((recipient) => ({
        chatId: recipient.chatId,
        displayName: recipient.displayName,
        username: recipient.username,
        firstName: recipient.firstName,
        lastName: recipient.lastName,
        selectedForReports: recipient.selectedForReports,
        startedAt: recipient.startedAt,
        lastSeenAt: recipient.lastSeenAt,
      }));

    return {
      connected: true,
      recipients,
    };
  }),

  updateTelegramReportRecipients: adminProcedure
    .input(z.object({ chatIds: z.array(z.string()) }))
    .mutation(async ({ input, ctx }) => {
      const integration = await prisma.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'telegram',
          },
        },
      });

      if (!integration || integration.status !== 'active') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Telegram integration is not connected.',
        });
      }

      const recipients = parseTelegramRecipients(integration.config).filter((recipient) => recipient.started);
      const availableChatIds = new Set(recipients.map((recipient) => recipient.chatId));
      for (const chatId of input.chatIds) {
        const normalized = String(chatId || '').trim();
        if (!normalized || !availableChatIds.has(normalized)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Unknown Telegram recipient chat id: ${chatId}`,
          });
        }
      }

      const { config: nextConfig, selectedChatIds } = updateTelegramReportSelection(integration.config, input.chatIds);
      await prisma.integration.update({
        where: { id: integration.id },
        data: { config: nextConfig as any },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'integration_update',
          resource: 'integration',
          resourceId: integration.id,
          metadata: {
            type: 'telegram',
            reportRecipientChatIds: selectedChatIds,
          },
        },
      });

      return {
        success: true,
        selectedChatIds,
      };
    }),

  sendTelegramTodayReportNow: adminProcedure.mutation(async ({ ctx }) => {
    try {
      const result = await sendImmediateTodayReportForTenant(ctx.tenantId);
      return result;
    } catch (error: any) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error?.message || 'Failed to send report',
      });
    }
  }),

  sendTelegramWeeklyReportNow: adminProcedure.mutation(async ({ ctx }) => {
    try {
      return await sendManualTelegramReportForTenant(ctx.tenantId, 'weekly');
    } catch (error: any) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error?.message || 'Failed to send report',
      });
    }
  }),

  sendTelegramMonthlyReportNow: adminProcedure.mutation(async ({ ctx }) => {
    try {
      return await sendManualTelegramReportForTenant(ctx.tenantId, 'monthly');
    } catch (error: any) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error?.message || 'Failed to send report',
      });
    }
  }),

  connectGoogleSheets: adminProcedure.mutation(async () => {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Google Sheets integration is disabled in MVP',
    });
  }),

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
      const integration = await prisma.integration.upsert({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'meta_ads',
          },
        },
        update: {
          status: 'active',
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
          errorMessage: null,
        },
        create: {
          tenantId: ctx.tenantId,
          type: 'meta_ads',
          status: 'active',
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
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'integration_connect',
          resource: 'integration',
          resourceId: integration.id,
          metadata: { type: 'meta_ads', adAccountId },
        },
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
    const integration = await prisma.integration.findUnique({
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
    let metaTableMissing = false;
    try {
      rowsLast30d = await prisma.metaAdInsight.count({
        where: {
          tenantId: ctx.tenantId,
          date: { gte: since },
        },
      });
    } catch (error) {
      if (!isMissingMetaTableError(error)) {
        throw error;
      }
      metaTableMissing = true;
    }

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

    const config = asObject(integration.config);
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
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const now = new Date();
      const dateTo = input.dateTo ? new Date(`${input.dateTo}T00:00:00.000Z`) : now;
      const dateFrom = input.dateFrom
        ? new Date(`${input.dateFrom}T00:00:00.000Z`)
        : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      try {
        const result = await syncMetaAdInsightsForTenant(ctx.tenantId, dateFrom, dateTo);
        await prisma.auditLog.create({
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
      } catch (error: any) {
        await prisma.integration.updateMany({
          where: {
            tenantId: ctx.tenantId,
            type: 'meta_ads',
          },
          data: {
            status: 'error',
            errorMessage: error?.message || 'Meta Ads sync failed',
          },
        });
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error?.message || 'Meta Ads sync failed',
        });
      }
    }),

  connectVoIP: adminProcedure
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

  connectFaceId: adminProcedure
    .input(faceIdConnectSchema)
    .mutation(async ({ input, ctx }) => {
      const webhookToken = String(input?.webhookToken || '').trim() || buildFaceIdWebhookToken();
      const webhookTokenHash = hashFaceIdWebhookToken(webhookToken);
      const branchWhitelist = normalizeBranchWhitelist(input?.branchWhitelist);
      const unmatchedUserPolicy = normalizeUnmatchedUserPolicy(input?.unmatchedUserPolicy);
      const validatedAt = new Date();
      const webhookUrl = `${getPublicApiBaseUrl()}/webhooks/faceid`;

      const integration = await prisma.integration.upsert({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'faceid_attendance',
          },
        },
        update: {
          status: 'active',
          tokensEncrypted: encryptIntegrationTokens({ webhookToken }),
          config: {
            enabled: true,
            webhookUrl,
            webhookTokenHash,
            branchWhitelist,
            unmatchedUserPolicy,
            lastValidatedAt: validatedAt.toISOString(),
          },
          lastSyncAt: validatedAt,
          errorMessage: null,
        },
        create: {
          tenantId: ctx.tenantId,
          type: 'faceid_attendance',
          status: 'active',
          tokensEncrypted: encryptIntegrationTokens({ webhookToken }),
          config: {
            enabled: true,
            webhookUrl,
            webhookTokenHash,
            branchWhitelist,
            unmatchedUserPolicy,
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
          metadata: { type: 'faceid_attendance' },
        },
      });

      return {
        integration,
        connection: {
          verified: true,
          validatedAt: validatedAt.toISOString(),
          webhookUrl,
          webhookToken,
          branchWhitelist,
          unmatchedUserPolicy,
        },
      };
    }),

  updateFaceIdSettings: adminProcedure
    .input(
      z.object({
        branchWhitelist: z.array(z.string().min(1)).optional(),
        unmatchedUserPolicy: z.enum(['store', 'ignore']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const integration = await prisma.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'faceid_attendance',
          },
        },
        select: {
          id: true,
          config: true,
        },
      });

      if (!integration) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Face ID integration is not connected.',
        });
      }

      const existingConfig = asObject(integration.config);
      const nextConfig = {
        ...existingConfig,
        enabled: true,
        webhookUrl: String(existingConfig.webhookUrl || `${getPublicApiBaseUrl()}/webhooks/faceid`),
        branchWhitelist: normalizeBranchWhitelist(input.branchWhitelist),
        unmatchedUserPolicy: normalizeUnmatchedUserPolicy(input.unmatchedUserPolicy ?? existingConfig.unmatchedUserPolicy),
        lastValidatedAt: new Date().toISOString(),
      };

      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          config: nextConfig,
          lastSyncAt: new Date(),
          errorMessage: null,
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
            type: 'faceid_attendance',
            action: 'update_settings',
            branchWhitelist: nextConfig.branchWhitelist,
            unmatchedUserPolicy: nextConfig.unmatchedUserPolicy,
          },
        },
      });

      return {
        success: true,
        branchWhitelist: nextConfig.branchWhitelist as string[],
        unmatchedUserPolicy: nextConfig.unmatchedUserPolicy as 'store' | 'ignore',
      };
    }),

  getFaceIdMappings: adminProcedure.query(async ({ ctx }) => {
    const integration = await prisma.integration.findUnique({
      where: {
        tenantId_type: {
          tenantId: ctx.tenantId,
          type: 'faceid_attendance',
        },
      },
      select: {
        config: true,
      },
    });

    if (!integration) {
      return {
        connected: false,
        mappings: [] as Array<{ externalUserId: string; userId: string; userName: string | null; userPhone: string | null; userActive: boolean }>,
      };
    }

    const externalMap = parseFaceIdUserExternalMap(integration.config);
    const mappedUserIds = Array.from(new Set(Object.values(externalMap)));
    const users = mappedUserIds.length
      ? await prisma.user.findMany({
          where: {
            tenantId: ctx.tenantId,
            id: { in: mappedUserIds },
          },
          select: {
            id: true,
            name: true,
            phone: true,
            isActive: true,
          },
        })
      : [];
    const userById = new Map(users.map((user) => [user.id, user]));

    const mappings = Object.entries(externalMap)
      .map(([externalUserId, userId]) => {
        const user = userById.get(userId);
        return {
          externalUserId,
          userId,
          userName: user?.name || null,
          userPhone: user?.phone || null,
          userActive: Boolean(user?.isActive),
        };
      })
      .sort((a, b) => a.externalUserId.localeCompare(b.externalUserId));

    return {
      connected: true,
      mappings,
    };
  }),

  upsertFaceIdMapping: adminProcedure
    .input(
      z.object({
        externalUserId: z.string().min(1).max(128),
        userId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const integration = await prisma.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'faceid_attendance',
          },
        },
        select: {
          id: true,
          config: true,
        },
      });

      if (!integration) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Face ID integration is not connected.',
        });
      }

      const user = await prisma.user.findFirst({
        where: {
          id: input.userId,
          tenantId: ctx.tenantId,
        },
        select: { id: true },
      });
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Selected user not found in this tenant.',
        });
      }

      const externalUserId = String(input.externalUserId || '').trim();
      const existingMap = parseFaceIdUserExternalMap(integration.config);
      const existingMappedUserId = existingMap[externalUserId];
      if (existingMappedUserId && existingMappedUserId !== input.userId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This external Face ID user is already mapped to another user.',
        });
      }

      const nextMap = {
        ...existingMap,
        [externalUserId]: input.userId,
      };

      const nextConfig = {
        ...asObject(integration.config),
        userExternalMap: nextMap,
        lastValidatedAt: new Date().toISOString(),
      };

      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          config: nextConfig,
          lastSyncAt: new Date(),
          errorMessage: null,
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
            type: 'faceid_attendance',
            action: 'upsert_user_external_map',
            externalUserId,
            mappedUserId: input.userId,
          },
        },
      });

      return {
        success: true,
        externalUserId,
        userId: input.userId,
      };
    }),

  removeFaceIdMapping: adminProcedure
    .input(z.object({ externalUserId: z.string().min(1).max(128) }))
    .mutation(async ({ input, ctx }) => {
      const integration = await prisma.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'faceid_attendance',
          },
        },
        select: {
          id: true,
          config: true,
        },
      });

      if (!integration) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Face ID integration is not connected.',
        });
      }

      const externalUserId = String(input.externalUserId || '').trim();
      const existingMap = parseFaceIdUserExternalMap(integration.config);
      if (!existingMap[externalUserId]) {
        return { success: true, removed: false };
      }

      const nextMap = { ...existingMap };
      delete nextMap[externalUserId];

      const nextConfig = {
        ...asObject(integration.config),
        userExternalMap: nextMap,
        lastValidatedAt: new Date().toISOString(),
      };

      await prisma.integration.update({
        where: { id: integration.id },
        data: {
          config: nextConfig,
          lastSyncAt: new Date(),
          errorMessage: null,
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
            type: 'faceid_attendance',
            action: 'remove_user_external_map',
            externalUserId,
          },
        },
      });

      return { success: true, removed: true };
    }),

  rotateFaceIdToken: adminProcedure
    .input(z.object({}))
    .mutation(async ({ ctx }) => {
      const integration = await prisma.integration.findUnique({
        where: {
          tenantId_type: {
            tenantId: ctx.tenantId,
            type: 'faceid_attendance',
          },
        },
      });
      if (!integration) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Face ID integration is not connected.',
        });
      }

      const webhookToken = buildFaceIdWebhookToken();
      const webhookTokenHash = hashFaceIdWebhookToken(webhookToken);
      const existingConfig = asObject(integration.config);
      const nextConfig = {
        ...existingConfig,
        enabled: true,
        webhookUrl: `${getPublicApiBaseUrl()}/webhooks/faceid`,
        webhookTokenHash,
        lastValidatedAt: new Date().toISOString(),
      };

      const updated = await prisma.integration.update({
        where: { id: integration.id },
        data: {
          status: 'active',
          tokensEncrypted: encryptIntegrationTokens({ webhookToken }),
          config: nextConfig,
          lastSyncAt: new Date(),
          errorMessage: null,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'integration_update',
          resource: 'integration',
          resourceId: updated.id,
          metadata: { type: 'faceid_attendance', action: 'rotate_webhook_token' },
        },
      });

      return {
        success: true,
        webhookToken,
        webhookUrl: String(nextConfig.webhookUrl || ''),
      };
    }),

  getFaceIdStatus: adminProcedure.query(async ({ ctx }) => {
    const integration = await prisma.integration.findUnique({
      where: {
        tenantId_type: {
          tenantId: ctx.tenantId,
          type: 'faceid_attendance',
        },
      },
      select: {
        status: true,
        config: true,
        lastSyncAt: true,
        tokensEncrypted: true,
      },
    });

    if (!integration || integration.status !== 'active') {
      return {
        connected: false,
        webhookUrl: `${getPublicApiBaseUrl()}/webhooks/faceid`,
        hasToken: false,
        branchWhitelist: [] as string[],
        unmatchedUserPolicy: 'store' as 'store' | 'ignore',
        lastSyncAt: null as string | null,
        health: {
          webhookPending: 0,
          webhookFailedLast24h: 0,
          webhookProcessedLast24h: 0,
          eventsLast7d: 0,
          unmatchedEventsLast7d: 0,
          matchedEventsLast7d: 0,
          anomaliesLast7d: 0,
        },
        recentWebhookErrors: [] as Array<{
          id: string;
          createdAt: string;
          errorMessage: string | null;
          eventType: string;
        }>,
      };
    }

    const config = asObject(integration.config);
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7dLocal = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last7dDateKey = toTashkentDateKey(last7dLocal);
    const todayDateKey = toTashkentDateKey(now);

    const [
      webhookPending,
      webhookFailedLast24h,
      webhookProcessedLast24h,
      eventsLast7d,
      unmatchedEventsLast7d,
      anomaliesLast7d,
      recentWebhookErrors,
    ] = await Promise.all([
      prisma.webhookEvent.count({
        where: {
          tenantId: ctx.tenantId,
          source: 'faceid',
          processed: false,
        },
      }),
      prisma.webhookEvent.count({
        where: {
          tenantId: ctx.tenantId,
          source: 'faceid',
          createdAt: { gte: last24h },
          errorMessage: { not: null },
        },
      }),
      prisma.webhookEvent.count({
        where: {
          tenantId: ctx.tenantId,
          source: 'faceid',
          createdAt: { gte: last24h },
          processed: true,
        },
      }),
      prisma.attendanceEvent.count({
        where: {
          tenantId: ctx.tenantId,
          localDate: {
            gte: last7dDateKey,
            lte: todayDateKey,
          },
        },
      }),
      prisma.attendanceEvent.count({
        where: {
          tenantId: ctx.tenantId,
          userId: null,
          localDate: {
            gte: last7dDateKey,
            lte: todayDateKey,
          },
        },
      }),
      prisma.attendanceDaySummary.count({
        where: {
          tenantId: ctx.tenantId,
          summaryDate: {
            gte: last7dDateKey,
            lte: todayDateKey,
          },
          OR: [{ anomalyCount: { gt: 0 } }, { absence: true }],
        },
      }),
      prisma.webhookEvent.findMany({
        where: {
          tenantId: ctx.tenantId,
          source: 'faceid',
          errorMessage: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          createdAt: true,
          errorMessage: true,
          eventType: true,
        },
      }),
    ]);

    return {
      connected: true,
      webhookUrl: String(config.webhookUrl || `${getPublicApiBaseUrl()}/webhooks/faceid`),
      hasToken: Boolean(integration.tokensEncrypted),
      branchWhitelist: normalizeBranchWhitelist(
        Array.isArray(config.branchWhitelist) ? (config.branchWhitelist as string[]) : [],
      ),
      unmatchedUserPolicy: normalizeUnmatchedUserPolicy(config.unmatchedUserPolicy),
      lastSyncAt: integration.lastSyncAt ? integration.lastSyncAt.toISOString() : null,
      lastValidatedAt: typeof config.lastValidatedAt === 'string' ? config.lastValidatedAt : null,
      health: {
        webhookPending,
        webhookFailedLast24h,
        webhookProcessedLast24h,
        eventsLast7d,
        unmatchedEventsLast7d,
        matchedEventsLast7d: Math.max(eventsLast7d - unmatchedEventsLast7d, 0),
        anomaliesLast7d,
      },
      recentWebhookErrors: recentWebhookErrors.map((item) => ({
        id: item.id,
        createdAt: item.createdAt.toISOString(),
        errorMessage: item.errorMessage,
        eventType: item.eventType,
      })),
    };
  }),

  disconnect: adminProcedure
    .input(z.object({ type: z.enum(['amocrm', 'telegram', 'google_sheets', 'voip_utel', 'faceid_attendance', 'meta_ads']) }))
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
