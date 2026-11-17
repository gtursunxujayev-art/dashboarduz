/**
 * Copies amoCRM tasks, lead events and reference data (users, pipelines, lead custom fields) into
 * the database every few minutes, so pages and reports read them from there instead of paging
 * amoCRM on every request. Leads have their own snapshot (amocrm-lead-snapshot.ts).
 *
 * Tasks and events are pulled in time windows (tasks by `updated_at`, events by `created_at`): a
 * window is stored completely before the cursor moves past it, so a run that stops early (page
 * budget, error) resumes at the first unfinished window without gaps. A new tenant is backfilled
 * from BACKFILL_DAYS ago over several runs.
 */
import { randomUUID } from 'crypto';

import { systemPrisma } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';

import { parseAmoTimestamp, toAmoId } from '../../lib/amocrm';
import { withTimeout } from '../../lib/async';
import { createIntervalJob } from '../../lib/interval-job';
import { logger } from '../../lib/logger';
import { asObject, toNumberOrNull } from '../../lib/object';
import { getRedisClient } from '../queue/redis-client';

import { amocrmService, type AmoCRMEvent, type AmoCRMTask } from './amocrm';
import { refreshAmoReference, type AmoReferenceKind } from './amocrm-activity-snapshot-read';
import { getTenantAmoCRMContext, type TenantAmoCRMContext } from './amocrm-live';

export const ACTIVITY_SNAPSHOT_CONFIG_KEY = 'activity_snapshot';

/** How far back a new tenant is filled (covers a year-to-date salary range in January too). */
export const BACKFILL_DAYS = 400;
const SCHEDULER_TICK_MS = 5 * 60 * 1000;
/** Window size while catching up; the last window always ends "now". */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Re-read this much before the cursor so an item saved in the cursor's second is not missed. */
const CURSOR_OVERLAP_MS = 2 * 60 * 1000;
/** amoCRM pages (all kinds together) per tenant per run; a long backfill continues next run. */
const MAX_PAGES_PER_RUN = 400;
/** Pages within one window before it is treated as too big to finish this run. */
const MAX_PAGES_PER_WINDOW = 300;
const TASK_PAGE_SIZE = 250;
const EVENT_PAGE_SIZE = 100;
const REFERENCE_REFRESH_MS = 30 * 60 * 1000;
/** amoCRM answers old-history pages slowly; a background job can wait for them. */
const PAGE_TIMEOUT_MS = 45_000;
const PAGE_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [2_000, 8_000];

/** Retries a page on timeouts and dropped connections (amoCRM throttles under load). */
export async function withPageRetry<T>(load: () => Promise<T>, sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < PAGE_ATTEMPTS; attempt += 1) {
    try {
      return await load();
    } catch (error) {
      lastError = error;
      const message = String((error as Error | undefined)?.message || error).toLowerCase();
      const retryable = message.includes('timeout') || message.includes('fetch failed') || message.includes('429')
        || message.includes('502') || message.includes('503') || message.includes('504');

      if (!retryable || attempt === PAGE_ATTEMPTS - 1) break;
      await sleep(RETRY_DELAYS_MS[attempt] ?? 8_000);
    }
  }

  throw lastError;
}
const LOCK_TTL_SECONDS = 30 * 60;
const LOCK_TIMEOUT_MS = 2_000;

type StreamKind = 'tasks' | 'events';

export type StreamState = {
  /** Unix ms up to which every item is stored. */
  cursor: number | null;
  backfillComplete: boolean;
};

export type ActivitySnapshotState = {
  tasks: StreamState;
  events: StreamState;
  referenceRefreshedAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
};

function readStream(value: unknown): StreamState {
  const raw = asObject(value) || {};
  const cursor = toNumberOrNull(raw.cursor);

  return { cursor: cursor !== null && cursor > 0 ? cursor : null, backfillComplete: raw.backfillComplete === true };
}

function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

