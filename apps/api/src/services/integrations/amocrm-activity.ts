import { type AmoCRMEvent, type AmoCRMTask, amocrmService } from './amocrm';
import { LogLevel, log } from '../observability';

export type AmoCRMActivityMetrics = {
  followUpCount: number;
  noteCount: number;
  stageChangeCount: number;
  overdueFollowUpCount: number;
  todayFollowUpCount: number;
};

type CacheEntry = {
  expiresAt: number;
  value: Map<string, AmoCRMActivityMetrics>;
};

const CACHE_TTL_MS = 60 * 1000;
const metricsCache = new Map<string, CacheEntry>();

function createEmptyMetrics(): AmoCRMActivityMetrics {
  return {
    followUpCount: 0,
    noteCount: 0,
    stageChangeCount: 0,
    overdueFollowUpCount: 0,
    todayFollowUpCount: 0,
  };
}

function cloneMetricsMap(input: Map<string, AmoCRMActivityMetrics>): Map<string, AmoCRMActivityMetrics> {
  return new Map(
    Array.from(input.entries()).map(([key, value]) => [
      key,
      {
        followUpCount: value.followUpCount,
        noteCount: value.noteCount,
        stageChangeCount: value.stageChangeCount,
        overdueFollowUpCount: value.overdueFollowUpCount,
        todayFollowUpCount: value.todayFollowUpCount,
      },
    ]),
  );
}

function toStringId(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function toDate(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      return toDate(asNumber);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return (
      toDate(record.timestamp)
      || toDate(record.ts)
      || toDate(record.value)
      || toDate(record.datetime)
      || toDate(record.date)
      || null
    );
  }

  return null;
}

function isWithinRange(value: Date | null, start: Date, end: Date): boolean {
  if (!value) {
    return false;
  }
  return value >= start && value <= end;
}

function isCompletedTask(task: AmoCRMTask): boolean {
  const value = task.is_completed ?? (task as Record<string, unknown>).completed ?? (task as Record<string, unknown>).isCompleted;
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  const normalized = toStringId(value).toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'done';
}

function isLeadTask(task: AmoCRMTask): boolean {
  const entityType = toStringId(task.entity_type).toLowerCase();
  if (!entityType) {
    return true;
  }
  return entityType === 'lead' || entityType === 'leads';
}

function taskResponsibleUserId(task: AmoCRMTask): string {
  const source = task as Record<string, unknown>;
  const direct = toStringId(task.responsible_user_id);
  if (direct) {
    return direct;
  }

  const nestedResponsible = source.responsible_user as Record<string, unknown> | undefined;
  const nestedByEmbedded = (source._embedded as Record<string, unknown> | undefined)?.responsible_user as Record<string, unknown> | undefined;
  return (
    toStringId(nestedResponsible?.id)
    || toStringId(nestedResponsible?.user_id)
    || toStringId(nestedByEmbedded?.id)
    || toStringId(nestedByEmbedded?.user_id)
    || ''
  );
}

function taskActionDate(task: AmoCRMTask): Date | null {
  return toDate(task.complete_till) || toDate(task.updated_at) || toDate(task.created_at);
}

function taskDueDate(task: AmoCRMTask): Date | null {
  return toDate(task.complete_till);
}

function getTashkentDayBounds(baseDate: Date): { start: Date; end: Date } {
  const offsetMs = 5 * 60 * 60 * 1000;
  const shifted = new Date(baseDate.getTime() + offsetMs);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const start = new Date(Date.UTC(year, month, day) - offsetMs);
  const end = new Date(start.getTime() + (24 * 60 * 60 * 1000) - 1);
  return { start, end };
}

function getTashkentWeekBounds(baseDate: Date): { start: Date; end: Date } {
  const offsetMs = 5 * 60 * 60 * 1000;
  const shifted = new Date(baseDate.getTime() + offsetMs);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const weekDay = shifted.getUTCDay();
  const daysSinceMonday = (weekDay + 6) % 7;
  const start = new Date(Date.UTC(year, month, day - daysSinceMonday) - offsetMs);
  const end = new Date(start.getTime() + (7 * 24 * 60 * 60 * 1000) - 1);
  return { start, end };
}

function getTashkentMonthBounds(baseDate: Date): { start: Date; end: Date } {
  const offsetMs = 5 * 60 * 60 * 1000;
  const shifted = new Date(baseDate.getTime() + offsetMs);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1) - offsetMs);
  const end = new Date(Date.UTC(year, month + 1, 1) - offsetMs - 1);
  return { start, end };
}

function getPeriodFollowUpBounds(
  rangeKind: 'today' | 'week' | 'month' | 'custom' | undefined,
  rangeStart: Date,
  rangeEnd: Date,
): { start: Date; end: Date } {
  const now = new Date();
  if (rangeKind === 'week') {
    return getTashkentWeekBounds(now);
  }
  if (rangeKind === 'month') {
    return getTashkentMonthBounds(now);
  }
  if (rangeKind === 'custom') {
    return { start: rangeStart, end: rangeEnd };
  }
  return getTashkentDayBounds(now);
}

