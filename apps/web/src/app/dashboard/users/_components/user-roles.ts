export const availableRoles = ['Admin', 'OnlineAdmin', 'Manager', 'TeamLeader', 'OnlineTeamLeader', 'OfflineTeamLeader', 'Agent', 'OnlineAgent', 'OfflineAgent', 'Dashboard', 'OfflineDashboard', 'Finance', 'Tashkiliy'] as const;

export const roleLabels: Record<(typeof availableRoles)[number], string> = {
  Admin: 'Admin',
  OnlineAdmin: 'Online admin',
  Manager: 'Menejer',
  TeamLeader: 'Team lider (oflayn, eski)',
  OnlineTeamLeader: 'Online team lider',
  OfflineTeamLeader: 'Oflayn team lider',
  Agent: 'Agent',
  OnlineAgent: 'Online agent',
  OfflineAgent: 'Offline agent',
  Dashboard: 'Dashboard',
  OfflineDashboard: 'Offline dashboard',
  Finance: 'Moliya',
  Tashkiliy: 'Tashkiliy',
};

export type UserRole = (typeof availableRoles)[number];

/** Roles an OnlineAdmin may give (the server enforces the same list). */
export const ONLINE_ADMIN_ASSIGNABLE_ROLES: readonly UserRole[] = ['OnlineAgent', 'OnlineTeamLeader', 'Dashboard'];

/** Roles the signed-in user may give in the create/edit forms. */
export function assignableRoles(callerRoles: readonly string[]): readonly UserRole[] {
  if (callerRoles.includes('Admin')) return availableRoles;
  if (callerRoles.includes('Manager')) return availableRoles.filter((role) => role !== 'Admin' && role !== 'OnlineAdmin');
  if (callerRoles.includes('OnlineAdmin')) return ONLINE_ADMIN_ASSIGNABLE_ROLES;

  return [];
}

export type ManagerOption = { id: string; name: string };
export type TelegramRecipientOption = { id: string; name: string; username?: string | null };
