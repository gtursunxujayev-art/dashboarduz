/**
 * Reads amoCRM tasks, lead events and reference data from the database snapshot (filled by
 * amocrm-activity-snapshot.ts). The filters mirror the amoCRM API filters the callers used before,
 * and rows come back in amoCRM's shape (the stored payload with the indexed columns laid over it),
 * so existing calculations work unchanged.
 */
import { systemPrisma, type DbClient } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';

import { logger } from '../../lib/logger';
import { asObject } from '../../lib/object';

import {
  amocrmService,
  type AmoCRMEvent,
  type AmoCRMLeadCustomFieldsResponse,
  type AmoCRMLeadPipelinesResponse,
  type AmoCRMTask,
  type AmoCRMUser,
} from './amocrm';
import { isRangeInSnapshot } from './amocrm-snapshot-window';

export type AmoReferenceKind = 'users' | 'pipelines' | 'lead_custom_fields';

type AmoReferencePayload = {
  users: AmoCRMUser[];
  pipelines: AmoCRMLeadPipelinesResponse;
  lead_custom_fields: AmoCRMLeadCustomFieldsResponse;
};

function unixSeconds(value: Date | null): number | undefined {
  return value ? Math.floor(value.getTime() / 1000) : undefined;
}

function cleanIds(values: string[] | null | undefined): string[] | null {
  if (!values) return null;

  return values.map((value) => String(value).trim()).filter(Boolean);
}

export type SnapshotTaskQuery = {
  responsibleUserIds?: string[] | null;
  /** true: completed only, false: open only, undefined: both (the API's filter[is_completed]). */
  completed?: boolean;
  /** Deadline window, like the API's filter[complete_till]. */
  dateFrom?: Date;
  dateTo?: Date;
  /** 'leads' / 'lead' keeps lead tasks only. */
  entityType?: string;
};

export function buildSnapshotTaskWhere(tenantId: string, query: SnapshotTaskQuery): Prisma.AmocrmTaskWhereInput {
  const where: Prisma.AmocrmTaskWhereInput = { tenantId };
  const responsibleUserIds = cleanIds(query.responsibleUserIds);

  if (responsibleUserIds) where.responsibleUserId = { in: responsibleUserIds };
  if (typeof query.completed === 'boolean') where.isCompleted = query.completed;
  if (query.dateFrom || query.dateTo) {
    where.completeTill = {
      ...(query.dateFrom ? { gte: query.dateFrom } : {}),
      ...(query.dateTo ? { lte: query.dateTo } : {}),
    };
  }
  if (query.entityType) {
    const singular = query.entityType.replace(/s$/, '');

    where.entityType = { in: [singular, `${singular}s`] };
  }

  return where;
}

/** Tasks from the snapshot, shaped like `amocrmService.fetchAllTasks` results. */
export async function fetchSnapshotTasks(
  tenantId: string,
  query: SnapshotTaskQuery,
  db: DbClient = systemPrisma,
): Promise<AmoCRMTask[]> {
  const rows = await db.amocrmTask.findMany({
    where: buildSnapshotTaskWhere(tenantId, query),
    select: { amocrmId: true, responsibleUserId: true, entityType: true, isCompleted: true, completeTill: true, externalCreatedAt: true, externalUpdatedAt: true, payload: true },
  });

  return rows.map((row) => ({
    ...(asObject(row.payload) || {}),
    id: Number(row.amocrmId) || row.amocrmId,
    responsible_user_id: row.responsibleUserId ?? undefined,
    entity_type: row.entityType ?? undefined,
    is_completed: row.isCompleted,
    complete_till: unixSeconds(row.completeTill),
    created_at: unixSeconds(row.externalCreatedAt),
    updated_at: unixSeconds(row.externalUpdatedAt),
  }));
}

export type SnapshotEventQuery = {
  dateFrom?: Date;
  dateTo?: Date;
  /** Actor (created_by) filter, like the API's filter[created_by]. */
  userIds?: string[] | null;
  /** 'lead' keeps lead events only (the snapshot stores lead events). */
  entityType?: string;
};

export function buildSnapshotEventWhere(tenantId: string, query: SnapshotEventQuery): Prisma.AmocrmEventWhereInput {
  const where: Prisma.AmocrmEventWhereInput = { tenantId };
  const userIds = cleanIds(query.userIds);

  if (userIds) where.createdBy = { in: userIds };
  if (query.dateFrom || query.dateTo) {
    where.externalCreatedAt = {
      ...(query.dateFrom ? { gte: query.dateFrom } : {}),
      ...(query.dateTo ? { lte: query.dateTo } : {}),
    };
  }
  if (query.entityType) {
    const singular = query.entityType.replace(/s$/, '');

    where.entityType = { in: [singular, `${singular}s`] };
  }

  return where;
}

/** Lead events from the snapshot, shaped like `amocrmService.fetchAllEvents` results. */
export async function fetchSnapshotEvents(
  tenantId: string,
  query: SnapshotEventQuery,
  db: DbClient = systemPrisma,
): Promise<AmoCRMEvent[]> {
  const rows = await db.amocrmEvent.findMany({
    where: buildSnapshotEventWhere(tenantId, query),
    select: { amocrmId: true, type: true, entityType: true, entityId: true, createdBy: true, externalCreatedAt: true, payload: true },
  });

  return rows.map((row) => ({
    ...(asObject(row.payload) || {}),
    id: row.amocrmId,
    type: row.type ?? undefined,
    entity_type: row.entityType ?? undefined,
    entity_id: row.entityId ? Number(row.entityId) || row.entityId : undefined,
    created_by: row.createdBy ? Number(row.createdBy) || row.createdBy : undefined,
    created_at: unixSeconds(row.externalCreatedAt),
  }));
}