export function readActivitySnapshotState(config: unknown): ActivitySnapshotState {
  const raw = asObject(asObject(config)?.[ACTIVITY_SNAPSHOT_CONFIG_KEY]) || {};

  return {
    tasks: readStream(raw.tasks),
    events: readStream(raw.events),
    referenceRefreshedAt: isoOrNull(raw.referenceRefreshedAt),
    lastRunAt: isoOrNull(raw.lastRunAt),
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
  };
}

/** The time windows still to pull for a stream, oldest first. */
export function planWindows(state: StreamState, now: number): Array<{ from: number; to: number }> {
  const start = state.cursor !== null ? state.cursor - CURSOR_OVERLAP_MS : now - BACKFILL_DAYS * 24 * 60 * 60 * 1000;
  const windows: Array<{ from: number; to: number }> = [];

  for (let from = start; from < now; from += WINDOW_MS) {
    windows.push({ from, to: Math.min(from + WINDOW_MS, now) });
  }

  return windows;
}

function isCompletedValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function taskToRow(tenantId: string, task: AmoCRMTask): Prisma.AmocrmTaskCreateManyInput | null {
  const amocrmId = toAmoId(task.id);

  if (!amocrmId) return null;

  return {
    tenantId,
    amocrmId,
    responsibleUserId: toAmoId(task.responsible_user_id),
    entityType: typeof task.entity_type === 'string' ? task.entity_type : null,
    entityId: toAmoId(task.entity_id),
    isCompleted: isCompletedValue(task.is_completed),
    completeTill: parseAmoTimestamp(task.complete_till),
    externalCreatedAt: parseAmoTimestamp(task.created_at),
    externalUpdatedAt: parseAmoTimestamp(task.updated_at),
    payload: task as Prisma.InputJsonValue,
  };
}

export function eventToRow(tenantId: string, event: AmoCRMEvent): Prisma.AmocrmEventCreateManyInput | null {
  const amocrmId = toAmoId(event.id);
  const createdAt = parseAmoTimestamp(event.created_at);

  if (!amocrmId || !createdAt) return null;

  return {
    tenantId,
    amocrmId,
    type: typeof event.type === 'string' ? event.type : null,
    entityType: typeof event.entity_type === 'string' ? event.entity_type : null,
    entityId: toAmoId(event.entity_id),
    createdBy: toAmoId(event.created_by),
    externalCreatedAt: createdAt,
    payload: event as Prisma.InputJsonValue,
  };
}

async function storeTasks(rows: Prisma.AmocrmTaskCreateManyInput[]): Promise<void> {
  if (!rows.length) return;
  // Tasks change (completed, rescheduled), so existing rows are updated.
  await systemPrisma.$transaction(rows.map((row) => systemPrisma.amocrmTask.upsert({
    where: { tenantId_amocrmId: { tenantId: row.tenantId, amocrmId: row.amocrmId } },
    update: { ...row, syncedAt: new Date() },
    create: row,
  })));
}

async function storeEvents(rows: Prisma.AmocrmEventCreateManyInput[]): Promise<void> {
  if (!rows.length) return;
  // Events never change: insert new ones only.
  await systemPrisma.amocrmEvent.createMany({ data: rows, skipDuplicates: true });
}

type PageBudget = { remaining: number };

