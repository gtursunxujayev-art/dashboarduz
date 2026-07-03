// Shared types across the application

export type TenantPlan = 'free' | 'pro' | 'enterprise';

export const USER_ROLES = ['Admin', 'Manager', 'TeamLeader', 'Agent', 'OnlineAgent', 'OfflineAgent', 'Dashboard', 'OfflineDashboard', 'Finance', 'Tashkiliy'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const AGENT_ROLES = ['Agent', 'OnlineAgent', 'OfflineAgent'] as const;

export function hasAgentRole(roles: readonly string[] | null | undefined): boolean {
  return Array.isArray(roles) && roles.some((role) => (AGENT_ROLES as readonly string[]).includes(role));
}

export type AuthProvider = 'phone' | 'telegram' | 'email';

export type IntegrationType = 'amocrm' | 'telegram' | 'google_sheets' | 'voip_utel' | 'faceid_attendance';

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
