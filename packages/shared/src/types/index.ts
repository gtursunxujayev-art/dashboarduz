// Shared types across the application

export type TenantPlan = 'free' | 'pro' | 'enterprise';

export type UserRole = 'Admin' | 'Manager' | 'Agent';

export type AuthProvider = 'phone' | 'google' | 'telegram' | 'email';

export type IntegrationType = 'amocrm' | 'telegram' | 'google_sheets' | 'voip_utel';

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
