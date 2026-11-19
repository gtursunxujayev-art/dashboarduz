import { systemPrisma } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { hashPassword } from '../../../services/auth/password';
import { generatePassword, withTelegramMappingConflict, rolesNeedManagerMapping } from '../../../services/users/accounts';
import { assertCanAssignRoles, assertCanManageUser } from '../../../services/users/permissions';
import { userAdminProcedure } from '../../trpc';

import { roleSchema } from './accounts';

export const userAccessProcedures = {
  updateRole: userAdminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        roles: z.array(roleSchema).min(1),
        amocrmResponsibleUserId: z.string().optional(),
        telegramChatId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.db.user.findFirst({
        where: {
          id: input.userId,
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
          roles: true,
        },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      assertCanManageUser(ctx.user.roles, ctx.user.userId, user);
      assertCanAssignRoles(ctx.user.roles, input.roles);

      let previousAmoResponsibleUserId: string | null = null;

      if (rolesNeedManagerMapping(input.roles)) {
        const mappingSource = await ctx.db.user.findFirst({
          where: {
            id: input.userId,
            tenantId: ctx.tenantId,
          },
          select: {
            amocrmResponsibleUserId: true,
          },
        });

        previousAmoResponsibleUserId = mappingSource?.amocrmResponsibleUserId || null;
      }

      const updateData: Prisma.UserUncheckedUpdateInput = {
        roles: input.roles,
      };

      if (rolesNeedManagerMapping(input.roles)) {
        updateData.amocrmResponsibleUserId = input.amocrmResponsibleUserId || previousAmoResponsibleUserId || null;
      }
      updateData.telegramId = input.telegramChatId || null;

      const updated = await withTelegramMappingConflict(() => ctx.db.user.update({
        where: { id: user.id },
        data: updateData,
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          phone: true,
          roles: true,
          amocrmResponsibleUserId: true,
          telegramId: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }));

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'user_role_update',
          resource: 'user',
          resourceId: user.id,
          metadata: {
            roles: input.roles,
            amocrmResponsibleUserId: input.amocrmResponsibleUserId || null,
            telegramChatId: input.telegramChatId || null,
          },
        },
      });

      return updated;
    }),
  updateCredentials: userAdminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        username: z.string().min(3).max(50).optional(),
        password: z.string().min(8).optional(),
        generatePassword: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.db.user.findFirst({
        where: {
          id: input.userId,
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
          username: true,
          roles: true,
        },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      assertCanManageUser(ctx.user.roles, ctx.user.userId, user);

      const normalizedUsername = input.username?.trim().toLowerCase();

      if (normalizedUsername && normalizedUsername !== user.username) {
        // users.username is unique across ALL tenants; this check deliberately uses the unscoped systemPrisma so it
        // still sees other tenants' logins once RLS is enforced (ctx.db would only see this tenant).
        const duplicate = await systemPrisma.user.findFirst({
          where: {
            username: normalizedUsername,
            NOT: { id: user.id },
          },
          select: { id: true },
        });

        if (duplicate) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Login already in use.' });
        }
      }

      let nextPassword = input.password;

      if (input.generatePassword) {
        nextPassword = generatePassword(12);
      }

      if (!normalizedUsername && !nextPassword) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No credentials to update.' });
      }

      const updated = await ctx.db.user.update({
        where: { id: user.id },
        data: {
          ...(normalizedUsername ? { username: normalizedUsername } : {}),
          ...(nextPassword ? { passwordHash: await hashPassword(nextPassword) } : {}),
        },
        select: {
          id: true,
          username: true,
          name: true,
          roles: true,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'user_credentials_update',
          resource: 'user',
          resourceId: user.id,
          metadata: {
            usernameUpdated: Boolean(normalizedUsername),
            passwordUpdated: Boolean(nextPassword),
          },
        },
      });

      return {
        user: updated,
        ...(input.generatePassword ? { generatedPassword: nextPassword } : {}),
      };
    }),
};
