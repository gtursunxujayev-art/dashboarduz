/**
 * Keeps a per-tenant snapshot of amoCRM leads in the `leads` table so the dashboard reads leads
 * from the database (see `amocrm-lead-snapshot-read.ts`) instead of calling amoCRM per request.
 *
 * - Each refresh pulls the leads changed since the last one (`filter[updated_at][from]`).
 * - Once a day, or when there is no snapshot yet, it pulls every lead and drops the rows amoCRM
 *   no longer returns (deleted leads), since an incremental pull cannot see deletions.
 * - The scheduler refreshes every tenant once an hour; admins can refresh on demand.
 * - A Redis lock per tenant makes sure only one API/worker instance refreshes a tenant at once.
 */
import { randomUUID } from 'crypto';

import { systemPrisma } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';

import { parseAmoTimestamp } from '../../lib/amocrm';
import { withTimeout } from '../../lib/async';
import { createIntervalJob } from '../../lib/interval-job';
import { logger } from '../../lib/logger';
import { asObject, toNumberOrNull } from '../../lib/object';
import { getRedisClient } from '../queue/redis-client';

import { amocrmService, type AmoCRMLead } from './amocrm';
import { getTenantAmoCRMContext } from './amocrm-live';

export const LEAD_SNAPSHOT_CONFIG_KEY = 'lead_snapshot';
export const LEAD_SNAPSHOT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** After a failed refresh, wait this long before the scheduler tries the tenant again. */
const FAILURE_RETRY_MS = 15 * 60 * 1000;
/** How often the scheduler looks for tenants whose snapshot is older than an hour. */
const SCHEDULER_TICK_MS = 5 * 60 * 1000;
const PAGE_SIZE = 250;
/** 100k leads per run; a longer pull continues on the next run. */
const MAX_PAGES_PER_RUN = 400;
/** Re-read a minute before the cursor so a lead saved in the cursor's second is not missed. */
const CURSOR_OVERLAP_SECONDS = 60;
const LOCK_TTL_SECONDS = 30 * 60;
const LOCK_TIMEOUT_MS = 2_000;

export type LeadSnapshotState = {
  /** When the last successful refresh finished. */
  lastRefreshedAt: string | null;
  /** When the last successful full pull (with the deleted-lead sweep) finished. */
  lastFullSyncAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** Unix seconds of the newest lead `updated_at` already stored. */
  cursor: number | null;
  leadCount: number | null;
};

export type LeadSnapshotRefreshResult = {
  mode: 'full' | 'incremental';
  fetched: number;
  removed: number;
  complete: boolean;
  leadCount: number;
  refreshedAt: string;
};

export type LeadSnapshotRefreshOutcome =
  | { status: 'refreshed'; result: LeadSnapshotRefreshResult }
  | { status: 'not_connected' }
  | { status: 'already_running' };

function asIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

export function readLeadSnapshotState(config: unknown): LeadSnapshotState {
  const state = asObject(asObject(config)?.[LEAD_SNAPSHOT_CONFIG_KEY]) || {};
  const cursor = toNumberOrNull(state.cursor);
  const leadCount = toNumberOrNull(state.leadCount);

  return {
    lastRefreshedAt: asIsoOrNull(state.lastRefreshedAt),
    lastFullSyncAt: asIsoOrNull(state.lastFullSyncAt),
    lastAttemptAt: asIsoOrNull(state.lastAttemptAt),
    lastError: typeof state.lastError === 'string' ? state.lastError : null,
    cursor: cursor !== null && cursor > 0 ? cursor : null,
    leadCount: leadCount !== null && leadCount >= 0 ? leadCount : null,
  };
}

function msSince(iso: string | null, now: Date): number {
  return iso ? now.getTime() - new Date(iso).getTime() : Number.POSITIVE_INFINITY;
}

export function needsFullSync(state: LeadSnapshotState, now: Date): boolean {
  return state.cursor === null || msSince(state.lastFullSyncAt, now) >= FULL_SYNC_INTERVAL_MS;
}

/** Whether the hourly scheduler should refresh this tenant now. */
export function isLeadSnapshotDue(state: LeadSnapshotState, now: Date): boolean {
  if (msSince(state.lastRefreshedAt, now) < LEAD_SNAPSHOT_REFRESH_INTERVAL_MS) return false;
  // Back off after a failure instead of hitting amoCRM on every tick.
  if (state.lastError && msSince(state.lastAttemptAt, now) < FAILURE_RETRY_MS) return false;

  return true;
}

function toAmoId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();

  return normalized && normalized !== '0' ? normalized : null;
}

