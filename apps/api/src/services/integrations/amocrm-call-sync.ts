// Imports call notes (call_in / call_out) from amoCRM into the `calls` table as provider "amocrm".
// Each row carries the manager's Utel extension in from/to and metadata.normalized_extension, so every page that
// attributes calls by extension counts these rows exactly like Utel webhook rows.
import { prisma } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';

import { getPreviousTashkentMonthStart } from '../bonus-auto-finalize';
import { AMOCRM_CALL_PROVIDER, readCallsSource } from '../calls-source';
import { CALL_NOTE_TYPES } from '../funnel-metrics';
import { log, LogLevel } from '../observability';

import { amocrmService, type AmoCRMNote } from './amocrm';
import { getTenantAmoCRMContext } from './amocrm-live';

export const CALL_NOTE_ENTITY_TYPES = ['contacts', 'leads', 'companies'] as const;
export type CallNoteEntityType = (typeof CALL_NOTE_ENTITY_TYPES)[number];

/** Key in the amoCRM integration config that holds sync progress. */
export const CALLS_SYNC_CONFIG_KEY = 'calls_sync';

const NOTES_PAGE_SIZE = 250;
/** Per entity type per run; a long backfill continues on the next run. */
const MAX_PAGES_PER_RUN = 200;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export type CallsSyncState = {
  /** Per entity type: unix seconds of the newest note updated_at already imported. */
  cursors: Partial<Record<CallNoteEntityType, number>>;
  lastRunAt?: string;
  lastError?: string | null;
  backfillComplete?: boolean;
};

export type CallManager = { userId: string; extension: string | null };

