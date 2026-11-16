/**
 * Role checks used to scope data for agents.
 */
import type { DbClient } from '@dashboarduz/db';
import { hasAgentRole } from '@dashboarduz/shared';

/** Roles that see every manager's data even when they also hold an agent role. */
export const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);

/** True for users with an agent role and no privileged role. */
export function isAgentOnly(roles: string[]): boolean {
  return hasAgentRole(roles) && !roles.some((role) => PRIVILEGED_ROLES.has(role));
}

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
