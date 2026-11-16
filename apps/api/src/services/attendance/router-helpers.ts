import { TASHKENT_OFFSET_MS } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

const privilegedReadRoles = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);

export function canReadAllUsers(roles: string[]): boolean {
  return roles.some((role) => privilegedReadRoles.has(role));
}

export function parseDateKey(value: string, fieldName: string): string {
  const normalized = String(value || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${fieldName} YYYY-MM-DD formatda bo'lishi kerak.`,
    });
  }

  return normalized;
}

export function parseDateTime(value: string, fieldName: string): Date {
  const parsed = new Date(String(value || '').trim());

  if (Number.isNaN(parsed.getTime())) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `${fieldName} noto'g'ri formatda.`,
    });
  }

  return parsed;
}

export function toLocalTimeValue(date: Date): string {
  const shifted = new Date(date.getTime() + TASHKENT_OFFSET_MS);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  const ss = String(shifted.getUTCSeconds()).padStart(2, '0');

  return `${hh}:${mm}:${ss}`;
}

export function readFaceMatchMeta(rawPayload: unknown): {
  matchReason: string | null;
  matchStepTried: string | null;
  rawUser: { id: string | null; firstName: string | null; lastName: string | null; phone: string | null } | null;
} {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return { matchReason: null, matchStepTried: null, rawUser: null };
  }

  const meta = (rawPayload as Record<string, unknown>).__matchMeta;

  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { matchReason: null, matchStepTried: null, rawUser: null };
  }

  const matchReason = String((meta as Record<string, unknown>).matchReason || '').trim() || null;
  const matchStepTried = String((meta as Record<string, unknown>).matchStepTried || '').trim() || null;
  const rawUserValue = (meta as Record<string, unknown>).rawUser;
  const rawUser =
    rawUserValue && typeof rawUserValue === 'object' && !Array.isArray(rawUserValue)
      ? {
          id: String((rawUserValue as Record<string, unknown>).id || '').trim() || null,
          firstName: String((rawUserValue as Record<string, unknown>).firstName || '').trim() || null,
          lastName: String((rawUserValue as Record<string, unknown>).lastName || '').trim() || null,
          phone: String((rawUserValue as Record<string, unknown>).phone || '').trim() || null,
        }
      : null;

  return { matchReason, matchStepTried, rawUser };
}