function toNumber(value: unknown): number | null {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDigits(value: unknown): string {
  return String(value ?? '').replace(/[^\d]/g, '');
}

export function readCallsSyncState(config: unknown): CallsSyncState {
  const raw = config && typeof config === 'object' ? (config as Record<string, unknown>)[CALLS_SYNC_CONFIG_KEY] : null;
  const state = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const rawCursors = state.cursors && typeof state.cursors === 'object' ? (state.cursors as Record<string, unknown>) : {};
  const cursors: CallsSyncState['cursors'] = {};

  for (const entityType of CALL_NOTE_ENTITY_TYPES) {
    const cursor = toNumber(rawCursors[entityType]);

    if (cursor !== null && cursor > 0) cursors[entityType] = cursor;
  }

  return {
    cursors,
    lastRunAt: typeof state.lastRunAt === 'string' ? state.lastRunAt : undefined,
    lastError: typeof state.lastError === 'string' ? state.lastError : null,
    backfillComplete: state.backfillComplete === true,
  };
}

/**
 * Maps one amoCRM call note to a `calls` row. The caller is the note's responsible user (amoCRM telephony
 * integrations set it to the manager on the line), falling back to its author.
 */
export function noteToCallRow(
  note: AmoCRMNote,
  entityType: CallNoteEntityType,
  tenantId: string,
  managersByAmoUserId: ReadonlyMap<string, CallManager>,
): Prisma.CallCreateManyInput | null {
  const noteType = String(note.note_type || '');

  if (!CALL_NOTE_TYPES.includes(noteType) || note.id === undefined || note.id === null) return null;
  const createdAt = toNumber(note.created_at);

  if (createdAt === null || createdAt <= 0) return null;

  const params = note.params && typeof note.params === 'object' ? note.params : {};
  const amoUserId = [note.responsible_user_id, note.created_by]
    .map((value) => String(value ?? '').trim())
    .find((value) => value && value !== '0') || null;
  const manager = amoUserId ? managersByAmoUserId.get(amoUserId) : undefined;
  const extension = manager?.extension || '';
  const phone = String(params.phone ?? '').trim();
  const duration = Math.max(0, Math.round(toNumber(params.duration) ?? 0));
  const direction = noteType === 'call_in' ? 'inbound' : 'outbound';
  const startedAt = new Date(createdAt * 1000);
  const uniq = String(params.uniq ?? '').trim();

  return {
    tenantId,
    provider: AMOCRM_CALL_PROVIDER,
    callIdExternal: uniq ? `uniq:${uniq}` : `note:${entityType}:${note.id}`,
    from: direction === 'outbound' ? extension : phone,
    to: direction === 'outbound' ? phone : extension,
    direction,
    duration,
    status: duration > 0 ? 'completed' : 'missed',
    startedAt,
    endedAt: new Date(startedAt.getTime() + duration * 1000),
    metadata: {
      source: 'amocrm_note',
      note_id: String(note.id),
      entity_type: entityType,
      entity_id: note.entity_id !== undefined ? String(note.entity_id) : null,
      amocrm_user_id: amoUserId,
      manager_user_id: manager?.userId ?? null,
      normalized_extension: extension || null,
      call_status: params.call_status ?? null,
      call_result: params.call_result ?? null,
      link: typeof params.link === 'string' ? params.link : null,
    },
  };
}

async function loadManagersByAmoUserId(tenantId: string): Promise<Map<string, CallManager>> {
  const users = await prisma.user.findMany({
    where: { tenantId, amocrmResponsibleUserId: { not: null } },
    select: { id: true, amocrmResponsibleUserId: true, utelManagerExternalId: true },
  });
  const map = new Map<string, CallManager>();

  for (const user of users) {
    const amoUserId = String(user.amocrmResponsibleUserId || '').trim();

    if (!amoUserId) continue;
    map.set(amoUserId, { userId: user.id, extension: normalizeDigits(user.utelManagerExternalId) || null });
  }

  return map;
}

/**
 * Calls imported before a manager got a Utel extension have an empty extension side; fill it in now so those
 * calls start counting for that manager.
 */
async function attachLateExtensions(tenantId: string, managers: ReadonlyMap<string, CallManager>): Promise<number> {
  const pending = await prisma.$queryRaw<Array<{ amo_user_id: string | null }>>`
    SELECT DISTINCT metadata->>'amocrm_user_id' AS amo_user_id
    FROM calls
    WHERE "tenantId" = ${tenantId}
      AND provider = ${AMOCRM_CALL_PROVIDER}
      AND ((direction = 'outbound' AND "from" = '') OR (direction = 'inbound' AND "to" = ''))
  `;
  let updated = 0;

  for (const row of pending) {
    const amoUserId = row.amo_user_id;
    const extension = amoUserId ? managers.get(amoUserId)?.extension : null;

    if (!amoUserId || !extension) continue;
    const base = { tenantId, provider: AMOCRM_CALL_PROVIDER, metadata: { path: ['amocrm_user_id'], equals: amoUserId } };
    const [outbound, inbound] = await Promise.all([
      prisma.call.updateMany({ where: { ...base, direction: 'outbound', from: '' }, data: { from: extension } }),
      prisma.call.updateMany({ where: { ...base, direction: 'inbound', to: '' }, data: { to: extension } }),
    ]);

    updated += outbound.count + inbound.count;
  }

  return updated;
}

async function saveSyncState(integrationId: string, state: CallsSyncState): Promise<void> {
  // Re-read the config so settings saved while the sync ran are not overwritten.
  const fresh = await prisma.integration.findUnique({ where: { id: integrationId }, select: { config: true } });
  const config = fresh?.config && typeof fresh.config === 'object' ? (fresh.config as Record<string, unknown>) : {};

  await prisma.integration.update({
    where: { id: integrationId },
    data: { config: { ...config, [CALLS_SYNC_CONFIG_KEY]: state } as Prisma.InputJsonValue },
  });
}

export type CallsSyncResult = { imported: number; complete: boolean };

/** Imports new call notes for one tenant. Safe to run concurrently: rows are unique per provider + call id. */
export async function syncTenantAmoCalls(tenantId: string, now = new Date()): Promise<CallsSyncResult | null> {
  const amoContext = await getTenantAmoCRMContext(tenantId);

  if (!amoContext) return null;

  const state = readCallsSyncState(amoContext.config);
  const backfillFrom = Math.floor(getPreviousTashkentMonthStart(now).getTime() / 1000);
  const managers = await loadManagersByAmoUserId(tenantId);
  const cursors = { ...state.cursors };
  let imported = 0;
  let complete = true;
  const startedAt = Date.now();

  try {
    await attachLateExtensions(tenantId, managers);
    for (const entityType of CALL_NOTE_ENTITY_TYPES) {
      const from = cursors[entityType] ?? backfillFrom;
      let newest = from;
      let page = 1;

      for (; page <= MAX_PAGES_PER_RUN; page += 1) {
        const notes = await amocrmService.fetchNotes(
          amoContext.accessToken,
          entityType,
          {
            page,
            limit: NOTES_PAGE_SIZE,
            noteTypes: CALL_NOTE_TYPES,
            updatedAtFrom: new Date(from * 1000),
            orderByUpdatedAsc: true,
          },
          amoContext.baseUrl,
        );
        const rows = notes
          .map((note) => noteToCallRow(note, entityType, tenantId, managers))
          .filter((row): row is Prisma.CallCreateManyInput => row !== null);

        if (rows.length) {
          const result = await prisma.call.createMany({ data: rows, skipDuplicates: true });

          imported += result.count;
        }
        for (const note of notes) {
          const updatedAt = toNumber(note.updated_at) ?? toNumber(note.created_at);

          if (updatedAt !== null && updatedAt > newest) newest = updatedAt;
        }
        if (notes.length < NOTES_PAGE_SIZE) break;
      }
      if (page > MAX_PAGES_PER_RUN) complete = false;
      // Resume from the newest note seen; the boundary second is re-read and skipped as a duplicate.
      cursors[entityType] = newest;
    }

    await saveSyncState(amoContext.integrationId, {
      cursors,
      lastRunAt: now.toISOString(),
      lastError: null,
      backfillComplete: state.backfillComplete || complete,
    });
    log(LogLevel.INFO, 'amoCRM calls synced', { tenantId, imported, complete, ms: Date.now() - startedAt });

    return { imported, complete };
  } catch (error) {
    const message = String((error as Error | undefined)?.message || error);

    // Keep the progress made before the failure.
    await saveSyncState(amoContext.integrationId, {
      cursors,
      lastRunAt: now.toISOString(),
      lastError: message,
      backfillComplete: state.backfillComplete,
    }).catch(() => undefined);
    log(LogLevel.WARN, 'amoCRM calls sync failed', { tenantId, imported, error: message });
    throw error;
  }
}

const runningTenants = new Set<string>();

/** Runs a sync for the tenant unless one is already running in this process. */
export async function triggerTenantAmoCallsSync(tenantId: string): Promise<void> {
  if (runningTenants.has(tenantId)) return;
  runningTenants.add(tenantId);
  try {
    await syncTenantAmoCalls(tenantId);
  } finally {
    runningTenants.delete(tenantId);
  }
}

/** Syncs every tenant whose amoCRM integration is set to be the calls source. */
export async function syncAllAmoCalls(): Promise<void> {
  const integrations = await prisma.integration.findMany({
    where: { type: 'amocrm', status: 'active' },
    select: { tenantId: true, config: true },
  });

  for (const integration of integrations) {
    if (readCallsSource(integration.config) !== 'amocrm') continue;
    await triggerTenantAmoCallsSync(integration.tenantId).catch(() => undefined);
  }
}

let timer: NodeJS.Timeout | null = null;

export function startAmoCallsSyncScheduler(): void {
  if (timer) return;
  const run = () => {
    syncAllAmoCalls().catch((error: unknown) => {
      log(LogLevel.WARN, 'amoCRM calls sync run failed', { error: String((error as Error | undefined)?.message || error) });
    });
  };

  run();
  timer = setInterval(run, SYNC_INTERVAL_MS);
}

export function stopAmoCallsSyncScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
