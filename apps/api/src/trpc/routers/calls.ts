import { router, protectedProcedure } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createVoIPService } from '../../services/integrations/voip';
import { decryptIntegrationTokens } from '../../services/security/encryption';
import { rateLimiter } from '../../services/security/rate-limiter';

const callsListSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
});

const clickToCallSchema = z.object({
  from: z.string().min(3),
  to: z.string().min(3),
  callerId: z.string().optional(),
  recording: z.boolean().optional().default(true),
});

export const callsRouter = router({
  list: protectedProcedure
    .input(callsListSchema)
    .query(async ({ input, ctx }) => {
      const { page, limit, search, status } = input;
      const skip = (page - 1) * limit;

      const where: any = {
        tenantId: ctx.tenantId,
      };

      if (status) {
        where.status = status;
      }
      if (search) {
        where.OR = [
          { from: { contains: search, mode: 'insensitive' } },
          { to: { contains: search, mode: 'insensitive' } },
          { callIdExternal: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.call.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          skip,
          take: limit,
          include: {
            lead: {
              select: { id: true, title: true, status: true },
            },
          },
        }),
        prisma.call.count({ where }),
      ]);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          hasMore: skip + data.length < total,
        },
      };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const call = await prisma.call.findFirst({
        where: {
          id: input.id,
          tenantId: ctx.tenantId,
        },
        include: {
          lead: true,
        },
      });

      if (!call) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Call not found' });
      }

      return call;
    }),

  clickToCall: protectedProcedure
    .input(clickToCallSchema)
    .mutation(async ({ input, ctx }) => {
      const limit = await rateLimiter.isAllowed(ctx.tenantId, 'calls:click-to-call', {
        maxRequests: 60,
        windowMs: 60 * 1000,
        keyPrefix: 'calls',
      });
      if (!limit.allowed) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many click-to-call requests' });
      }

      const integration = await prisma.integration.findFirst({
        where: {
          tenantId: ctx.tenantId,
          type: 'voip_utel',
          status: 'active',
        },
      });
      if (!integration?.tokensEncrypted) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'UTeL integration is not connected' });
      }

      const tokens = decryptIntegrationTokens<{ apiToken?: string }>(integration.tokensEncrypted);
      if (!tokens.apiToken) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'UTeL token is not available' });
      }

      const config = (integration.config as Record<string, unknown> | null) || {};
      const voipService = createVoIPService({
        apiToken: tokens.apiToken,
        apiUrl: String(config.apiUrl || process.env.UTEL_API_URL || 'https://api.utel.uz'),
      });

      const outbound = await voipService.makeCall(input.from, input.to, {
        caller_id: input.callerId,
        recording: input.recording,
      });

      const callIdExternal = String(outbound.call_id || `manual-${Date.now()}`);
      const call = await prisma.call.upsert({
        where: {
          tenantId_callIdExternal: {
            tenantId: ctx.tenantId,
            callIdExternal,
          },
        },
        update: {
          from: input.from,
          to: input.to,
          direction: 'outbound',
          status: outbound.status || 'ringing',
          startedAt: new Date(),
          metadata: outbound,
        },
        create: {
          tenantId: ctx.tenantId,
          callIdExternal,
          from: input.from,
          to: input.to,
          direction: 'outbound',
          status: outbound.status || 'ringing',
          startedAt: new Date(),
          metadata: outbound,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'click_to_call',
          resource: 'call',
          resourceId: call.id,
          metadata: { from: input.from, to: input.to, callIdExternal },
        },
      });

      return {
        callIdExternal,
        status: outbound.status,
        call,
      };
    }),
});
