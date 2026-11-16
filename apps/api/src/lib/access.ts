/**
 * Role checks used to scope data for agents.
 */
import type { DbClient } from '@dashboarduz/db';
import { isAgentOnly } from '@dashboarduz/shared';

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
