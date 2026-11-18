import type { DbClient } from '@dashboarduz/db';
import { TASHKENT_OFFSET_MS } from '@dashboarduz/shared';

import { isCompletedTask, isLeadTask, taskResponsibleUserId, toStringId } from '../../lib/amocrm';
import { errorMessage } from '../../lib/errors';
import { logger } from '../../lib/logger';

import { type AmoCRMEvent, type AmoCRMTask } from './amocrm';
import { getAmoEvents, getAmoTasks } from './amocrm-activity-snapshot-read';

export type AmoCRMActivityMetrics = {
  followUpCount: number;
  noteCount: number;
  stageChangeCount: number;
  overdueFollowUpCount: number;
  todayFollowUpCount: number;
};

export type AmoCRMActivitySourceStatus = {
  ok: boolean;
  reason: string | null;
};

export type AmoCRMActivityDiagnostics = {
  completedTasks: AmoCRMActivitySourceStatus;
  pendingTasks: AmoCRMActivitySourceStatus;
  events: AmoCRMActivitySourceStatus;
};

type CacheEntry = {
  expiresAt: number;
  value: Map<string, AmoCRMActivityMetrics>;
  diagnostics: AmoCRMActivityDiagnostics;
};

const CACHE_TTL_MS = 60 * 1000;
const metricsCache = new Map<string, CacheEntry>();

export function createAmoCRMActivityDiagnostics(): AmoCRMActivityDiagnostics {
  return {
    completedTasks: { ok: true, reason: null },
    pendingTasks: { ok: true, reason: null },
    events: { ok: true, reason: null },
  };
}

function failureReason(error: unknown): string {
  const message = String((error as Error | undefined)?.message || error || '').toLowerCase();

  if (message.includes('timeout')) return 'timeout';
  // Our own HTTP-status errors read "Failed to fetch AmoCRM ...: <status>" — those are API errors, not network errors.
  if (message.startsWith('failed to fetch amocrm')) return 'fetch_failed';
  if (message.includes('network') || message.includes('fetch failed')) return 'network_error';

  return 'fetch_failed';
}

function copyDiagnostics(target: AmoCRMActivityDiagnostics | undefined, source: AmoCRMActivityDiagnostics) {
  if (!target) return;
  target.completedTasks = { ...source.completedTasks };
  target.pendingTasks = { ...source.pendingTasks };
  target.events = { ...source.events };
}

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

function taskActionDate(task: AmoCRMTask): Date | null {
  return toDate(task.complete_till) || toDate(task.updated_at) || toDate(task.created_at);
}

function taskDueDate(task: AmoCRMTask): Date | null {
  return toDate(task.complete_till);
}

function getTashkentDayBounds(baseDate: Date): { start: Date; end: Date } {
  const offsetMs = TASHKENT_OFFSET_MS;
  const shifted = new Date(baseDate.getTime() + offsetMs);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const start = new Date(Date.UTC(year, month, day) - offsetMs);
  const end = new Date(start.getTime() + (24 * 60 * 60 * 1000) - 1);

  return { start, end };
}

