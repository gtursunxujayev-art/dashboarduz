// Shared types across the application

export type TenantPlan = 'free' | 'pro' | 'enterprise';

export const USER_ROLES = ['Admin', 'Manager', 'TeamLeader', 'Agent', 'OnlineAgent', 'OfflineAgent', 'Dashboard', 'OfflineDashboard', 'Finance', 'Tashkiliy'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const AGENT_ROLES = ['Agent', 'OnlineAgent', 'OfflineAgent'] as const;

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

/** Roles that see every manager's data even when they also hold an agent role. */
export const PRIVILEGED_ROLES: ReadonlySet<string> = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);

/** An agent role and no privileged role. */
export function isAgentOnly(roles: readonly string[]): boolean {
  return hasAgentRole(roles) && !roles.some((role) => PRIVILEGED_ROLES.has(role));
}

/** Finance, and no Admin, Manager, TeamLeader or agent role. */
export function isFinanceOnly(roles: readonly string[]): boolean {
  return roles.includes('Finance') && !roles.some((role) => (
    role === 'Admin'
    || role === 'Manager'
    || role === 'TeamLeader'
    || (AGENT_ROLES as readonly string[]).includes(role)
  ));
}

/** Tashkiliy, and no Admin, Manager, TeamLeader, agent or Finance role. */
export function isTashkiliyOnly(roles: readonly string[]): boolean {
  return roles.includes('Tashkiliy')
    && !roles.includes('Admin')
    && !roles.includes('Manager')
    && !roles.includes('TeamLeader')
    && !hasAgentRole(roles)
    && !roles.includes('Finance');
}

/** Roles whose users are linked to an amoCRM manager (their calls and leads are counted through that link). */
export const MANAGER_MAPPING_ROLES: readonly UserRole[] = [...AGENT_ROLES, 'TeamLeader'];

export function roleNeedsManagerMapping(role: string): boolean {
  return (MANAGER_MAPPING_ROLES as readonly string[]).includes(role);
}
