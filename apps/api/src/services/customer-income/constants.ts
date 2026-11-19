const SALES_MANAGER_ROLES = [
  'Admin',
  'OnlineAdmin',
  'Manager',
  'TeamLeader',
  'OnlineTeamLeader',
  'OfflineTeamLeader',
  'Agent',
  'OnlineAgent',
  'OfflineAgent',
] as const;

export const SALES_MANAGER_ROLE_TOKENS = new Set(
  SALES_MANAGER_ROLES.map((role) => String(role).trim().toLowerCase()),
);

export const COURSE_CATEGORY_VALUES = ['online', 'offline', 'intensive', 'additional_service'] as const;

/** Team leaders only read their group, so they do not approve. OnlineAdmin approves for the online group only. */
export const APPROVER_ROLES_TARIFF_CHANGE = new Set(['Admin', 'OnlineAdmin', 'Manager', 'Organizator', 'Organizer', 'Tashkiliy']);

/** OnlineAdmin approves refunds for the online group only. */
export const APPROVER_ROLES_REFUND = new Set(['Admin', 'OnlineAdmin', 'Finance']);

export const INCOME_LIFECYCLE_PENDING_REFUND = 'pending_refund';

export const INCOME_LIFECYCLE_REFUNDED = 'refunded';

export const ADJUSTMENT_TYPE_REFUND = 'refund';

export const ADJUSTMENT_TYPE_TARIFF_CHANGE = 'tariff_change';

export const ADJUSTMENT_STATUS_PENDING = 'pending';

export const ADJUSTMENT_STATUS_APPROVED = 'approved';

export const ADJUSTMENT_STATUS_REJECTED = 'rejected';

export const REFUND_CARD_NUMBER_REGEX = /^\d{16}$/;

export const CUSTOMER_NUMBER_REGEX = /^\d+$/;

export const TELEGRAM_USERNAME_REGEX = /^@?[A-Za-z0-9_]+$/;

export const REFUND_PAYMENT_GROUP_ENV_KEYS = [
  'PAYMENT_RETURN_GROUP_ID',
  'PAYMENT_RETURN_GROUP_IDS',
  'REFUND_GROUP_ID',
  'REFUND_GROUP_IDS',
  'RETURN_GROUP_ID',
  'RETURN_GROUP_IDS',
] as const;

export const TARIFF_CHANGE_GROUP_ENV_KEYS = [
  'TARIFF_CHANGE_GROUP_ID',
  'TARIFF_CHANGE_GROUP_IDS',
  'COURSE_CHANGE_GROUP_ID',
  'COURSE_CHANGE_GROUP_IDS',
  'CHANGE_GROUP_ID',
  'CHANGE_GROUP_IDS',
] as const;

export const CANONICAL_COURSE_CATEGORIES = new Set(['online', 'offline', 'intensive', 'additional_service']);
