/**
 * Turns a caller's resolved data scope (lib/access `resolveCallerDataScope`) into the filters the
 * dashboard and bonus reads apply. `null` lists mean "no filter" (the whole company).
 */
import { TRPCError } from '@trpc/server';

import type { ResolvedDataScope } from '../../lib/access';

type ScopeLists = Pick<ResolvedDataScope, 'userIds' | 'amoResponsibleIds'>;

/** `managerUserId` filter for incomes / calls: nothing for the whole company, else the scope's users. */
export function scopedManagerWhere(scope: Pick<ResolvedDataScope, 'userIds'>): { managerUserId?: { in: string[] } } {
  return scope.userIds ? { managerUserId: { in: scope.userIds } } : {};
}

/** `id` filter for user lists (agents, sellers): nothing for the whole company, else the scope's users. */
export function scopedUserIdWhere(scope: Pick<ResolvedDataScope, 'userIds'>): { id?: { in: string[] } } {
  return scope.userIds ? { id: { in: scope.userIds } } : {};
}

/** amoCRM responsible-user filter for lead queries (`undefined` = every responsible user). */
export function scopedResponsibleIds(scope: Pick<ResolvedDataScope, 'amoResponsibleIds'>): string[] | undefined {
  return scope.amoResponsibleIds ? [...scope.amoResponsibleIds] : undefined;
}

/**
 * Whether amoCRM leads can be queried for the scope. A scope whose users have no amoCRM link has
 * nothing to show; querying with an empty responsible filter could return every lead instead.
 */
export function canQueryScopedLeads(scope: ScopeLists): boolean {
  return scope.amoResponsibleIds === null || scope.amoResponsibleIds.length > 0;
}

/** Whether a user id is inside the scope. */
export function isUserIdInScope(scope: Pick<ResolvedDataScope, 'userIds'>, userId: string): boolean {
  return scope.userIds === null || scope.userIds.includes(userId);
}

/** Keeps only the rows of users inside the scope. */
export function filterRowsToScope<T>(scope: Pick<ResolvedDataScope, 'userIds'>, rows: readonly T[], getUserId: (row: T) => string | null | undefined): T[] {
  if (scope.userIds === null) return [...rows];
  const allowed = new Set(scope.userIds);

  return rows.filter((row) => {
    const id = getUserId(row);

    return Boolean(id) && allowed.has(id as string);
  });
}

/** Rejects a requested user (e.g. a `managerUserId` filter) outside the caller's scope. */
export function assertUserIdInScope(scope: Pick<ResolvedDataScope, 'userIds'>, userId: string | null | undefined): void {
  if (userId && !isUserIdInScope(scope, userId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This user is outside your access scope.' });
  }
}

/**
 * The income filter for a report that may also be narrowed to one manager: the requested manager when
 * given (it must be inside the scope), otherwise the scope itself.
 */
export function resolveManagerFilter(scope: Pick<ResolvedDataScope, 'userIds'>, requestedManagerUserId?: string | null): { managerUserId?: string | { in: string[] } } {
  if (requestedManagerUserId) {
    assertUserIdInScope(scope, requestedManagerUserId);

    return { managerUserId: requestedManagerUserId };
  }

  return scopedManagerWhere(scope);
}

/**
 * The users a per-agent report shows: the caller alone for agents, otherwise the requested user (which
 * must be inside the scope) or every user of the scope.
 */
export function pickScopedUsers<T extends { id: string }>(
  scope: Pick<ResolvedDataScope, 'scope' | 'userIds'>,
  users: readonly T[],
  params: { callerId: string; requestedUserId?: string | null },
): { users: T[]; selectedUserId: string | undefined; agentScoped: boolean } {
  const agentScoped = scope.scope.kind === 'self';
  const selectedUserId = agentScoped ? params.callerId : (params.requestedUserId || undefined);

  assertUserIdInScope(scope, selectedUserId);
  const inScope = filterRowsToScope(scope, users, (user) => user.id);

  return {
    users: selectedUserId ? inScope.filter((user) => user.id === selectedUserId) : inScope,
    selectedUserId,
    agentScoped,
  };
}