export async function storeAmoReference(tenantId: string, kind: AmoReferenceKind, payload: unknown): Promise<void> {
  const data = { payload: payload as Prisma.InputJsonValue, refreshedAt: new Date() };

  await systemPrisma.amocrmReference.upsert({
    where: { tenantId_kind: { tenantId, kind } },
    update: data,
    create: { ...data, tenantId, kind },
  });
}

export type AmoAccess = { accessToken: string; baseUrl?: string };

const LIVE_LOADERS: { [K in AmoReferenceKind]: (access: AmoAccess) => Promise<AmoReferencePayload[K]> } = {
  users: (access) => amocrmService.fetchAllUsers(access.accessToken, { limit: 250 }, access.baseUrl),
  pipelines: (access) => amocrmService.fetchPipelines(access.accessToken, access.baseUrl),
  lead_custom_fields: (access) => amocrmService.fetchLeadCustomFields(access.accessToken, access.baseUrl),
};

/**
 * Stored users / pipelines / lead custom fields. Only when the snapshot has none yet (first minutes
 * after connecting) is amoCRM asked once, and the answer is stored for everyone after.
 */
export async function getAmoReference<K extends AmoReferenceKind>(
  tenantId: string,
  kind: K,
  access: AmoAccess,
  db: DbClient = systemPrisma,
): Promise<AmoReferencePayload[K]> {
  const stored = await db.amocrmReference.findUnique({
    where: { tenantId_kind: { tenantId, kind } },
    select: { payload: true },
  });

  if (stored) return stored.payload as unknown as AmoReferencePayload[K];
  const live = await LIVE_LOADERS[kind](access);

  await storeAmoReference(tenantId, kind, live).catch((error: unknown) => {
    logger.warn({ tenantId, kind, error: String((error as Error | undefined)?.message || error) }, 'amoCRM reference: could not store');
  });

  return live;
}

/** Re-reads one kind from amoCRM now (after the admin changes something), keeping it for everyone. */
export async function refreshAmoReference<K extends AmoReferenceKind>(
  tenantId: string,
  kind: K,
  access: AmoAccess,
): Promise<AmoReferencePayload[K]> {
  const live = await LIVE_LOADERS[kind](access);

  await storeAmoReference(tenantId, kind, live);

  return live;
}

export type ActivityReadiness = { tasks: boolean; openTasks: boolean; events: boolean };

/** Which activity streams have finished their first fill (see amocrm-activity-snapshot.ts state). */
export function readActivityReadiness(config: unknown): ActivityReadiness {
  const state = asObject(asObject(config)?.activity_snapshot) || {};
  const tasks = asObject(state.tasks) || {};
  const events = asObject(state.events) || {};

  return {
    tasks: tasks.backfillComplete === true && tasks.openTasksLoaded === true,
    openTasks: tasks.openTasksLoaded === true,
    events: events.backfillComplete === true,
  };
}

async function getActivityReadiness(tenantId: string, db: DbClient): Promise<ActivityReadiness> {
  const integration = await db.integration.findUnique({
    where: { tenantId_type: { tenantId, type: 'amocrm' } },
    select: { config: true },
  });

  return readActivityReadiness(integration?.config);
}

/** Whether a task query can be answered from the snapshot (open tasks of any age, finished ones in the window). */
export function taskQueryUsesSnapshot(query: SnapshotTaskQuery, readiness: ActivityReadiness, now: Date = new Date()): boolean {
  if (query.completed === false && !query.dateFrom) return readiness.openTasks;

  return isRangeInSnapshot(query.dateFrom, readiness.tasks, now);
}

/** Tasks: from the snapshot inside its window, otherwise from amoCRM. */
export async function getAmoTasks(
  tenantId: string,
  query: SnapshotTaskQuery,
  access: AmoAccess,
  db: DbClient = systemPrisma,
): Promise<AmoCRMTask[]> {
  if (taskQueryUsesSnapshot(query, await getActivityReadiness(tenantId, db))) {
    return fetchSnapshotTasks(tenantId, query, db);
  }

  return amocrmService.fetchAllTasks(access.accessToken, {
    responsibleUserIds: query.responsibleUserIds ?? undefined,
    completed: query.completed,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    entityType: query.entityType,
    limit: 250,
    maxPages: 80,
  }, access.baseUrl);
}

/** Lead events: from the snapshot inside its window, otherwise from amoCRM. */
export async function getAmoEvents(
  tenantId: string,
  query: SnapshotEventQuery,
  access: AmoAccess,
  db: DbClient = systemPrisma,
): Promise<AmoCRMEvent[]> {
  const readiness = await getActivityReadiness(tenantId, db);

  if (isRangeInSnapshot(query.dateFrom, readiness.events)) {
    return fetchSnapshotEvents(tenantId, query, db);
  }

  return amocrmService.fetchAllEvents(access.accessToken, {
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    userIds: query.userIds ?? undefined,
    entityType: query.entityType,
    limit: 250,
    maxPages: 120,
  }, access.baseUrl);
}