function eventActorUserId(event: AmoCRMEvent): string {
  const objectEvent = event as Record<string, unknown>;
  return toStringId(objectEvent.created_by || objectEvent.user_id || objectEvent.responsible_user_id);
}

function eventDate(event: AmoCRMEvent): Date | null {
  const objectEvent = event as Record<string, unknown>;
  return toDate(objectEvent.created_at || objectEvent.createdAt || objectEvent.date_create);
}

function hasText(value: unknown, token: string): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.toLowerCase().includes(token);
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasText(item, token));
  }

  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => hasText(item, token));
  }

  return false;
}

function isNoteEvent(event: AmoCRMEvent): boolean {
  const objectEvent = event as Record<string, unknown>;
  const eventType = toStringId(objectEvent.type || objectEvent.event_type || objectEvent.name).toLowerCase();
  if (eventType.includes('note')) {
    return true;
  }

  if (hasText(objectEvent, 'note')) {
    return true;
  }

  return false;
}

function isStageChangeEvent(event: AmoCRMEvent): boolean {
  const objectEvent = event as Record<string, unknown>;
  const eventType = toStringId(objectEvent.type || objectEvent.event_type || objectEvent.name).toLowerCase();
  if (
    eventType.includes('status')
    || eventType.includes('stage')
    || eventType.includes('pipeline')
  ) {
    return true;
  }

  const stageKeys = [
    'status_id',
    'status_before',
    'status_after',
    'pipeline_id',
    'pipeline_before',
    'pipeline_after',
    'value_before',
    'value_after',
  ];

  for (const key of stageKeys) {
    if (key in objectEvent && objectEvent[key] !== null && objectEvent[key] !== undefined && String(objectEvent[key]).trim() !== '') {
      if (key === 'value_before' || key === 'value_after') {
        if (hasText(objectEvent[key], 'status') || hasText(objectEvent[key], 'pipeline') || hasText(objectEvent[key], 'stage')) {
          return true;
        }
        continue;
      }
      return true;
    }
  }

  return false;
}

function buildCacheKey(
  tenantId: string,
  managerIds: string[],
  rangeStart: Date,
  rangeEnd: Date,
): string {
  return [
    tenantId,
    rangeStart.toISOString(),
    rangeEnd.toISOString(),
    managerIds.slice().sort().join(','),
  ].join('|');
}

function initializeMetricsMap(managerIds: string[]): Map<string, AmoCRMActivityMetrics> {
  return new Map(managerIds.map((managerId) => [managerId, createEmptyMetrics()]));
}

