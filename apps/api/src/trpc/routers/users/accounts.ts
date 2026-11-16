import { roleNeedsManagerMapping, USER_ROLES, type UserRole } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { hashPassword } from '../../../services/auth/password';
import { generatePassword, generateUniqueLogin, isTelegramMappingConflictError, validateNormalizedPhoneOrThrow } from '../../../services/users/accounts';
import { adminProcedure, managerProcedure } from '../../trpc';

export const roleSchema = z.enum(USER_ROLES);

export const userAccountProcedures = {
  create: managerProcedure
    .input(
      z.object({
        name: z.string().max(120).optional(),
        phone: z.string().max(32).optional(),
        role: roleSchema,
        amocrmResponsibleUserId: z.string().optional(),
        utelManagerExternalId: z.string().optional(),
        telegramChatId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const loginSeed = input.name?.trim() || input.role.toLowerCase();
      const username = await generateUniqueLogin(loginSeed, ctx.db);
      const plainPassword = generatePassword(12);
      const passwordHash = await hashPassword(plainPassword);

      const role = input.role as UserRole;

      if (roleNeedsManagerMapping(role) && !input.amocrmResponsibleUserId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'AmoCRM manager mapping is required for Agent/OnlineAgent/OfflineAgent/TeamLeader users.',
        });
      }

      const createData: any = {
        tenantId: ctx.tenantId,
        name: input.name?.trim() || null,
        phone: validateNormalizedPhoneOrThrow(input.phone),
        username,
        passwordHash,
        authProvider: 'email',
        roles: [role],
      };

      if (createData.phone) {
        const existingByPhone = await ctx.db.user.findFirst({
          where: {
            tenantId: ctx.tenantId,
            phone: createData.phone,
          },
          select: { id: true },
        });

        if (existingByPhone?.id) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Bu telefon raqam boshqa foydalanuvchiga biriktirilgan.',
          });
        }
      }

      if (roleNeedsManagerMapping(role)) {
        createData.amocrmResponsibleUserId = input.amocrmResponsibleUserId || null;
        createData.utelManagerExternalId = input.utelManagerExternalId || null;
      }
      createData.telegramId = input.telegramChatId || null;

      let created: { id: string; username: string | null; name: string | null; roles: string[] };

      try {
        created = await ctx.db.user.create({
          data: createData,
          select: {
            id: true,
            username: true,
            name: true,
            roles: true,
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
          action: 'user_create',
          resource: 'user',
          resourceId: created.id,
          metadata: {
            role,
            phone: createData.phone,
            amocrmResponsibleUserId: input.amocrmResponsibleUserId || null,
            utelManagerExternalId: input.utelManagerExternalId || null,
            telegramChatId: input.telegramChatId || null,
          },
        },
      });

      return {
        user: created,
        credentials: {
          login: username,
          password: plainPassword,
        },
      };
    }),
  updateName: managerProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        name: z.string().max(120).optional(),
        phone: z.string().max(32).optional(),
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
          name: true,
          phone: true,
        },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      const normalizedNameRaw = input.name?.trim();
      const normalizedName = normalizedNameRaw ? normalizedNameRaw : null;
      const normalizedPhone = validateNormalizedPhoneOrThrow(input.phone);

      if (normalizedPhone) {
        const existingByPhone = await ctx.db.user.findFirst({
          where: {
            tenantId: ctx.tenantId,
            phone: normalizedPhone,
            NOT: { id: user.id },
          },
          select: { id: true },
        });

        if (existingByPhone?.id) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Bu telefon raqam boshqa foydalanuvchiga biriktirilgan.',
          });
        }
      }

      const updated = await ctx.db.user.update({
        where: { id: user.id },
        data: {
          name: normalizedName,
          phone: normalizedPhone,
        },
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          phone: true,
          roles: true,
          amocrmResponsibleUserId: true,
          utelManagerExternalId: true,
          telegramId: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'user_name_update',
          resource: 'user',
          resourceId: user.id,
          metadata: {
            previousName: user.name || null,
            nextName: normalizedName,
            previousPhone: user.phone || null,
            nextPhone: normalizedPhone,
          },
        },
      });

      return updated;
    }),
  setActive: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        isActive: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.userId && input.isActive === false) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "O'zingizni deaktivatsiya qila olmaysiz.",
        });
      }

      const target = await ctx.db.user.findFirst({
        where: {
          id: input.userId,
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
          isActive: true,
          name: true,
          username: true,
        },
      });

      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      if (target.isActive === input.isActive) {
        return {
          success: true,
          user: {
            id: target.id,
            isActive: target.isActive,
          },
        };
      }

      const updated = await ctx.db.user.update({
        where: { id: target.id },
        data: { isActive: input.isActive },
        select: {
          id: true,
          isActive: true,
        },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: input.isActive ? 'user_activate' : 'user_deactivate',
          resource: 'user',
          resourceId: target.id,
          metadata: {
            previousIsActive: target.isActive,
            nextIsActive: input.isActive,
            targetLabel: target.name || target.username || target.id,
          },
        },
      });

      return {
        success: true,
        user: updated,
      };
    }),
};
