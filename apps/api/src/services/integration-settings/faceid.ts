import crypto from 'crypto';

import type { DbClient } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

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

/** The tenant's Face ID integration (`id`, `config`), or PRECONDITION_FAILED when it is not connected. */
export async function requireFaceIdIntegration(db: DbClient, tenantId: string): Promise<{ id: string; config: Prisma.JsonValue }> {
  const integration = await db.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'faceid_attendance',
      },
    },
    select: {
      id: true,
      config: true,
    },
  });

  if (!integration) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Face ID integration is not connected.',
    });
  }

  return integration;
}

/** Saves a new Face ID config (clearing the error) and writes the `integration_update` audit row. */
export async function saveFaceIdConfig(params: {
  db: DbClient;
  tenantId: string;
  actorUserId: string;
  integrationId: string;
  config: Prisma.InputJsonObject;
  auditMetadata: Prisma.InputJsonObject;
}): Promise<void> {
  await params.db.integration.update({
    where: { id: params.integrationId },
    data: {
      config: params.config,
      lastSyncAt: new Date(),
      errorMessage: null,
    },
  });

  await params.db.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.actorUserId,
      action: 'integration_update',
      resource: 'integration',
      resourceId: params.integrationId,
      metadata: {
        type: 'faceid_attendance',
        ...params.auditMetadata,
      },
    },
  });
}
