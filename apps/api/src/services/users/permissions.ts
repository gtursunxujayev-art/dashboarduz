/**
 * Who may manage which user accounts. Before this, any TeamLeader could change any user's roles
 * (including making themself Admin) and reset any Admin's password.
 */
import { resolveRoleGroup } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';

const ADMIN_ROLES = ['Admin', 'OnlineAdmin'];

/** Roles an OnlineAdmin may give: online staff and the online leaderboard screen. */
export const ONLINE_ADMIN_ASSIGNABLE_ROLES = ['OnlineAgent', 'OnlineTeamLeader', 'Dashboard'] as const;

function forbid(message: string): never {
  throw new TRPCError({ code: 'FORBIDDEN', message });
}

/** Throws unless the caller may give exactly these roles. */
export function assertCanAssignRoles(callerRoles: readonly string[], roles: readonly string[]): void {
  if (callerRoles.includes('Admin')) return;
  if (callerRoles.includes('Manager')) {
    if (roles.some((role) => ADMIN_ROLES.includes(role))) forbid("Admin rolini faqat Admin bera oladi.");

    return;
  }
  if (callerRoles.includes('OnlineAdmin')) {
    if (roles.some((role) => !(ONLINE_ADMIN_ASSIGNABLE_ROLES as readonly string[]).includes(role))) {
      forbid("Online admin faqat onlayn rollarni bera oladi.");
    }

    return;
  }
  forbid("Foydalanuvchilarni o'zgartirishga ruxsat yo'q.");
}

/** Throws unless the caller may change this existing account (name, roles, login, password, active). */
export function assertCanManageUser(
  callerRoles: readonly string[],
  callerId: string,
  target: { id: string; roles?: readonly string[] | null },
): void {
  if (callerRoles.includes('Admin')) return;
  const targetRoles = target.roles ?? [];
  const targetIsAdmin = targetRoles.some((role) => ADMIN_ROLES.includes(role));

  if (callerRoles.includes('Manager')) {
    if (targetIsAdmin) forbid("Admin hisobini faqat Admin o'zgartira oladi.");

    return;
  }
  if (callerRoles.includes('OnlineAdmin')) {
    if (target.id === callerId) return;
    const onlineOnly = targetRoles.length > 0
      && targetRoles.every((role) => (ONLINE_ADMIN_ASSIGNABLE_ROLES as readonly string[]).includes(role));

    if (!onlineOnly || (resolveRoleGroup(targetRoles) !== 'online' && !targetRoles.includes('Dashboard'))) {
      forbid("Online admin faqat onlayn xodimlarni o'zgartira oladi.");
    }

    return;
  }
  forbid("Foydalanuvchilarni o'zgartirishga ruxsat yo'q.");
}
