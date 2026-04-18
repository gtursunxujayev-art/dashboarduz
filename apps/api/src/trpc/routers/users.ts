import { managerProcedure, router } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { z } from 'zod';
import type { UserRole } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import crypto from 'crypto';
import { hashPassword } from '../../services/auth/password';
import { getTenantAmoCRMContext } from '../../services/integrations/amocrm-live';
import { amocrmService } from '../../services/integrations/amocrm';
import { parseTelegramRecipients } from '../../services/integrations/telegram-recipients';

const roleSchema = z.enum(['Admin', 'Manager', 'TeamLeader', 'Agent', 'Finance', 'Tashkiliy']);
const MAPPING_ROLES: UserRole[] = ['Agent', 'TeamLeader'];

function roleNeedsManagerMapping(role: UserRole): boolean {
  return MAPPING_ROLES.includes(role);
}

function rolesNeedManagerMapping(roles: UserRole[]): boolean {
  return roles.some((role) => roleNeedsManagerMapping(role));
}

function isMissingUserMappingColumnError(error: unknown) {
  const message = String((error as any)?.message || '');
  return (
    message.includes('amocrmResponsibleUserId')
    || message.includes('utelManagerExternalId')
    || message.includes('telegramId')
  );
}

function isTelegramMappingConflictError(error: unknown): boolean {
  const errorCode = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    (errorCode === 'P2002' && message.includes('telegramid'))
    || message.includes('users_telegramid_key')
    || message.includes('telegramid')
  );
}

function toNormalizedText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeDigits(value: unknown): string {
  return String(value || '').replace(/[^\d]/g, '');
}

function isAllowedUtelManagerExtension(value: unknown): boolean {
  const digits = normalizeDigits(value);
  if (!digits) {
    return false;
  }
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed >= 100 && parsed <= 150;
}

