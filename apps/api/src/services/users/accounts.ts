import crypto from 'crypto';

import { systemPrisma } from '@dashboarduz/db';
import { normalizeDigits, roleNeedsManagerMapping, type UserRole } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

export function rolesNeedManagerMapping(roles: UserRole[]): boolean {
  return roles.some((role) => roleNeedsManagerMapping(role));
}

export function isTelegramMappingConflictError(error: unknown): boolean {
  const errorCode = String((error as any)?.code || '');
  const message = String((error as any)?.message || '').toLowerCase();

  return (
    (errorCode === 'P2002' && message.includes('telegramid'))
    || message.includes('users_telegramid_key')
    || message.includes('telegramid')
  );
}

/**
 * Runs a user write; a clash on the Telegram mapping becomes CONFLICT with an Uzbek message, other errors pass.
 */
export async function withTelegramMappingConflict<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isTelegramMappingConflictError(error)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: "Tanlangan Telegram foydalanuvchisi allaqachon boshqa akkauntga biriktirilgan.",
      });
    }
    throw error;
  }
}

export function validateNormalizedPhoneOrThrow(rawPhone: string | undefined): string | null {
  const normalized = normalizeDigits(rawPhone) || null;

  if (!normalized) {
    return null;
  }
  if (normalized.length < 9 || normalized.length > 15) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Telefon raqam noto‘g‘ri formatda. 9-15 ta raqam kiriting.',
    });
  }

  return normalized;
}

function normalizeLoginSeed(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'user';
}

export function generatePassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let result = '';

  for (let i = 0; i < length; i += 1) {
    const byte = bytes[i] ?? 0;

    result += alphabet[byte % alphabet.length];
  }

  return result;
}

/**
 * A login no user in ANY tenant has (users.username is globally unique). The lookup deliberately uses the unscoped
 * systemPrisma: with RLS enforced a tenant-scoped client would only see its own tenant and could hand out a login
 * that another tenant already uses.
 */
export async function generateUniqueLogin(seed: string) {
  const base = normalizeLoginSeed(seed);

  for (let i = 0; i < 20; i += 1) {
    const suffix = crypto.randomBytes(2).toString('hex');
    const candidate = `${base}.${suffix}`;
    const exists = await systemPrisma.user.findFirst({
      where: { username: candidate },
      select: { id: true },
    });

    if (!exists) {
      return candidate;
    }
  }

  return `${base}.${Date.now()}`;
}
