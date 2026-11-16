import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { asObjectOrEmpty } from '../../../lib/object';
import { parseFaceIdUserExternalMap } from '../../../services/integration-settings/faceid';
import { adminProcedure } from '../../trpc';

export const faceIdMappingProcedures = {
  getFaceIdMappings: adminProcedure.query(async ({ ctx }) => {
    const integration = await ctx.db.integration.findUnique({
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
      ? await ctx.db.user.findMany({
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
      const integration = await ctx.db.integration.findUnique({
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

      const user = await ctx.db.user.findFirst({
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
        ...asObjectOrEmpty(integration.config),
        userExternalMap: nextMap,
        lastValidatedAt: new Date().toISOString(),
      };

      await ctx.db.integration.update({
        where: { id: integration.id },
        data: {
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
      const integration = await ctx.db.integration.findUnique({
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
        ...asObjectOrEmpty(integration.config),
        userExternalMap: nextMap,
        lastValidatedAt: new Date().toISOString(),
      };

      await ctx.db.integration.update({
        where: { id: integration.id },
        data: {
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
};
