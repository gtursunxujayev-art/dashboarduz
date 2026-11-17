/**
 * The tenant's `settings` JSON, read by the bonus, dashboard and funnel procedures.
 */
import type { DbClient } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { asObjectOrEmpty } from './object';

/** The tenant's `settings`; NOT_FOUND ("Tenant not found") when the tenant does not exist. */
export async function loadTenantSettings(db: DbClient, tenantId: string): Promise<Prisma.JsonValue> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });

  if (!tenant) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
  }

  return tenant.settings;
}

/** `settings` with `patch` merged into `settings.salary`. */
export function withSalarySettings(settings: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const settingsObject = asObjectOrEmpty(settings);

  return {
    ...settingsObject,
    salary: {
      ...asObjectOrEmpty(settingsObject.salary),
      ...patch,
    },
  };
}

/** Saves the tenant's settings and writes a `tenant_settings` audit row (`resourceId` defaults to the tenant). */
export async function saveTenantSettings(params: {
  db: DbClient;
  tenantId: string;
  actorUserId: string;
  settings: unknown;
  auditAction: string;
  auditResourceId?: string;
  auditMetadata?: Prisma.InputJsonObject;
}): Promise<void> {
  await params.db.tenant.update({
    where: { id: params.tenantId },
    data: {
      settings: JSON.parse(JSON.stringify(params.settings)) as Prisma.InputJsonValue,
    },
  });

  await params.db.auditLog.create({
    data: {
      tenantId: params.tenantId,
      userId: params.actorUserId,
      action: params.auditAction,
      resource: 'tenant_settings',
      resourceId: params.auditResourceId ?? params.tenantId,
      ...(params.auditMetadata ? { metadata: params.auditMetadata } : {}),
    },
  });
}