/** Stores every item of one window. Returns false when the page budget ran out before the end. */
async function pullWindow(
  kind: StreamKind,
  tenantId: string,
  context: TenantAmoCRMContext,
  window: { from: number; to: number },
  budget: PageBudget,
): Promise<{ done: boolean; stored: number }> {
  let stored = 0;

  for (let page = 1; page <= MAX_PAGES_PER_WINDOW; page += 1) {
    if (budget.remaining <= 0) return { done: false, stored };
    budget.remaining -= 1;

    if (kind === 'tasks') {
      const response = await withPageRetry(() => amocrmService.fetchTasks(context.accessToken, {
        page,
        limit: TASK_PAGE_SIZE,
        updatedAtFrom: new Date(window.from),
        updatedAtTo: new Date(window.to),
        timeoutMs: PAGE_TIMEOUT_MS,
      }, context.baseUrl));
      const tasks = Array.isArray(response._embedded?.tasks) ? response._embedded.tasks : [];

      await storeTasks(tasks.map((task) => taskToRow(tenantId, task)).filter((row): row is Prisma.AmocrmTaskCreateManyInput => row !== null));
      stored += tasks.length;
      if (!response._links?.next?.href || tasks.length < TASK_PAGE_SIZE) return { done: true, stored };
    } else {
      const response = await withPageRetry(() => amocrmService.fetchEvents(context.accessToken, {
        page,
        limit: EVENT_PAGE_SIZE,
        dateFrom: new Date(window.from),
        dateTo: new Date(window.to),
        entityType: 'lead',
        timeoutMs: PAGE_TIMEOUT_MS,
      }, context.baseUrl));
      const events = Array.isArray(response._embedded?.events) ? response._embedded.events : [];

      await storeEvents(events.map((event) => eventToRow(tenantId, event)).filter((row): row is Prisma.AmocrmEventCreateManyInput => row !== null));
      stored += events.length;
      if (!response._links?.next?.href || events.length < EVENT_PAGE_SIZE) return { done: true, stored };
    }
  }

  // Too many pages for one window: log it and move on rather than retrying the same window forever.
  logger.warn({ tenantId, kind, from: new Date(window.from).toISOString(), to: new Date(window.to).toISOString() }, 'amoCRM activity snapshot: window hit the page cap');

  return { done: true, stored };
}

async function pullStream(
  kind: StreamKind,
  tenantId: string,
  context: TenantAmoCRMContext,
  state: StreamState,
  now: number,
  budget: PageBudget,
): Promise<{ state: StreamState; stored: number }> {
  let cursor = state.cursor;
  let stored = 0;
  let caughtUp = true;

  for (const window of planWindows(state, now)) {
    const result = await pullWindow(kind, tenantId, context, window, budget);

    stored += result.stored;
    if (!result.done) {
      caughtUp = false;
      break;
    }
    cursor = window.to;
  }

  return { state: { cursor, backfillComplete: state.backfillComplete || caughtUp }, stored };
}

const REFERENCE_KINDS: AmoReferenceKind[] = ['users', 'pipelines', 'lead_custom_fields'];

/** Re-reads users, pipelines and lead custom fields from amoCRM. A failed kind keeps its stored copy. */
export async function refreshAmoReferences(tenantId: string, context: TenantAmoCRMContext): Promise<void> {
  await Promise.all(REFERENCE_KINDS.map(async (kind) => {
    try {
      await refreshAmoReference(tenantId, kind, context, systemPrisma);
    } catch (error) {
      logger.warn({ tenantId, kind, error: String((error as Error | undefined)?.message || error) }, 'amoCRM reference refresh failed');
    }
  }));
}

async function saveState(integrationId: string, state: ActivitySnapshotState): Promise<void> {
  // Re-read the config so settings saved while the run was going are not overwritten.
  const fresh = await systemPrisma.integration.findUnique({ where: { id: integrationId }, select: { config: true } });
  const config = asObject(fresh?.config) || {};

  await systemPrisma.integration.update({
    where: { id: integrationId },
    data: { config: { ...config, [ACTIVITY_SNAPSHOT_CONFIG_KEY]: state } as Prisma.InputJsonValue },
  });
}

export type ActivitySnapshotRunResult = { tasks: number; events: number; caughtUp: boolean };