export function leadToSnapshotRow(lead: AmoCRMLead) {
  return {
    title: typeof lead.name === 'string' && lead.name.trim() ? lead.name : 'Untitled Lead',
    status: toAmoId(lead.status_id),
    pipelineId: toAmoId(lead.pipeline_id),
    responsibleUserId: toAmoId(lead.responsible_user_id),
    metadata: lead as Prisma.InputJsonValue,
    source: 'amocrm',
    externalCreatedAt: parseAmoTimestamp(lead.created_at),
    externalUpdatedAt: parseAmoTimestamp(lead.updated_at),
  };
}

async function storeLeadPage(tenantId: string, leads: AmoCRMLead[]): Promise<void> {
  const writes = leads.flatMap((lead) => {
    const amocrmId = toAmoId(lead.id);

    if (!amocrmId) return [];
    const row = leadToSnapshotRow(lead);

    return [systemPrisma.lead.upsert({
      where: { tenantId_amocrmId: { tenantId, amocrmId } },
      // Setting updatedAt marks the row as seen by this pull (the full-pull sweep relies on it).
      update: { ...row, updatedAt: new Date() },
      create: { ...row, tenantId, amocrmId },
    })];
  });

  if (writes.length) await systemPrisma.$transaction(writes);
}

async function saveLeadSnapshotState(integrationId: string, patch: Partial<LeadSnapshotState>): Promise<LeadSnapshotState> {
  // Re-read the config so settings saved while the refresh ran are not overwritten.
  const fresh = await systemPrisma.integration.findUnique({ where: { id: integrationId }, select: { config: true } });
  const config = asObject(fresh?.config) || {};
  const next = { ...readLeadSnapshotState(config), ...patch };

  await systemPrisma.integration.update({
    where: { id: integrationId },
    data: { config: { ...config, [LEAD_SNAPSHOT_CONFIG_KEY]: next } as Prisma.InputJsonValue },
  });

  return next;
}

/**
 * Pulls leads from amoCRM into the tenant's snapshot. Callers go through
 * `refreshTenantLeadSnapshot`, which holds the tenant lock.
 */
export async function pullTenantLeadSnapshot(
  tenantId: string,
  options: { now?: Date; forceFull?: boolean } = {},
): Promise<LeadSnapshotRefreshResult | null> {
  const now = options.now ?? new Date();
  const amoContext = await getTenantAmoCRMContext(tenantId, systemPrisma);

  if (!amoContext) return null;

  const state = readLeadSnapshotState(amoContext.config);
  const full = Boolean(options.forceFull) || needsFullSync(state, now);
  const updatedFrom = !full && state.cursor !== null
    ? new Date((state.cursor - CURSOR_OVERLAP_SECONDS) * 1000)
    : undefined;
  // Rows this pull touches get a newer updatedAt; the full-pull sweep removes the rest.
  const sweepBefore = new Date();
  let cursor = state.cursor;
  let fetched = 0;
  let complete = false;

  try {
    for (let page = 1; page <= MAX_PAGES_PER_RUN; page += 1) {
      const response = await amocrmService.fetchLeads(
        amoContext.accessToken,
        '',
        {
          page,
          limit: PAGE_SIZE,
          with: 'contacts',
          updatedAtFrom: updatedFrom,
          // Paging by id keeps a full pull stable; by updated_at lets an incremental pull resume.
          order: full ? { field: 'id', direction: 'asc' } : { field: 'updated_at', direction: 'asc' },
        },
        amoContext.baseUrl,
      );
      const leads = Array.isArray(response._embedded?.leads) ? response._embedded.leads : [];

      await storeLeadPage(tenantId, leads);
      fetched += leads.length;
      for (const lead of leads) {
        const updatedAt = toNumberOrNull(lead.updated_at);

        if (updatedAt !== null && (cursor === null || updatedAt > cursor)) cursor = updatedAt;
      }
      if (!response._links?.next?.href || leads.length < PAGE_SIZE) {
        complete = true;
        break;
      }
    }

    let removed = 0;

    if (full && complete) {
      const where = { tenantId, amocrmId: { not: null }, updatedAt: { lt: sweepBefore } };

      // An empty answer for a tenant that had leads is more likely a wrong account than a wipe.
      if (fetched > 0 || (await systemPrisma.lead.count({ where })) === 0) {
        removed = (await systemPrisma.lead.deleteMany({ where })).count;
      } else {
        logger.warn({ tenantId }, 'amoCRM lead snapshot: full pull returned no leads, kept the stored ones');
      }
    }

    const leadCount = await systemPrisma.lead.count({ where: { tenantId, amocrmId: { not: null } } });
    const refreshedAt = new Date().toISOString();

    await saveLeadSnapshotState(amoContext.integrationId, {
      lastRefreshedAt: refreshedAt,
      lastAttemptAt: refreshedAt,
      lastError: null,
      cursor: cursor ?? Math.floor(now.getTime() / 1000),
      leadCount,
      ...(full && complete ? { lastFullSyncAt: refreshedAt } : {}),
    });
    logger.info({ tenantId, mode: full ? 'full' : 'incremental', fetched, removed, complete, leadCount }, 'amoCRM lead snapshot refreshed');

    return { mode: full ? 'full' : 'incremental', fetched, removed, complete, leadCount, refreshedAt };
  } catch (error) {
    const message = String((error as Error | undefined)?.message || error);

    // Keep the cursor of the pages already stored so the next run continues from there.
    await saveLeadSnapshotState(amoContext.integrationId, {
      lastAttemptAt: new Date().toISOString(),
      lastError: message,
      cursor,
    }).catch(() => undefined);
    logger.warn({ tenantId, fetched, error: message }, 'amoCRM lead snapshot refresh failed');
    throw error;
  }
}

