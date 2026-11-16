import type { CourseTypeCategory } from '@dashboarduz/shared';

export const AGENT_ROLES = new Set(['Agent', 'OnlineAgent', 'OfflineAgent']);

export const CATEGORY_LABELS: Record<CourseTypeCategory, string> = {
  online: 'Online',
  offline: 'Oflayn',
  intensive: 'Intensiv',
};

export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export type CourseTypeSalesViewProps = {
  category: CourseTypeCategory;
  title?: string;
  description?: string;
};
