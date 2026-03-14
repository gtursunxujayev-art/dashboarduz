import { router, adminProcedure } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { z } from 'zod';
import type { UserRole } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

const roleSchema = z.enum(['Admin', 'Manager', 'Agent']);

export const usersRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return prisma.user.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        phone: true,
        roles: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }),

  updateRole: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        roles: z.array(roleSchema).min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const user = await prisma.user.findFirst({
        where: {
          id: input.userId,
          tenantId: ctx.tenantId,
        },
      });
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          roles: input.roles as UserRole[],
        },
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          phone: true,
          roles: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'user_role_update',
          resource: 'user',
          resourceId: user.id,
          metadata: { roles: input.roles },
        },
      });

      return updated;
    }),
});