function lockKey(tenantId: string): string {
  return `amocrm-lead-snapshot:lock:${tenantId}`;
}

/**
 * Takes the tenant's refresh lock. `true` when this instance holds it, `false` when another one
 * does, and `null` when Redis is unreachable (the refresh then runs with the in-process guard).
 */
async function acquireLock(tenantId: string, token: string): Promise<boolean | null> {
  try {
    const result = await withTimeout(
      getRedisClient().set(lockKey(tenantId), token, 'EX', LOCK_TTL_SECONDS, 'NX'),
      LOCK_TIMEOUT_MS,
      'redis_timeout',
    );

    return result === 'OK';
  } catch (error) {
    logger.warn({ tenantId, error: String((error as Error | undefined)?.message || error) }, 'amoCRM lead snapshot: Redis lock unavailable');

    return null;
  }
}

async function releaseLock(tenantId: string, token: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const key = lockKey(tenantId);

    // Only drop the lock if it is still ours (it may have expired and been taken by another run).
    if (await withTimeout(redis.get(key), LOCK_TIMEOUT_MS, 'redis_timeout') === token) {
      await withTimeout(redis.del(key), LOCK_TIMEOUT_MS, 'redis_timeout');
    }
  } catch {
    // The lock expires on its own.
  }
}

/** Whether a refresh holds the tenant lock right now (on any instance). */
export async function isLeadSnapshotRefreshRunning(tenantId: string): Promise<boolean> {
  if (runningTenants.has(tenantId)) return true;
  try {
    return (await withTimeout(getRedisClient().exists(lockKey(tenantId)), LOCK_TIMEOUT_MS, 'redis_timeout')) === 1;
  } catch {
    return false;
  }
}

const runningTenants = new Set<string>();

/** Refreshes the tenant's snapshot unless a refresh is already running on any instance. */
export async function refreshTenantLeadSnapshot(
  tenantId: string,
  options: { now?: Date; forceFull?: boolean } = {},
): Promise<LeadSnapshotRefreshOutcome> {
  if (runningTenants.has(tenantId)) return { status: 'already_running' };
  runningTenants.add(tenantId);
  const token = randomUUID();
  let locked: boolean | null = null;

  try {
    locked = await acquireLock(tenantId, token);
    if (locked === false) return { status: 'already_running' };

    const result = await pullTenantLeadSnapshot(tenantId, options);

    return result ? { status: 'refreshed', result } : { status: 'not_connected' };
  } finally {
    if (locked) await releaseLock(tenantId, token);
    runningTenants.delete(tenantId);
  }
}

/** One scheduler pass: refreshes every connected tenant whose snapshot is older than an hour. */
export async function refreshDueLeadSnapshots(now = new Date()): Promise<string[]> {
  const integrations = await systemPrisma.integration.findMany({
    where: { type: 'amocrm', status: 'active' },
    select: { tenantId: true, config: true },
  });
  const refreshed: string[] = [];

  for (const integration of integrations) {
    if (!isLeadSnapshotDue(readLeadSnapshotState(integration.config), now)) continue;
    try {
      const outcome = await refreshTenantLeadSnapshot(integration.tenantId, { now });

      if (outcome.status === 'refreshed') refreshed.push(integration.tenantId);
    } catch {
      // Logged and recorded in the tenant's snapshot state; carry on with the other tenants.
    }
  }

  return refreshed;
}

const job = createIntervalJob({
  intervalMs: SCHEDULER_TICK_MS,
  skipWhileRunning: true,
  run: () => refreshDueLeadSnapshots(),
  onError: (error) => {
    logger.warn({ error: String((error as Error | undefined)?.message || error) }, 'amoCRM lead snapshot scheduler run failed');
  },
  onStart: () => {
    logger.info({ tickMs: SCHEDULER_TICK_MS, refreshIntervalMs: LEAD_SNAPSHOT_REFRESH_INTERVAL_MS }, 'amoCRM lead snapshot scheduler started');
  },
});

export function startAmoLeadSnapshotScheduler(): void {
  job.start();
}

export function stopAmoLeadSnapshotScheduler(): void {
  job.stop();
}