function extractUtelManagerFromMetadata(metadata: unknown): { key: string; label: string } | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const data = metadata as Record<string, unknown>;
  const managerName = toNormalizedText(
    data.normalized_manager
    || data.manager
    || data.manager_name
    || data.agent
    || data.user
    || data.operator
    || data.responsible
    || data.employee,
  );
  const extensionRaw = toNormalizedText(
    data.normalized_extension
    || data.extension
    || data.ext
    || data.internal
    || data.line,
  );
  const extensionDigits = normalizeDigits(extensionRaw);

  if (!isAllowedUtelManagerExtension(extensionDigits)) {
    return null;
  }

  const key = extensionDigits;
  const label = managerName ? `${managerName} (${extensionDigits})` : extensionDigits;
  return {
    key,
    label,
  };
}

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
  amocrmManagers: managerProcedure.query(async ({ ctx }) => {
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

  utelManagers: managerProcedure.query(async ({ ctx }) => {
    const calls = await prisma.call.findMany({
      where: {
        tenantId: ctx.tenantId,
        provider: 'utel',
      },
      orderBy: { startedAt: 'desc' },
      take: 3000,
      select: {
        metadata: true,
      },
    });

    const uniqueManagers = new Map<string, string>();
    for (const call of calls) {
      const extracted = extractUtelManagerFromMetadata(call.metadata);
      if (!extracted) {
        continue;
      }
      if (!uniqueManagers.has(extracted.key)) {
        uniqueManagers.set(extracted.key, extracted.label);
      }
    }

    const mappedUsers = await prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        utelManagerExternalId: { not: null },
      },
      select: {
        name: true,
        username: true,
        utelManagerExternalId: true,
      },
      take: 1000,
    });

    for (const user of mappedUsers) {
      const extensionDigits = normalizeDigits(user.utelManagerExternalId || '');
      if (!isAllowedUtelManagerExtension(extensionDigits)) {
        continue;
      }
      if (!uniqueManagers.has(extensionDigits)) {
        const labelSource = toNormalizedText(user.name || user.username || '');
        uniqueManagers.set(extensionDigits, labelSource ? `${labelSource} (${extensionDigits})` : extensionDigits);
      }
    }

    return Array.from(uniqueManagers.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }),

  telegramRecipients: managerProcedure.query(async ({ ctx }) => {
    const integration = await prisma.integration.findUnique({
      where: {
        tenantId_type: {
          tenantId: ctx.tenantId,
          type: 'telegram',
        },
      },
      select: {
        status: true,
        config: true,
      },
    });

    if (!integration || integration.status !== 'active') {
      return [];
    }

    return parseTelegramRecipients(integration.config)
      .filter((recipient) => recipient.started)
      .map((recipient) => ({
        id: recipient.chatId,
        name: recipient.displayName,
        username: recipient.username,
        lastSeenAt: recipient.lastSeenAt,
      }));
  }),

  list: managerProcedure.query(async ({ ctx }) => {
    try {
      return await prisma.user.findMany({
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
          utelManagerExternalId: true,
          telegramId: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
    } catch (error: any) {
      if (!isMissingUserMappingColumnError(error)) {
        throw error;
      }

      const fallback = await prisma.user.findMany({
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

      return (fallback as Array<{
        id: string;
        username: string | null;
        name: string | null;
        email: string | null;
        phone: string | null;
        roles: string[];
        isActive: boolean;
        lastLoginAt: Date | null;
        createdAt: Date;
      }>).map((user) => ({
        ...user,
        amocrmResponsibleUserId: null,
        utelManagerExternalId: null,
        telegramId: null,
      }));
    }
  }),

  create: managerProcedure
    .input(
      z.object({
        name: z.string().max(120).optional(),
        role: roleSchema,
        amocrmResponsibleUserId: z.string().optional(),
        utelManagerExternalId: z.string().optional(),
        telegramChatId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const loginSeed = input.name?.trim() || input.role.toLowerCase();
      const username = await generateUniqueLogin(loginSeed);
      const plainPassword = generatePassword(12);
      const passwordHash = await hashPassword(plainPassword);

      const role = input.role as UserRole;
      if (roleNeedsManagerMapping(role) && !input.amocrmResponsibleUserId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'AmoCRM manager mapping is required for Agent/TeamLeader users.',
        });
      }

      const createData: any = {
        tenantId: ctx.tenantId,
        name: input.name?.trim() || null,
        username,
        passwordHash,
        authProvider: 'email',
        roles: [role],
      };

      if (roleNeedsManagerMapping(role)) {
        createData.amocrmResponsibleUserId = input.amocrmResponsibleUserId || null;
        createData.utelManagerExternalId = input.utelManagerExternalId || null;
      }
      createData.telegramId = input.telegramChatId || null;

      let created: { id: string; username: string | null; name: string | null; roles: string[] };
      try {
        created = await prisma.user.create({
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
        if (isMissingUserMappingColumnError(error)) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'User mapping columns are missing. Run database migrations first.',
          });
        }
        throw error;
      }

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'user_create',
          resource: 'user',
          resourceId: created.id,
          metadata: {
            role,
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
          name: true,
        },
      });

      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      const normalizedNameRaw = input.name?.trim();
      const normalizedName = normalizedNameRaw ? normalizedNameRaw : null;

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          name: normalizedName,
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

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'user_name_update',
          resource: 'user',
          resourceId: user.id,
          metadata: {
            previousName: user.name || null,
            nextName: normalizedName,
          },
        },
      });

      return updated;
    }),

  updateRole: managerProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        roles: z.array(roleSchema).min(1),
        amocrmResponsibleUserId: z.string().optional(),
        utelManagerExternalId: z.string().optional(),
        telegramChatId: z.string().optional(),
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
        },
      });
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      let previousAmoResponsibleUserId: string | null = null;
      let previousUtelManagerExternalId: string | null = null;
      if (rolesNeedManagerMapping(input.roles as UserRole[])) {
        try {
          const mappingSource = await prisma.user.findFirst({
            where: {
              id: input.userId,
              tenantId: ctx.tenantId,
            },
            select: {
              amocrmResponsibleUserId: true,
              utelManagerExternalId: true,
            },
          });
          previousAmoResponsibleUserId = mappingSource?.amocrmResponsibleUserId || null;
          previousUtelManagerExternalId = mappingSource?.utelManagerExternalId || null;
        } catch (error: any) {
          if (isMissingUserMappingColumnError(error)) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'User mapping columns are missing. Run database migrations first.',
            });
          }
          throw error;
        }
      }

      const updateData: any = {
        roles: input.roles as UserRole[],
      };
      if (rolesNeedManagerMapping(input.roles as UserRole[])) {
        updateData.amocrmResponsibleUserId = input.amocrmResponsibleUserId || previousAmoResponsibleUserId || null;
        updateData.utelManagerExternalId = input.utelManagerExternalId || previousUtelManagerExternalId || null;
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
        utelManagerExternalId: string | null;
        telegramId: string | null;
        isActive: boolean;
        lastLoginAt: Date | null;
        createdAt: Date;
      };
      try {
        updated = await prisma.user.update({
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
            utelManagerExternalId: true,
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

      await prisma.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'user_role_update',
          resource: 'user',
          resourceId: user.id,
          metadata: {
            roles: input.roles,
            amocrmResponsibleUserId: input.amocrmResponsibleUserId || null,
            utelManagerExternalId: input.utelManagerExternalId || null,
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
