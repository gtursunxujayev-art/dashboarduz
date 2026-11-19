/**
 * Role checks used to scope data for agents.
 */
import type { DbClient } from '@dashboarduz/db';
import { type AccessGroup, type DataScope, isAdminLike, isAgentOnly, resolveDataScope, resolveRoleGroup } from '@dashboarduz/shared';

/**
 * For agent-only users, the amoCRM responsible-user id their data is limited to
 * (`null` when not linked); other users are not scoped. Tolerates databases that
 * predate the `amocrmResponsibleUserId` column.
 */
export async function getAgentResponsibleScope(tenantId: string, userId: string, roles: string[], db: DbClient) {
  if (!isAgentOnly(roles)) {
    return { isScoped: false, responsibleUserId: null as string | null };
  }

  let currentUser: { amocrmResponsibleUserId: string | null } | null = null;

  try {
    currentUser = await db.user.findFirst({
      where: {
        id: userId,
        tenantId,
        isActive: true,
      },
      select: {
        amocrmResponsibleUserId: true,
      },
    });
  } catch (error) {
    if (!String((error as Error | undefined)?.message || '').includes('amocrmResponsibleUserId')) {
      throw error;
    }
  }

  return {
    isScoped: true,
    responsibleUserId: currentUser?.amocrmResponsibleUserId || null,
  };
}

export type ResolvedDataScope = {
  scope: DataScope;
  /** Users whose rows the caller may see (`managerUserId` filter); `null` = everyone. */
  userIds: string[] | null;
  /** amoCRM responsible-user ids of those users (lead / call filters); `null` = everyone. */
  amoResponsibleIds: string[] | null;
  /** Whether the caller may change other users' rows inside the scope. */
  canWriteOthers: boolean;
};

/**
 * The single rule for "whose data": all for Admin/Manager/Finance, the online or offline group for
 * OnlineAdmin and team leaders (including deactivated members, whose history still counts), only
 * themself for sales agents. Use `userIds` as a `managerUserId: { in }` filter when it is not null.
 */
export async function resolveCallerDataScope(
  tenantId: string,
  userId: string,
  roles: readonly string[],
  db: DbClient,
): Promise<ResolvedDataScope> {
  const scope = resolveDataScope(roles);

  if (scope.kind === 'all') {
    return { scope, userIds: null, amoResponsibleIds: null, canWriteOthers: isAdminLike(roles) || roles.includes('Manager') };
  }
  if (scope.kind === 'self') {
    const self = await db.user.findFirst({ where: { id: userId, tenantId }, select: { amocrmResponsibleUserId: true } });

    return {
      scope,
      userIds: [userId],
      amoResponsibleIds: self?.amocrmResponsibleUserId ? [self.amocrmResponsibleUserId] : [],
      canWriteOthers: false,
    };
  }
  const members = await db.user.findMany({
    where: { tenantId, roles: { hasSome: [...groupRoles(scope.group)] } },
    select: { id: true, roles: true, amocrmResponsibleUserId: true },
  });
  const inGroup = members.filter((member) => resolveRoleGroup(member.roles) === scope.group);
  const userIds = Array.from(new Set([userId, ...inGroup.map((member) => member.id)]));

  return {
    scope,
    userIds,
    amoResponsibleIds: inGroup.map((member) => member.amocrmResponsibleUserId).filter((id): id is string => Boolean(id)),
    canWriteOthers: scope.canWrite,
  };
}

/** Roles that put a user in a sales group. */
export function groupRoles(group: AccessGroup): readonly string[] {
  return group === 'online' ? ['OnlineAgent', 'OnlineTeamLeader'] : ['OfflineAgent', 'OfflineTeamLeader', 'TeamLeader'];
}

/** Whether a user (by roles) belongs to the caller's scope. */
export function isUserInScope(scope: DataScope, callerId: string, target: { id: string; roles: readonly string[] }): boolean {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'self') return target.id === callerId;

  return target.id === callerId || resolveRoleGroup(target.roles) === scope.group;
}
