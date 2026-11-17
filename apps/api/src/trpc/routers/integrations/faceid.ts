import { faceIdConnectSchema, toTashkentDateKey } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asObjectOrEmpty } from '../../../lib/object';
import { hashFaceIdWebhookToken } from '../../../services/attendance/faceid';
import { getPublicApiBaseUrl, upsertActiveIntegration } from '../../../services/integration-settings/connection';
import { buildFaceIdWebhookToken, normalizeBranchWhitelist, normalizeUnmatchedUserPolicy, requireFaceIdIntegration, saveFaceIdConfig } from '../../../services/integration-settings/faceid';
import { encryptIntegrationTokens } from '../../../services/security/encryption';
import { adminProcedure } from '../../trpc';

export const faceIdIntegrationProcedures = {
  connectFaceId: adminProcedure
    .input(faceIdConnectSchema)
    .mutation(async ({ input, ctx }) => {
      const webhookToken = String(input?.webhookToken || '').trim() || buildFaceIdWebhookToken();
      const webhookTokenHash = hashFaceIdWebhookToken(webhookToken);
      const branchWhitelist = normalizeBranchWhitelist(input?.branchWhitelist);
      const unmatchedUserPolicy = normalizeUnmatchedUserPolicy(input?.unmatchedUserPolicy);
      const validatedAt = new Date();
      const webhookUrl = `${getPublicApiBaseUrl()}/webhooks/faceid`;

      const integration = await upsertActiveIntegration({
        db: ctx.db,
        tenantId: ctx.tenantId,
        type: 'faceid_attendance',
        data: {
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
        clearError: true,
        connectAudit: { actorUserId: ctx.user.userId, metadata: { type: 'faceid_attendance' } },
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
      const integration = await requireFaceIdIntegration(ctx.db, ctx.tenantId);

      const existingConfig = asObjectOrEmpty(integration.config);
      const nextConfig = {
        ...existingConfig,
        enabled: true,
        webhookUrl: String(existingConfig.webhookUrl || `${getPublicApiBaseUrl()}/webhooks/faceid`),
        branchWhitelist: normalizeBranchWhitelist(input.branchWhitelist),
        unmatchedUserPolicy: normalizeUnmatchedUserPolicy(input.unmatchedUserPolicy ?? existingConfig.unmatchedUserPolicy),
        lastValidatedAt: new Date().toISOString(),
      };

      await saveFaceIdConfig({
        db: ctx.db,
        tenantId: ctx.tenantId,
        actorUserId: ctx.user.userId,
        integrationId: integration.id,
        config: nextConfig,
        auditMetadata: {
          action: 'update_settings',
          branchWhitelist: nextConfig.branchWhitelist,
          unmatchedUserPolicy: nextConfig.unmatchedUserPolicy,
        },
      });

      return {
        success: true,
        branchWhitelist: nextConfig.branchWhitelist,
        unmatchedUserPolicy: nextConfig.unmatchedUserPolicy as 'store' | 'ignore',
      };
    }),
  rotateFaceIdToken: adminProcedure
    .input(z.object({}))
    .mutation(async ({ ctx }) => {
      const integration = await ctx.db.integration.findUnique({
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
      const existingConfig = asObjectOrEmpty(integration.config);
      const nextConfig = {
        ...existingConfig,
        enabled: true,
        webhookUrl: `${getPublicApiBaseUrl()}/webhooks/faceid`,
        webhookTokenHash,
        lastValidatedAt: new Date().toISOString(),
      };

      const updated = await ctx.db.integration.update({
        where: { id: integration.id },
        data: {
          status: 'active',
          tokensEncrypted: encryptIntegrationTokens({ webhookToken }),
          config: nextConfig,
          lastSyncAt: new Date(),
          errorMessage: null,
        },
      });

      await ctx.db.auditLog.create({
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
    const integration = await ctx.db.integration.findUnique({
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

    const config = asObjectOrEmpty(integration.config);
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
      ctx.db.webhookEvent.count({
        where: {
          tenantId: ctx.tenantId,
          source: 'faceid',
          processed: false,
        },
      }),
      ctx.db.webhookEvent.count({
        where: {
          tenantId: ctx.tenantId,
          source: 'faceid',
          createdAt: { gte: last24h },
          errorMessage: { not: null },
        },
      }),
      ctx.db.webhookEvent.count({
        where: {
          tenantId: ctx.tenantId,
          source: 'faceid',
          createdAt: { gte: last24h },
          processed: true,
        },
      }),
      ctx.db.attendanceEvent.count({
        where: {
          tenantId: ctx.tenantId,
          localDate: {
            gte: last7dDateKey,
            lte: todayDateKey,
          },
        },
      }),
      ctx.db.attendanceEvent.count({
        where: {
          tenantId: ctx.tenantId,
          userId: null,
          localDate: {
            gte: last7dDateKey,
            lte: todayDateKey,
          },
        },
      }),
      ctx.db.attendanceDaySummary.count({
        where: {
          tenantId: ctx.tenantId,
          summaryDate: {
            gte: last7dDateKey,
            lte: todayDateKey,
          },
          OR: [{ anomalyCount: { gt: 0 } }, { absence: true }],
        },
      }),
      ctx.db.webhookEvent.findMany({
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
};
