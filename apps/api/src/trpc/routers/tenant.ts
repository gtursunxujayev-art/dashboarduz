import { router, protectedProcedure, adminProcedure } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Prisma } from '@prisma/client';

export const tenantRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
    });

    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    return tenant;
  }),

  update: adminProcedure
    .input(
      z.object({
        name: z.string().min(2).max(120).optional(),
        settings: z.record(z.any()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenant = await prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
      });
      if (!tenant) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      }

      const baseSettings =
        tenant.settings &&
        typeof tenant.settings === 'object' &&
        !Array.isArray(tenant.settings)
          ? (tenant.settings as Record<string, unknown>)
          : {};

      const nextSettings = input.settings
        ? { ...baseSettings, ...input.settings }
        : baseSettings;

      const updated = await prisma.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.settings ? { settings: nextSettings as Prisma.InputJsonValue } : {}),
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'tenant_update',
          resource: 'tenant',
          resourceId: ctx.tenantId,
          metadata: {
            updatedFields: Object.keys(input),
          },
        },
      });

      return updated;
    }),
});