/** One pass for a tenant: reference data when due, then new tasks and events. */
export async function pullTenantActivitySnapshot(tenantId: string, now = new Date()): Promise<ActivitySnapshotRunResult | null> {
  const context = await getTenantAmoCRMContext(tenantId, systemPrisma);

  if (!context) return null;
  const state = readActivitySnapshotState(context.config);
  const budget: PageBudget = { remaining: MAX_PAGES_PER_RUN };
  let next: ActivitySnapshotState = { ...state };
  let tasksStored = 0;
  let eventsStored = 0;

  try {
    if (!state.referenceRefreshedAt || now.getTime() - new Date(state.referenceRefreshedAt).getTime() >= REFERENCE_REFRESH_MS) {
      await refreshAmoReferences(tenantId, context);
      next = { ...next, referenceRefreshedAt: now.toISOString() };
    }
    // Events first: they drive most metrics. Tasks get what is left of this run's budget.
    const events = await pullStream('events', tenantId, context, state.events, now.getTime(), budget);

    next = { ...next, events: events.state };
    eventsStored = events.stored;
    const tasks = await pullStream('tasks', tenantId, context, state.tasks, now.getTime(), budget);

    next = { ...next, tasks: tasks.state };
    tasksStored = tasks.stored;
    next = { ...next, lastRunAt: now.toISOString(), lastError: null };
    await saveState(context.integrationId, next);
    const caughtUp = next.tasks.cursor === now.getTime() && next.events.cursor === now.getTime();

    logger.info({ tenantId, tasks: tasksStored, events: eventsStored, caughtUp }, 'amoCRM activity snapshot refreshed');

    return { tasks: tasksStored, events: eventsStored, caughtUp };
  } catch (error) {
    const message = String((error as Error | undefined)?.message || error);

    // Keep the windows already finished; the next run continues from there.
    await saveState(context.integrationId, { ...next, lastRunAt: now.toISOString(), lastError: message }).catch(() => undefined);
    logger.warn({ tenantId, tasks: tasksStored, events: eventsStored, error: message }, 'amoCRM activity snapshot refresh failed');
    throw error;
  }
}

function activitySnapshotLockKey(tenantId: string): string {
  return `amocrm-activity-snapshot:lock:${tenantId}`;
}

const runningTenants = new Set<string>();

/** Runs a pass unless one is already running for the tenant (on this or another instance). */
export async function refreshTenantActivitySnapshot(tenantId: string, now = new Date()): Promise<ActivitySnapshotRunResult | 'already_running' | null> {
  if (runningTenants.has(tenantId)) return 'already_running';
  runningTenants.add(tenantId);
  const token = randomUUID();
  let locked: boolean | null = null;

  try {
    try {
      locked = (await withTimeout(getRedisClient().set(activitySnapshotLockKey(tenantId), token, 'EX', LOCK_TTL_SECONDS, 'NX'), LOCK_TIMEOUT_MS, 'redis_timeout')) === 'OK';
    } catch {
      locked = null; // Redis unreachable: rely on the in-process guard.
    }
    if (locked === false) return 'already_running';

    return await pullTenantActivitySnapshot(tenantId, now);
  } finally {
    if (locked) {
      try {
        const redis = getRedisClient();

        if (await withTimeout(redis.get(activitySnapshotLockKey(tenantId)), LOCK_TIMEOUT_MS, 'redis_timeout') === token) {
          await withTimeout(redis.del(activitySnapshotLockKey(tenantId)), LOCK_TIMEOUT_MS, 'redis_timeout');
        }
      } catch {
        // The lock expires on its own.
      }
    }
    runningTenants.delete(tenantId);
  }
}

/** One scheduler pass over every connected tenant. */
export async function refreshAllActivitySnapshots(now = new Date()): Promise<void> {
  const integrations = await systemPrisma.integration.findMany({
    where: { type: 'amocrm', status: 'active' },
    select: { tenantId: true },
  });

  for (const integration of integrations) {
    await refreshTenantActivitySnapshot(integration.tenantId, now).catch(() => undefined);
  }
}

const job = createIntervalJob({
  intervalMs: SCHEDULER_TICK_MS,
  skipWhileRunning: true,
  run: () => refreshAllActivitySnapshots(),
  onError: (error) => {
    logger.warn({ error: String((error as Error | undefined)?.message || error) }, 'amoCRM activity snapshot scheduler run failed');
  },
  onStart: () => {
    logger.info({ tickMs: SCHEDULER_TICK_MS }, 'amoCRM activity snapshot scheduler started');
  },
});

export function startAmoActivitySnapshotScheduler(): void {
  job.start();
}

export function stopAmoActivitySnapshotScheduler(): void {
  job.stop();
}
