import crypto from 'crypto';

import { asObjectOrEmpty } from '../../lib/object';

export function buildFaceIdWebhookToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function normalizeBranchWhitelist(branchWhitelist?: string[]): string[] {
  if (!Array.isArray(branchWhitelist)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of branchWhitelist) {
    const branch = String(raw || '').trim();

    if (!branch) continue;
    const key = branch.toLowerCase();

    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(branch);
  }

  return normalized;
}

export function normalizeUnmatchedUserPolicy(value: unknown): 'store' | 'ignore' {
  const normalized = String(value || '').trim().toLowerCase();

  return normalized === 'ignore' ? 'ignore' : 'store';
}

export function parseFaceIdUserExternalMap(config: unknown): Record<string, string> {
  const raw = asObjectOrEmpty(asObjectOrEmpty(config).userExternalMap);
  const result: Record<string, string> = {};

  for (const [externalUserIdRaw, userIdRaw] of Object.entries(raw)) {
    const externalUserId = String(externalUserIdRaw || '').trim();
    const userId = String(userIdRaw || '').trim();

    if (!externalUserId || !userId) {
      continue;
    }
    result[externalUserId] = userId;
  }

  return result;
}
