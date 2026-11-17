export const availableRoles = ['Admin', 'Manager', 'TeamLeader', 'Agent', 'OnlineAgent', 'OfflineAgent', 'Dashboard', 'OfflineDashboard', 'Finance', 'Tashkiliy'] as const;

export const roleLabels: Record<(typeof availableRoles)[number], string> = {
  Admin: 'Admin',
  Manager: 'Menejer',
  TeamLeader: 'Team lider',
  Agent: 'Agent',
  OnlineAgent: 'Online agent',
  OfflineAgent: 'Offline agent',
  Dashboard: 'Dashboard',
  OfflineDashboard: 'Offline dashboard',
  Finance: 'Moliya',
  Tashkiliy: 'Tashkiliy',
};

export type UserRole = (typeof availableRoles)[number];

export type ManagerOption = { id: string; name: string };
export type TelegramRecipientOption = { id: string; name: string; username?: string | null };