export async function getAmoCRMActivityMetrics(params: {
  tenantId: string;
  accessToken: string;
  baseUrl?: string;
  managerIds: string[];
  rangeStart: Date;
  rangeEnd: Date;
  rangeKind?: 'today' | 'week' | 'month' | 'custom';
  cacheTtlMs?: number;
}): Promise<Map<string, AmoCRMActivityMetrics>> {
  const managerIds = params.managerIds
    .map((managerId) => managerId.trim())
    .filter(Boolean);

  if (!managerIds.length) {
    return new Map();
  }

  const cacheKey = buildCacheKey(params.tenantId, managerIds, params.rangeStart, params.rangeEnd);
  const cached = metricsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cloneMetricsMap(cached.value);
  }

  const managerIdSet = new Set(managerIds);
  const metricsByManager = initializeMetricsMap(managerIds);

  let tasks: AmoCRMTask[] = [];
  try {
    tasks = await amocrmService.fetchAllTasks(
      params.accessToken,
      {
        responsibleUserIds: managerIds,
        completedOnly: true,
        dateFrom: params.rangeStart,
        dateTo: params.rangeEnd,
        entityType: 'leads',
        limit: 250,
        maxPages: 80,
      },
      params.baseUrl,
    );
  } catch (error: any) {
    try {
      tasks = await amocrmService.fetchAllTasks(
        params.accessToken,
        {
          responsibleUserIds: managerIds,
          completedOnly: true,
          dateFrom: params.rangeStart,
          dateTo: params.rangeEnd,
          limit: 250,
          maxPages: 80,
        },
        params.baseUrl,
      );
      log(LogLevel.WARN, 'AmoCRM activity: tasks fetched with fallback filter', {
        tenantId: params.tenantId,
        warning: String(error?.message || error),
      });
    } catch (fallbackError: any) {
      log(LogLevel.WARN, 'AmoCRM activity: failed to fetch tasks', {
        tenantId: params.tenantId,
        error: String(fallbackError?.message || fallbackError),
      });
      tasks = [];
    }
  }

  for (const task of tasks) {
    if (!isCompletedTask(task) || !isLeadTask(task)) {
      continue;
    }
    const managerId = taskResponsibleUserId(task);
    if (!managerIdSet.has(managerId)) {
      continue;
    }
    if (!isWithinRange(taskActionDate(task), params.rangeStart, params.rangeEnd)) {
      continue;
    }
    const metrics = metricsByManager.get(managerId);
    if (!metrics) {
      continue;
    }
    metrics.followUpCount += 1;
  }

  const { start: todayStart, end: todayEnd } = getTashkentDayBounds(new Date());
  const { start: periodStart, end: periodEnd } = getPeriodFollowUpBounds(
    params.rangeKind,
    params.rangeStart,
    params.rangeEnd,
  );
  let pendingTasks: AmoCRMTask[] = [];
  try {
    pendingTasks = await amocrmService.fetchAllTasks(
      params.accessToken,
      {
        responsibleUserIds: managerIds,
        completed: false,
        dateTo: todayEnd,
        entityType: 'leads',
        limit: 250,
        maxPages: 30,
      },
      params.baseUrl,
    );
  } catch (error: any) {
    try {
      pendingTasks = await amocrmService.fetchAllTasks(
        params.accessToken,
        {
          responsibleUserIds: managerIds,
          completed: false,
          dateTo: todayEnd,
          limit: 250,
          maxPages: 30,
        },
        params.baseUrl,
      );
      log(LogLevel.WARN, 'AmoCRM activity: pending tasks fetched with fallback filter', {
        tenantId: params.tenantId,
        warning: String(error?.message || error),
      });
    } catch (fallbackError: any) {
      log(LogLevel.WARN, 'AmoCRM activity: failed to fetch pending tasks', {
        tenantId: params.tenantId,
        error: String(fallbackError?.message || fallbackError),
      });
      pendingTasks = [];
    }
  }

  for (const task of pendingTasks) {
    if (!isLeadTask(task) || isCompletedTask(task)) {
      continue;
    }
    const managerId = taskResponsibleUserId(task);
    if (!managerIdSet.has(managerId)) {
      continue;
    }
    const dueDate = taskDueDate(task);
    if (!dueDate) {
      continue;
    }
    const metrics = metricsByManager.get(managerId);
    if (!metrics) {
      continue;
    }

    if (dueDate < todayStart) {
      metrics.overdueFollowUpCount += 1;
      continue;
    }
    if (dueDate >= periodStart && dueDate <= periodEnd) {
      metrics.todayFollowUpCount += 1;
    }
  }

  let events: AmoCRMEvent[] = [];
  try {
    events = await amocrmService.fetchAllEvents(
      params.accessToken,
      {
        dateFrom: params.rangeStart,
        dateTo: params.rangeEnd,
        userIds: managerIds,
        entityType: 'lead',
        limit: 250,
        maxPages: 120,
      },
      params.baseUrl,
    );
  } catch (error: any) {
    try {
      events = await amocrmService.fetchAllEvents(
        params.accessToken,
        {
          dateFrom: params.rangeStart,
          dateTo: params.rangeEnd,
          userIds: managerIds,
          limit: 250,
          maxPages: 120,
        },
        params.baseUrl,
      );
      log(LogLevel.WARN, 'AmoCRM activity: events fetched with fallback filter', {
        tenantId: params.tenantId,
        warning: String(error?.message || error),
      });
    } catch (fallbackError: any) {
      log(LogLevel.WARN, 'AmoCRM activity: failed to fetch events', {
        tenantId: params.tenantId,
        error: String(fallbackError?.message || fallbackError),
      });
      events = [];
    }
  }

  for (const event of events) {
    const managerId = eventActorUserId(event);
    if (!managerIdSet.has(managerId)) {
      continue;
    }
    if (!isWithinRange(eventDate(event), params.rangeStart, params.rangeEnd)) {
      continue;
    }
    const metrics = metricsByManager.get(managerId);
    if (!metrics) {
      continue;
    }

    if (isNoteEvent(event)) {
      metrics.noteCount += 1;
      continue;
    }

    if (isStageChangeEvent(event)) {
      metrics.stageChangeCount += 1;
    }
  }

  metricsCache.set(cacheKey, {
    expiresAt: Date.now() + Math.max(5_000, params.cacheTtlMs || CACHE_TTL_MS),
    value: cloneMetricsMap(metricsByManager),
  });

  return metricsByManager;
}

export function summarizeAmoCRMActivityMetrics(
  metricsByManager: Map<string, AmoCRMActivityMetrics>,
): AmoCRMActivityMetrics {
  const totals = createEmptyMetrics();
  for (const metrics of metricsByManager.values()) {
    totals.followUpCount += metrics.followUpCount;
    totals.noteCount += metrics.noteCount;
    totals.stageChangeCount += metrics.stageChangeCount;
    totals.overdueFollowUpCount += metrics.overdueFollowUpCount;
    totals.todayFollowUpCount += metrics.todayFollowUpCount;
  }
  return totals;
}
