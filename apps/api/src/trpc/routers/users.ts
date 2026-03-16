import { router, adminProcedure } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { z } from 'zod';
import type { UserRole } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import crypto from 'crypto';
import { hashPassword } from '../../services/auth/password';
import { getTenantAmoCRMContext } from '../../services/integrations/amocrm-live';
import { amocrmService } from '../../services/integrations/amocrm';

const roleSchema = z.enum(['Admin', 'Manager', 'Agent', 'Finance']);

function normalizeLoginSeed(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'user';
}

function generatePassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i += 1) {
    const byte = bytes[i] ?? 0;
    result += alphabet[byte % alphabet.length];
  }
  return result;
}

async function generateUniqueLogin(seed: string) {
  const base = normalizeLoginSeed(seed);

  for (let i = 0; i < 20; i += 1) {
    const suffix = crypto.randomBytes(2).toString('hex');
    const candidate = `${base}.${suffix}`;
    const exists = await prisma.user.findFirst({
      where: { username: candidate },
      select: { id: true },
    });
    if (!exists) {
      return candidate;
    }
  }

  return `${base}.${Date.now()}`;
}

export const usersRouter = router({
  amocrmManagers: adminProcedure.query(async ({ ctx }) => {
    const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
    if (!amoContext) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'AmoCRM integration is not connected.',
      });
    }

    const users = await amocrmService.fetchAllUsers(amoContext.accessToken, { limit: 250 }, amoContext.baseUrl);
    return users
      .map((user) => ({
        id: String(user.id || ''),
        name: String(user.name || user.login || user.email || user.id || 'Unknown'),
        email: user.email || null,
        isActive: user.is_active !== false,
      }))
      .filter((user) => user.id.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }),

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
        amocrmResponsibleUserId: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().max(120).optional(),
        role: roleSchema,
        amocrmResponsibleUserId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const loginSeed = input.name?.trim() || input.role.toLowerCase();
      const username = await generateUniqueLogin(loginSeed);
      const plainPassword = generatePassword(12);
      const passwordHash = await hashPassword(plainPassword);

      const role = input.role as UserRole;
      if (role === 'Agent' && !input.amocrmResponsibleUserId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'AmoCRM manager mapping is required for Agent users.',
        });
      }

      const created = await prisma.user.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name?.trim() || null,
          username,
          passwordHash,
          authProvider: 'email',
          roles: [role],
          amocrmResponsibleUserId: role === 'Agent' ? input.amocrmResponsibleUserId || null : null,
        },
        select: {
          id: true,
          username: true,
          name: true,
          roles: true,
          amocrmResponsibleUserId: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'user_create',
          resource: 'user',
          resourceId: created.id,
          metadata: {
            role,
            amocrmResponsibleUserId: created.amocrmResponsibleUserId,
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

  updateRole: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        roles: z.array(roleSchema).min(1),
        amocrmResponsibleUserId: z.string().optional(),
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
          amocrmResponsibleUserId: input.roles.includes('Agent')
            ? (input.amocrmResponsibleUserId || user.amocrmResponsibleUserId || null)
            : null,
        },
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          phone: true,
          roles: true,
          amocrmResponsibleUserId: true,
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

  updateCredentials: adminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        username: z.string().min(3).max(50).optional(),
        password: z.string().min(8).optional(),
        generatePassword: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const user = await prisma.user.findFirst({
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
        const duplicate = await prisma.user.findFirst({
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

      const updated = await prisma.user.update({
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

      await prisma.auditLog.create({
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
});