function getTashkentWeekBounds(baseDate: Date): { start: Date; end: Date } {
  const offsetMs = TASHKENT_OFFSET_MS;
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
  const offsetMs = TASHKENT_OFFSET_MS;
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

/** A range ending within this long of "now" is open-ended (today, this week…): its key ignores the exact end. */
const OPEN_ENDED_RANGE_SLACK_MS = 10 * 60 * 1000;
/** Partial results (one amoCRM source failed) are reused only briefly. */
const PARTIAL_CACHE_TTL_MS = 15 * 1000;
/** How long an expired result may still be shown while a fresh one loads in the background. */
const STALE_MAX_AGE_MS = 30 * 60 * 1000;

type ActivityParams = {
  tenantId: string;
  /** Request code passes ctx.db. */
  db: DbClient;
  accessToken: string;
  baseUrl?: string;
  managerIds: string[];
  rangeStart: Date;
  rangeEnd: Date;
  rangeKind?: 'today' | 'week' | 'month' | 'custom';
  cacheTtlMs?: number;
  diagnostics?: AmoCRMActivityDiagnostics;
};

type StoredEntry = CacheEntry & { storedAt: number };

const inFlight = new Map<string, Promise<StoredEntry>>();

/**
 * Preset ranges end at "now", which moves every millisecond; keying on it meant no request ever
 * reused another's result. Open-ended ranges share one key and rely on the TTL for freshness.
 */
export function buildActivityCacheKey(
  tenantId: string,
  managerIds: string[],
  rangeStart: Date,
  rangeEnd: Date,
  now: number = Date.now(),
): string {
  const openEnded = Math.abs(now - rangeEnd.getTime()) <= OPEN_ENDED_RANGE_SLACK_MS;

  return [
    tenantId,
    rangeStart.toISOString(),
    openEnded ? 'now' : rangeEnd.toISOString(),
    managerIds.slice().sort().join(','),
  ].join('|');
}

function initializeMetricsMap(managerIds: string[]): Map<string, AmoCRMActivityMetrics> {
  return new Map(managerIds.map((managerId) => [managerId, createEmptyMetrics()]));
}

function normalizeManagerIds(managerIds: string[]): string[] {
  return managerIds.map((managerId) => managerId.trim()).filter(Boolean);
}

async function fetchTasksWithFallback(
  params: ActivityParams,
  managerIds: string[],
  filters: { completedOnly?: boolean; completed?: boolean; dateFrom?: Date; dateTo?: Date; maxPages: number },
  label: string,
  onFailure: (reason: string) => void,
): Promise<AmoCRMTask[]> {
  try {
    return await getAmoTasks(params.tenantId, {
      responsibleUserIds: managerIds,
      completed: filters.completed ?? filters.completedOnly,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      entityType: 'leads',
    }, params, params.db);
  } catch (error: unknown) {
    logger.warn({ tenantId: params.tenantId, error: errorMessage(error) }, `AmoCRM activity: failed to read ${label} from the snapshot`);
    onFailure(failureReason(error));

    return [];
  }
}

async function fetchEventsWithFallback(
  params: ActivityParams,
  managerIds: string[],
  onFailure: (reason: string) => void,
): Promise<AmoCRMEvent[]> {
  try {
    return await getAmoEvents(params.tenantId, {
      dateFrom: params.rangeStart,
      dateTo: params.rangeEnd,
      userIds: managerIds,
      entityType: 'lead',
    }, params, params.db);
  } catch (error: unknown) {
    logger.warn({ tenantId: params.tenantId, error: errorMessage(error) }, 'AmoCRM activity: failed to read events from the snapshot');
    onFailure(failureReason(error));

    return [];
  }
}

/** Reads completed tasks, open tasks and lead events from the snapshot (in parallel) and counts them per manager. */
async function computeActivityMetrics(params: ActivityParams, managerIds: string[]): Promise<CacheEntry> {
  const startedMs = Date.now();
  const managerIdSet = new Set(managerIds);
  const metricsByManager = initializeMetricsMap(managerIds);
  const diagnostics = createAmoCRMActivityDiagnostics();
  const { start: todayStart, end: todayEnd } = getTashkentDayBounds(new Date());
  const { start: periodStart, end: periodEnd } = getPeriodFollowUpBounds(
    params.rangeKind,
    params.rangeStart,
    params.rangeEnd,
  );

  const [tasks, pendingTasks, events] = await Promise.all([
    fetchTasksWithFallback(
      params,
      managerIds,
      { completedOnly: true, dateFrom: params.rangeStart, dateTo: params.rangeEnd, maxPages: 80 },
      'tasks',
      (reason) => { diagnostics.completedTasks = { ok: false, reason }; },
    ),
    fetchTasksWithFallback(
      params,
      managerIds,
      { completed: false, dateTo: todayEnd, maxPages: 30 },
      'pending tasks',
      (reason) => { diagnostics.pendingTasks = { ok: false, reason }; },
    ),
    fetchEventsWithFallback(params, managerIds, (reason) => { diagnostics.events = { ok: false, reason }; }),
  ]);

  for (const task of tasks) {
    if (!isCompletedTask(task) || !isLeadTask(task)) continue;
    const managerId = taskResponsibleUserId(task);

    if (!managerIdSet.has(managerId)) continue;
    if (!isWithinRange(taskActionDate(task), params.rangeStart, params.rangeEnd)) continue;
    const metrics = metricsByManager.get(managerId);

    if (metrics) metrics.followUpCount += 1;
  }

  for (const task of pendingTasks) {
    if (!isLeadTask(task) || isCompletedTask(task)) continue;
    const managerId = taskResponsibleUserId(task);

    if (!managerIdSet.has(managerId)) continue;
    const dueDate = taskDueDate(task);
    const metrics = metricsByManager.get(managerId);

    if (!dueDate || !metrics) continue;
    if (dueDate < todayStart) {
      metrics.overdueFollowUpCount += 1;
      continue;
    }
    if (dueDate >= periodStart && dueDate <= periodEnd) {
      metrics.todayFollowUpCount += 1;
    }
  }

  for (const event of events) {
    const managerId = eventActorUserId(event);

    if (!managerIdSet.has(managerId)) continue;
    if (!isWithinRange(eventDate(event), params.rangeStart, params.rangeEnd)) continue;
    const metrics = metricsByManager.get(managerId);

    if (!metrics) continue;
    if (isNoteEvent(event)) {
      metrics.noteCount += 1;
      continue;
    }
    if (isStageChangeEvent(event)) {
      metrics.stageChangeCount += 1;
    }
  }

  const complete = Object.values(diagnostics).every((source) => source.ok);

  logger.info({
    tenantId: params.tenantId,
    managers: managerIds.length,
    tasks: tasks.length,
    pendingTasks: pendingTasks.length,
    events: events.length,
    complete,
    ms: Date.now() - startedMs,
  }, 'AmoCRM activity: metrics computed');

  return {
    expiresAt: Date.now() + (complete ? Math.max(5_000, params.cacheTtlMs || CACHE_TTL_MS) : PARTIAL_CACHE_TTL_MS),
    value: metricsByManager,
    diagnostics,
  };
}

function pruneCache(now: number): void {
  for (const [key, entry] of metricsCache) {
    if (now - (entry as StoredEntry).storedAt > STALE_MAX_AGE_MS) metricsCache.delete(key);
  }
}

/** Starts the amoCRM requests for this key, or joins the ones already running. */
function startActivityCompute(key: string, params: ActivityParams, managerIds: string[]): Promise<StoredEntry> {
  const running = inFlight.get(key);

  if (running) return running;
  const promise = computeActivityMetrics(params, managerIds)
    .then((entry) => {
      const stored: StoredEntry = { ...entry, storedAt: Date.now() };

      pruneCache(stored.storedAt);
      metricsCache.set(key, stored);

      return stored;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  // A caller that stopped waiting must not turn a late failure into an unhandled rejection.
  promise.catch((error: unknown) => {
    logger.warn({ tenantId: params.tenantId, error: errorMessage(error) }, 'AmoCRM activity: background compute failed');
  });
  inFlight.set(key, promise);

  return promise;
}

function readEntry(entry: CacheEntry, diagnostics?: AmoCRMActivityDiagnostics): Map<string, AmoCRMActivityMetrics> {
  copyDiagnostics(diagnostics, entry.diagnostics);

  return cloneMetricsMap(entry.value);
}

/** Waits for the activity metrics (cached for a minute; concurrent callers share one set of amoCRM requests). */
export async function getAmoCRMActivityMetrics(params: ActivityParams): Promise<Map<string, AmoCRMActivityMetrics>> {
  const managerIds = normalizeManagerIds(params.managerIds);

  if (!managerIds.length) return new Map();
  const key = buildActivityCacheKey(params.tenantId, managerIds, params.rangeStart, params.rangeEnd);
  const cached = metricsCache.get(key);

  if (cached && cached.expiresAt > Date.now()) return readEntry(cached, params.diagnostics);

  return readEntry(await startActivityCompute(key, params, managerIds), params.diagnostics);
}

export type ActivityLookup = {
  metrics: Map<string, AmoCRMActivityMetrics> | null;
  /** True when amoCRM is still answering in the background; the next request gets the result. */
  pending: boolean;
  /** True when an expired result was returned while a fresh one loads. */
  stale: boolean;
};

/**
 * For request paths that must not wait on amoCRM: returns a cached result (refreshing it in the
 * background when expired), or waits up to `waitMs` for a new one and otherwise lets it finish in
 * the background.
 */
export async function getAmoCRMActivityMetricsWithin(params: ActivityParams, waitMs: number): Promise<ActivityLookup> {
  const managerIds = normalizeManagerIds(params.managerIds);

  if (!managerIds.length) return { metrics: new Map(), pending: false, stale: false };
  const key = buildActivityCacheKey(params.tenantId, managerIds, params.rangeStart, params.rangeEnd);
  const now = Date.now();
  const cached = metricsCache.get(key) as StoredEntry | undefined;

  if (cached && cached.expiresAt > now) {
    return { metrics: readEntry(cached, params.diagnostics), pending: false, stale: false };
  }
  const compute = startActivityCompute(key, params, managerIds);

  if (cached && now - cached.storedAt <= STALE_MAX_AGE_MS) {
    return { metrics: readEntry(cached, params.diagnostics), pending: false, stale: true };
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });

  try {
    const entry = await Promise.race([compute, timeout]);

    if (entry) return { metrics: readEntry(entry, params.diagnostics), pending: false, stale: false };
  } catch {
    // Logged by startActivityCompute; fall through to "pending".
  } finally {
    if (timer) clearTimeout(timer);
  }

  return { metrics: null, pending: true, stale: false };
}

/** Test hook: forget cached and running computations. */
export function resetAmoCRMActivityCache(): void {
  metricsCache.clear();
  inFlight.clear();
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
