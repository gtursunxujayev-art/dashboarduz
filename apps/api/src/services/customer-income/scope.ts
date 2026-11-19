/**
 * Who may see and change which income / customer rows. The data scope itself comes from
 * `resolveCallerDataScope` (lib/access.ts); these helpers turn it into Prisma filters and write checks.
 */
import type { DbClient } from '@dashboarduz/db';
import { type DataScope, resolveDataScope } from '@dashboarduz/shared';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { type ResolvedDataScope, resolveCallerDataScope } from '../../lib/access';
import { classifyCourseCategoryFromField } from '../dashboard/catalog-fields';

type ScopeCaller = {
  tenantId: string;
  user: { userId: string; roles: string[] };
  db: DbClient;
};

/** The caller's data scope (whose income rows they may see). */
export function resolveIncomeScope(ctx: ScopeCaller): Promise<ResolvedDataScope> {
  return resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);
}

/** `managerUserId` filter for income rows; empty when the caller sees everyone. */
export function incomeManagerWhere(userIds: readonly string[] | null): Prisma.IncomeWhereInput {
  return userIds ? { managerUserId: { in: [...userIds] } } : {};
}

/** Customers having at least one income (matching `incomeWhere`) by a user in scope; empty when unscoped. */
export function customerInScopeWhere(
  userIds: readonly string[] | null,
  incomeWhere: Prisma.IncomeWhereInput = {},
): Prisma.CustomerWhereInput {
  return userIds ? { incomes: { some: { ...incomeWhere, managerUserId: { in: [...userIds] } } } } : {};
}

/** Customers an admin-like caller may edit: one with an income by a user in scope, or one without any income yet. */
export function writableCustomerWhere(userIds: readonly string[] | null): Prisma.CustomerWhereInput {
  return userIds
    ? { OR: [{ incomes: { some: { managerUserId: { in: [...userIds] } } } }, { incomes: { none: {} } }] }
    : {};
}

/**
 * Users the caller may create income / adjustment requests for; `null` = anyone. Agents and team leaders
 * only for themselves (team leaders only read their group), OnlineAdmin for anyone in the online group.
 */
export function resolveIncomeWriterIds(resolved: Pick<ResolvedDataScope, 'scope' | 'userIds'>, callerId: string): string[] | null {
  const { scope } = resolved;

  if (scope.kind === 'all') return null;
  if (scope.kind === 'group' && scope.canWrite) return resolved.userIds ? [...resolved.userIds] : [callerId];

  return [callerId];
}

/** Whether `managerUserId` is one of the writer ids (`null` = anyone). */
export function canActForManager(writerIds: readonly string[] | null, managerUserId: string | null | undefined): boolean {
  if (writerIds === null) return true;

  return Boolean(managerUserId) && writerIds.includes(managerUserId as string);
}

/** FORBIDDEN unless the row's manager is in scope (`userIds` null = everyone). */
export function assertManagerInScope(userIds: readonly string[] | null, managerUserId: string | null | undefined, message?: string): void {
  if (!canActForManager(userIds, managerUserId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: message ?? "Bu yozuv sizning guruhingizga tegishli emas." });
  }
}

/** Whether a course of this category is inside the scope (group scope = only that group's category). */
export function isCourseCategoryInScope(scope: DataScope, category: string | null | undefined): boolean {
  if (scope.kind !== 'group') return true;

  return classifyCourseCategoryFromField(category) === scope.group;
}

/** FORBIDDEN unless the course category is inside the scope. */
export function assertCourseCategoryInScope(scope: DataScope, category: string | null | undefined): void {
  if (!isCourseCategoryInScope(scope, category)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Faqat online kurslarni tahrirlash mumkin.' });
  }
}

const CATALOG_EDITOR_ROLES = new Set(['Admin', 'Manager', 'OnlineAdmin']);

/** Who may change the course catalog: Admin, Manager and OnlineAdmin (online courses only). */
export function canEditCourseCatalog(roles: readonly string[]): boolean {
  return roles.some((role) => CATALOG_EDITOR_ROLES.has(role));
}

/** The data scope a catalog editor works in (OnlineAdmin: the online group). */
export function catalogScope(roles: readonly string[]): DataScope {
  return resolveDataScope(roles);
}
