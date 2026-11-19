import { resolveDataScope } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveCallerDataScope } from '../../lib/access';
import { asObject } from '../../lib/object';
import { router, protectedProcedure, adminProcedure } from '../trpc';

/** Roles that see the salary / bonus configuration (`settings.salary`) in full. */
const SALARY_SETTINGS_READ_ROLES = ['Admin', 'Manager', 'Finance'];

/**
 * How much of `settings.salary` (bonus rules, plans, KPI, every user's fixed salary) a caller may read:
 * all of it for Admin / Manager / Finance, the config with only the online group's fixed salaries for
 * OnlineAdmin, nothing for anyone else.
 */
export function salarySettingsVisibility(roles: readonly string[]): 'full' | 'online' | 'none' {
  if (roles.some((role) => SALARY_SETTINGS_READ_ROLES.includes(role))) return 'full';
  const scope = resolveDataScope(roles);

  return roles.includes('OnlineAdmin') && scope.kind === 'group' && scope.group === 'online' ? 'online' : 'none';
}

/**
 * Tenant settings as a caller may see them: `salary` removed, or (for `allowedFixedSalaryUserIds`) its
 * `fixedSalaries` limited to those users. Other keys (dashboard lead rules, notification chat) are kept.
 */
export function redactTenantSettings(settings: unknown, visibility: 'full' | 'online' | 'none', allowedFixedSalaryUserIds: readonly string[] = []): unknown {
  const settingsObject = asObject(settings);

  if (visibility === 'full' || !settingsObject || !('salary' in settingsObject)) return settings;
  const { salary, ...rest } = settingsObject;

  if (visibility === 'none') return rest;
  const salaryObject = asObject(salary) || {};
  const allowed = new Set(allowedFixedSalaryUserIds);
  const fixedSalaries = Array.isArray(salaryObject.fixedSalaries)
    ? salaryObject.fixedSalaries.filter((row) => allowed.has(String(asObject(row)?.userId ?? '')))
    : salaryObject.fixedSalaries;

  return { ...rest, salary: { ...salaryObject, fixedSalaries } };
}

export const tenantRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const tenant = await ctx.db.tenant.findUnique({
      where: { id: ctx.tenantId },
    });

    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const visibility = salarySettingsVisibility(ctx.user.roles);

    if (visibility === 'full') return tenant;
    const allowedUserIds = visibility === 'online'
      ? (await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db)).userIds ?? []
      : [];

    return { ...tenant, settings: redactTenantSettings(tenant.settings, visibility, allowedUserIds) as Prisma.JsonValue };
  }),

  update: adminProcedure
    .input(
      z.object({
        name: z.string().min(2).max(120).optional(),
        settings: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const tenant = await ctx.db.tenant.findUnique({
        where: { id: ctx.tenantId },
      });

      if (!tenant) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      }

      const baseSettings =
        tenant.settings &&
        typeof tenant.settings === 'object' &&
        !Array.isArray(tenant.settings)
          ? (tenant.settings as Record<string, unknown>)
          : {};

      const nextSettings = input.settings
        ? { ...baseSettings, ...input.settings }
        : baseSettings;
      const settingsPayload = input.settings
        ? JSON.parse(JSON.stringify(nextSettings)) as Prisma.InputJsonValue
        : undefined;

      const updated = await ctx.db.tenant.update({
        where: { id: ctx.tenantId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.settings ? { settings: settingsPayload } : {}),
        },
      });

      await ctx.db.auditLog.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.user.userId,
          action: 'tenant_update',
          resource: 'tenant',
          resourceId: ctx.tenantId,
          metadata: {
            updatedFields: Object.keys(input),
          },
        },
      });

      return updated;
    }),
});
