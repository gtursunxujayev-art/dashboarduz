import { type AmoCRMEvent, type AmoCRMTask, amocrmService } from './amocrm';
import { LogLevel, log } from '../observability';

export type AmoCRMActivityMetrics = {
  followUpCount: number;
  noteCount: number;
  stageChangeCount: number;
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

  return null;
}

function isWithinRange(value: Date | null, start: Date, end: Date): boolean {
  if (!value) {
    return false;
  }
  return value >= start && value <= end;
}

function isCompletedTask(task: AmoCRMTask): boolean {
  const value = task.is_completed;
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  return toStringId(value) === '1';
}

function isLeadTask(task: AmoCRMTask): boolean {
  const entityType = toStringId(task.entity_type).toLowerCase();
  if (!entityType) {
    return true;
  }
  return entityType === 'lead' || entityType === 'leads';
}

function taskResponsibleUserId(task: AmoCRMTask): string {
  return toStringId(task.responsible_user_id);
}

function taskActionDate(task: AmoCRMTask): Date | null {
  return toDate(task.complete_till) || toDate(task.updated_at) || toDate(task.created_at);
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
    expiresAt: Date.now() + CACHE_TTL_MS,
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
  }
  return totals;
}
