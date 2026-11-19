// Shared types across the application

export type TenantPlan = 'free' | 'pro' | 'enterprise';

export const USER_ROLES = [
  'Admin',
  'OnlineAdmin',
  'Manager',
  'TeamLeader',
  'OnlineTeamLeader',
  'OfflineTeamLeader',
  'Agent',
  'OnlineAgent',
  'OfflineAgent',
  'Dashboard',
  'OfflineDashboard',
  'Finance',
  'Tashkiliy',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const AGENT_ROLES = ['Agent', 'OnlineAgent', 'OfflineAgent'] as const;

/** Team leaders read their group's data. A plain `TeamLeader` (from before the split) is offline. */
export const TEAM_LEADER_ROLES = ['TeamLeader', 'OnlineTeamLeader', 'OfflineTeamLeader'] as const;

export function hasTeamLeaderRole(roles: readonly string[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.some((role) => (TEAM_LEADER_ROLES as readonly string[]).includes(role));
}

export type AccessGroup = 'online' | 'offline';

/** The sales group of a user from their roles: online or offline agent / team leader. */
export function resolveRoleGroup(roles: readonly string[] | null | undefined): AccessGroup | null {
  if (!Array.isArray(roles)) return null;
  if (roles.includes('OnlineAgent') || roles.includes('OnlineTeamLeader')) return 'online';
  if (roles.includes('OfflineAgent') || roles.includes('OfflineTeamLeader') || roles.includes('TeamLeader')) return 'offline';

  return null;
}

/**
 * Whose data a user may see, and whether they may change it:
 * - `all`: the whole company (Admin, Manager, Finance, Tashkiliy, leaderboard screens).
 * - `group`: the agents of one sales group. OnlineAdmin may change it; team leaders only read it
 *   (and enter their own sales).
 * - `self`: only their own rows (sales agents).
 */
export type DataScope =
  | { kind: 'all' }
  | { kind: 'group'; group: AccessGroup; canWrite: boolean }
  | { kind: 'self' };

export function resolveDataScope(roles: readonly string[] | null | undefined): DataScope {
  const list = Array.isArray(roles) ? roles : [];
  const has = (role: string) => list.includes(role);

  if (has('Admin') || has('Manager') || has('Finance')) return { kind: 'all' };
  if (has('OnlineAdmin')) return { kind: 'group', group: 'online', canWrite: true };
  if (has('OnlineTeamLeader')) return { kind: 'group', group: 'online', canWrite: false };
  if (has('OfflineTeamLeader') || has('TeamLeader')) return { kind: 'group', group: 'offline', canWrite: false };
  if (hasAgentRole(list)) return { kind: 'self' };

  return { kind: 'all' };
}

/** Admin, or OnlineAdmin for online data: who may use the admin tools at all. */
export function isAdminLike(roles: readonly string[] | null | undefined): boolean {
  return Array.isArray(roles) && (roles.includes('Admin') || roles.includes('OnlineAdmin'));
}

/**
 * Roles that see every user's data (attendance, bonus operations), and that make a user with an agent role
 * more than an agent ({@link isAgentOnly}).
 */
export const PRIVILEGED_ROLES = ['Admin', 'OnlineAdmin', 'Manager', 'TeamLeader', 'OnlineTeamLeader', 'OfflineTeamLeader', 'Finance'] as const;

export function hasPrivilegedRole(roles: readonly string[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.some((role) => (PRIVILEGED_ROLES as readonly string[]).includes(role));
}

export function hasAgentRole(roles: readonly string[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.some((role) => (AGENT_ROLES as readonly string[]).includes(role));
}

export type AuthProvider = 'phone' | 'telegram' | 'email';

export type IntegrationType = 'amocrm' | 'telegram' | 'google_sheets' | 'faceid_attendance';

export type IntegrationStatus = 'pending' | 'active' | 'error' | 'disconnected';

export type NotificationType = 'telegram' | 'email' | 'sms';

export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'retrying';

export type CallDirection = 'inbound' | 'outbound';

export type CallStatus = 'completed' | 'failed' | 'missed' | 'busy';

export interface TenantContext {
  tenantId: string;
  userId?: string;
  roles?: UserRole[];
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore: boolean;
    cursor?: string;
  };
}

/** An agent role and no privileged role. */
export function isAgentOnly(roles: readonly string[]): boolean {
  return hasAgentRole(roles) && !hasPrivilegedRole(roles);
}

/** Finance, and no admin, Manager, team leader or agent role. */
export function isFinanceOnly(roles: readonly string[]): boolean {
  return roles.includes('Finance') && !roles.some((role) => (
    role === 'Admin'
    || role === 'OnlineAdmin'
    || role === 'Manager'
    || (TEAM_LEADER_ROLES as readonly string[]).includes(role)
    || (AGENT_ROLES as readonly string[]).includes(role)
  ));
}

/** Tashkiliy, and no Admin, Manager, TeamLeader, agent or Finance role. */
export function isTashkiliyOnly(roles: readonly string[]): boolean {
  return roles.includes('Tashkiliy')
    && !roles.includes('Admin')
    && !roles.includes('OnlineAdmin')
    && !roles.includes('Manager')
    && !hasTeamLeaderRole(roles)
    && !hasAgentRole(roles)
    && !roles.includes('Finance');
}

/** Roles whose users are linked to an amoCRM manager (their calls and leads are counted through that link). */
export const MANAGER_MAPPING_ROLES: readonly UserRole[] = [...AGENT_ROLES, ...TEAM_LEADER_ROLES];

export function roleNeedsManagerMapping(role: string): boolean {
  return (MANAGER_MAPPING_ROLES as readonly string[]).includes(role);
}
