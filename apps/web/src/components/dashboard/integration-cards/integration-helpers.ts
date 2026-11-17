import type { IntegrationType as IntegrationId } from '@dashboarduz/shared';

export interface IntegrationConfig {
  webhookUrl?: string | null;
  lastValidatedAt?: string | null;
  connectionMode?: string | null;
  [key: string]: unknown;
}

export interface IntegrationListItem {
  type: IntegrationId | string;
  status: string;
  config?: unknown;
  lastSyncAt?: string | null;
}

interface AmoPipelineStatus {
  id?: string;
  name?: string;
}

export interface AmoPipeline {
  id: string;
  name: string;
  statuses?: AmoPipelineStatus[];
}

export function asIntegrationConfig(value: unknown): IntegrationConfig {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as IntegrationConfig;
  }
  return {};
}

export type TelegramReportRecipient = {
  chatId: string;
  displayName: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  selectedForReports: boolean;
  startedAt?: string | null;
  lastSeenAt?: string | null;
};

export type TelegramReportCourseOption = {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
};

export const integrationCatalog: Array<{
  id: IntegrationId;
  name: string;
  description: string;
  color: string;
}> = [
  {
    id: 'amocrm',
    name: 'AmoCRM',
    description: "Uzoq muddatli token orqali ulanadi: lid/contact sinxroni va webhook qabul qilish.",
    color: 'bg-blue-50 border-blue-200',
  },
  {
    id: 'telegram',
    name: 'Telegram Bot',
    description: "Bot token ulanadi, webhook avtomatik ro'yxatdan o'tadi va xabar yuboradi.",
    color: 'bg-cyan-50 border-cyan-200',
  },
  {
    id: 'google_sheets',
    name: 'Google Sheets',
    description: "MVP uchun vaqtincha o'chirilgan.",
    color: 'bg-gray-50 border-gray-200',
  },
  {
    id: 'faceid_attendance',
    name: 'Face ID Davomat',
    description: "Face ID webhook orqali IN/OUT davomat eventlari qabul qilinadi (Bearer token).",
    color: 'bg-rose-50 border-rose-200',
  },
];

export function statusBadge(status: string) {
  switch (status) {
    case 'active':
      return 'text-green-700 bg-green-100';
    case 'pending':
      return 'text-amber-700 bg-amber-100';
    case 'error':
      return 'text-red-700 bg-red-100';
    default:
      return 'text-gray-700 bg-gray-100';
  }
}

export function statusText(status: string) {
  switch (status) {
    case 'active':
      return 'Ulangan';
    case 'pending':
      return 'Kutilmoqda';
    case 'error':
      return 'Xatolik';
    default:
      return 'Ulanmagan';
  }
}
