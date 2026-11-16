import { asObject } from '../../lib/object';

export function resolveUserLabel(user: { name: string | null; username: string | null; id: string } | null | undefined): string {
  if (!user) return "qo'lda";

  return user.name || user.username || user.id;
}

export function extractRelinkedRepaymentIds(metadata: unknown): string[] {
  const obj = asObject(metadata);
  const raw = obj?.relinkedRepaymentIds;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((value) => String(value || '').trim())
    .filter((value) => /^[0-9a-f-]{36}$/i.test(value));
}
