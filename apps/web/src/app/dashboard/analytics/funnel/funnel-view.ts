import { toApiDateRange, type ExtendedDashboardRange } from '@/lib/date-range';

export type FunnelGroup = 'all' | 'online' | 'offline';
export type FunnelStageRef = { pipelineId: string; statusId: string };
export type FunnelHole = 'aktivlik' | 'taklif' | 'yopish' | 'chek';
export type FunnelPipelineOption = {
  id: string;
  name: string;
  statuses: Array<{ id: string; name: string }>;
};

export const RANGE_OPTIONS: Array<{ value: ExtendedDashboardRange; label: string }> = [
  { value: 'today', label: 'Bugun' },
  { value: 'week', label: 'Shu hafta' },
  { value: 'month', label: 'Shu oy' },
  { value: 'last_week', label: "O'tgan hafta" },
  { value: 'last_month', label: "O'tgan oy" },
  { value: 'custom', label: 'Ixtiyoriy' },
];

export const GROUP_OPTIONS: Array<{ value: FunnelGroup; label: string }> = [
  { value: 'all', label: 'Barchasi' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Oflayn' },
];

export const HOLE_LABELS: Record<FunnelHole, string> = {
  aktivlik: 'Aktivlik',
  taklif: 'Taklif',
  yopish: 'Yopish',
  chek: 'Chek',
};

export const STAGE_STORAGE_KEYS = {
  ishlangan: 'dashboarduz-funnel-ishlangan-stage',
  taklif: 'dashboarduz-funnel-taklif-stage',
} as const;

export function serializeStageRef(ref: FunnelStageRef | null): string {
  return ref ? `${ref.pipelineId}:${ref.statusId}` : '';
}

export function parseStageRef(value: string | null | undefined): FunnelStageRef | null {
  if (!value) return null;
  const [pipelineId, statusId, ...rest] = value.split(':');
  if (rest.length || !pipelineId || !statusId) return null;
  return { pipelineId, statusId };
}

export function isStageRefValid(ref: FunnelStageRef | null, pipelines: FunnelPipelineOption[]): boolean {
  if (!ref) return false;
  const pipeline = pipelines.find((item) => item.id === ref.pipelineId);
  return Boolean(pipeline?.statuses.some((status) => status.id === ref.statusId));
}

export function buildFunnelQueryInput(params: {
  range: ExtendedDashboardRange;
  dateFrom: string;
  dateTo: string;
  group: FunnelGroup;
  ishlangan: FunnelStageRef | null;
  taklif: FunnelStageRef | null;
  refreshKey: number;
}, now: Date = new Date()) {
  return {
    ...toApiDateRange(params.range, { dateFrom: params.dateFrom, dateTo: params.dateTo }, now),
    group: params.group,
    ishlanganStage: params.ishlangan,
    taklifStage: params.taklif,
    refreshKey: params.refreshKey,
  };
}

export function formatAmount(value: number | null | undefined): string {
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} so'm`;
}

export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value);
}
