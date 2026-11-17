import { systemPrisma } from '@dashboarduz/db';
import type { UserRole } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { hashPassword } from '../../../services/auth/password';
import { generatePassword, isTelegramMappingConflictError, rolesNeedManagerMapping } from '../../../services/users/accounts';
import { managerProcedure } from '../../trpc';

import { roleSchema } from './accounts';

export const userAccessProcedures = {
  updateRole: managerProcedure
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
        },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      let previousAmoResponsibleUserId: string | null = null;

      if (rolesNeedManagerMapping(input.roles as UserRole[])) {
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

      const updateData: any = {
        roles: input.roles as UserRole[],
      };

      if (rolesNeedManagerMapping(input.roles as UserRole[])) {
        updateData.amocrmResponsibleUserId = input.amocrmResponsibleUserId || previousAmoResponsibleUserId || null;
      }
      updateData.telegramId = input.telegramChatId || null;

      let updated: {
        id: string;
        username: string | null;
        name: string | null;
        email: string | null;
        phone: string | null;
        roles: string[];
        amocrmResponsibleUserId: string | null;
        telegramId: string | null;
        isActive: boolean;
        lastLoginAt: Date | null;
        createdAt: Date;
      };

      try {
        updated = await ctx.db.user.update({
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
        });
      } catch (error: any) {
        if (isTelegramMappingConflictError(error)) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: "Tanlangan Telegram foydalanuvchisi allaqachon boshqa akkauntga biriktirilgan.",
          });
        }
        throw error;
      }

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
  updateCredentials: managerProcedure
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
        },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

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
