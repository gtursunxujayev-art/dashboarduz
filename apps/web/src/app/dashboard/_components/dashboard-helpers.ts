import type { ReportRangePreset as DashboardRange } from '@dashboarduz/shared';

export const RANGE_OPTIONS: DashboardRange[] = ['today', 'week', 'month', 'custom'];

export const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);

export type DashboardCard = {
  id: string;
  title: string;
  value: string;
  subtitle: string;
  extra: string | null;
};

export type DashboardCustomSalesWidget = {
  id: string;
  title: string;
  courseId: string;
  tariffId: string | null;
  subTariffId: string | null;
};

export function renderMetricValue(value?: number | null, suffix = ''): string {
  if (value === null || value === undefined) {
    return '-';
  }
  return `${value}${suffix}`;
}

export function getPeriodFollowUpLabel(range: DashboardRange): string {
  if (range === 'week') {
    return 'Haftalik F/U';
  }
  if (range === 'month') {
    return 'Oylik F/U';
  }
  if (range === 'custom') {
    return 'Davr F/U';
  }
  return 'Bugungi F/U';
}
