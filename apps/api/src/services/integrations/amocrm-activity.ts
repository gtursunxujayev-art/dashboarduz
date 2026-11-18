import type { DbClient } from '@dashboarduz/db';

import { errorMessage } from '../../lib/errors';
import { logger } from '../../lib/logger';

import { type AmoCRMEvent, type AmoCRMTask } from './amocrm';
import {
  activityFailureReason,
  countCompletedFollowUps,
  countEventActivity,
  countOpenFollowUps,
  createEmptyMetrics,
  type AmoCRMActivityMetrics,
} from './amocrm-activity-count';
import { getPeriodFollowUpBounds, getTashkentDayBounds, type ActivityRangeKind } from './amocrm-activity-periods';
import { getAmoEvents, getAmoTasks } from './amocrm-activity-snapshot-read';

export { summarizeAmoCRMActivityMetrics, type AmoCRMActivityMetrics } from './amocrm-activity-count';

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
const metricsCache = new Map<string, StoredEntry>();

export function createAmoCRMActivityDiagnostics(): AmoCRMActivityDiagnostics {
  return {
    completedTasks: { ok: true, reason: null },
    pendingTasks: { ok: true, reason: null },
    events: { ok: true, reason: null },
  };
}

function copyDiagnostics(target: AmoCRMActivityDiagnostics | undefined, source: AmoCRMActivityDiagnostics) {
  if (!target) return;
  target.completedTasks = { ...source.completedTasks };
  target.pendingTasks = { ...source.pendingTasks };
  target.events = { ...source.events };
}

function cloneMetricsMap(input: Map<string, AmoCRMActivityMetrics>): Map<string, AmoCRMActivityMetrics> {
  return new Map(Array.from(input.entries()).map(([key, value]) => [key, { ...value }]));
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
  rangeKind?: ActivityRangeKind;
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
  filters: { completed: boolean; dateFrom?: Date; dateTo?: Date },
  label: string,
  onFailure: (reason: string) => void,
): Promise<AmoCRMTask[]> {
  try {
    return await getAmoTasks(params.tenantId, {
      responsibleUserIds: managerIds,
      completed: filters.completed,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      entityType: 'leads',
    }, params, params.db);
  } catch (error: unknown) {
    logger.warn({ tenantId: params.tenantId, error: errorMessage(error) }, `AmoCRM activity: failed to read ${label} from the snapshot`);
    onFailure(activityFailureReason(error));

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
    onFailure(activityFailureReason(error));

    return [];
  }
}

/** Reads completed tasks, open tasks and lead events from the snapshot (in parallel) and counts them per manager. */
async function computeActivityMetrics(params: ActivityParams, managerIds: string[]): Promise<CacheEntry> {
  const startedMs = Date.now();
  const metricsByManager = initializeMetricsMap(managerIds);
  const diagnostics = createAmoCRMActivityDiagnostics();
  const range = { start: params.rangeStart, end: params.rangeEnd };
  const { start: todayStart, end: todayEnd } = getTashkentDayBounds(new Date());
  const followUpPeriod = getPeriodFollowUpBounds(params.rangeKind, params.rangeStart, params.rangeEnd);

  const [tasks, pendingTasks, events] = await Promise.all([
    fetchTasksWithFallback(
      params,
      managerIds,
      { completed: true, dateFrom: params.rangeStart, dateTo: params.rangeEnd },
      'tasks',
      (reason) => { diagnostics.completedTasks = { ok: false, reason }; },
    ),
    fetchTasksWithFallback(
      params,
      managerIds,
      { completed: false, dateTo: todayEnd },
      'pending tasks',
      (reason) => { diagnostics.pendingTasks = { ok: false, reason }; },
    ),
    fetchEventsWithFallback(params, managerIds, (reason) => { diagnostics.events = { ok: false, reason }; }),
  ]);

  countCompletedFollowUps(metricsByManager, tasks, range);
  countOpenFollowUps(metricsByManager, pendingTasks, todayStart, followUpPeriod);
  countEventActivity(metricsByManager, events, range);

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
    if (now - entry.storedAt > STALE_MAX_AGE_MS) metricsCache.delete(key);
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
  const cached = metricsCache.get(key);

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
