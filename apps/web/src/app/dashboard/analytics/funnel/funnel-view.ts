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

/** Where the first version of the page saved the Taklif stage (read once as a fallback). */
export const LEGACY_TAKLIF_STAGE_KEY = 'dashboarduz-funnel-taklif-stage';

export const FILTERS_STORAGE_KEY = 'dashboarduz-funnel-filters';

export type FunnelFilters = {
  range: ExtendedDashboardRange;
  dateFrom: string;
  dateTo: string;
  group: FunnelGroup;
  pipelineId: string | null;
  taklif: FunnelStageRef | null;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function serializeFilters(filters: FunnelFilters): string {
  return JSON.stringify({
    ...filters,
    taklif: serializeStageRef(filters.taklif),
  });
}

/**
 * Restores saved filters, dropping anything no longer valid (unknown range/group, a funnel or stage
 * that was removed from amoCRM, a stage outside the chosen funnel).
 */
export function parseStoredFilters(
  raw: string | null | undefined,
  defaults: FunnelFilters,
  pipelines: FunnelPipelineOption[],
): FunnelFilters {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object') stored = parsed as Record<string, unknown>;
  } catch {
    stored = {};
  }

  const range = RANGE_OPTIONS.some((option) => option.value === stored.range)
    ? (stored.range as ExtendedDashboardRange)
    : defaults.range;
  const group = GROUP_OPTIONS.some((option) => option.value === stored.group)
    ? (stored.group as FunnelGroup)
    : defaults.group;
  const dateFrom = typeof stored.dateFrom === 'string' && ISO_DAY.test(stored.dateFrom) ? stored.dateFrom : defaults.dateFrom;
  const dateTo = typeof stored.dateTo === 'string' && ISO_DAY.test(stored.dateTo) ? stored.dateTo : defaults.dateTo;
  const pipelineId = typeof stored.pipelineId === 'string' && pipelines.some((pipeline) => pipeline.id === stored.pipelineId)
    ? stored.pipelineId
    : null;
  const stageFor = (value: unknown, fallback: FunnelStageRef | null) => {
    const ref = typeof value === 'string' ? parseStageRef(value) : fallback;
    if (!isStageRefValid(ref, pipelines)) return null;
    return pipelineId && ref?.pipelineId !== pipelineId ? null : ref;
  };

  return {
    range,
    dateFrom,
    dateTo,
    group,
    pipelineId,
    taklif: stageFor(stored.taklif, defaults.taklif),
  };
}

export function stagePipelines(pipelines: FunnelPipelineOption[], pipelineId: string | null): FunnelPipelineOption[] {
  return pipelineId ? pipelines.filter((pipeline) => pipeline.id === pipelineId) : pipelines;
}

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
  pipelineId: string | null;
  taklif: FunnelStageRef | null;
  refreshKey: number;
}, now: Date = new Date()) {
  return {
    ...toApiDateRange(params.range, { dateFrom: params.dateFrom, dateTo: params.dateTo }, now),
    group: params.group,
    pipelineId: params.pipelineId,
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
