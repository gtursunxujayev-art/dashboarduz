/**
 * Reads amoCRM leads from the per-tenant snapshot in the `leads` table instead of calling
 * amoCRM on every request. The snapshot is filled by `amocrm-lead-snapshot.ts` (hourly and on
 * demand); the filters here mirror the ones `amocrmService.fetchLeads` sent to amoCRM.
 */
import { systemPrisma, type DbClient } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';

import { asObject } from '../../lib/object';

import { amocrmService, type AmoCRMLead, type AmoCRMLeadListResponse } from './amocrm';
import { readLeadSnapshotState } from './amocrm-lead-snapshot';
import { dedupeByAmoId } from './amocrm-lead-store';
import { isRangeInSnapshot } from './amocrm-snapshot-window';

export type SnapshotLeadQuery = {
  pipelineIds?: string[] | null;
  statusFilters?: Array<{ pipelineId: string; statusId: string }> | null;
  responsibleUserIds?: string[] | null;
  /** Case-insensitive match on the lead id, name and stored payload (names, phones, field values). */
  query?: string;
  createdAtFrom?: Date;
  createdAtTo?: Date;
};

type SnapshotLeadRow = {
  amocrmId: string | null;
  title: string;
  status: string | null;
  pipelineId: string | null;
  responsibleUserId: string | null;
  metadata: Prisma.JsonValue | null;
  externalCreatedAt: Date | null;
  externalUpdatedAt: Date | null;
};

const ROW_SELECT = {
  amocrmId: true,
  title: true,
  status: true,
  pipelineId: true,
  responsibleUserId: true,
  metadata: true,
  externalCreatedAt: true,
  externalUpdatedAt: true,
} as const;

// Newest first, like the leads list in amoCRM; the id breaks ties so pages are stable.
const ROW_ORDER: Prisma.LeadOrderByWithRelationInput[] = [
  { externalCreatedAt: { sort: 'desc', nulls: 'last' } },
  { amocrmId: 'desc' },
];

function cleanIds(values: string[] | null | undefined): string[] | null {
  if (!values) return null;

  return values.map((value) => String(value).trim()).filter(Boolean);
}

export function buildSnapshotLeadWhere(tenantId: string, query: SnapshotLeadQuery = {}): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { tenantId, amocrmId: { not: null } };
  const pipelineIds = cleanIds(query.pipelineIds);
  const responsibleUserIds = cleanIds(query.responsibleUserIds);
  const statusFilters = (query.statusFilters || []).filter((filter) => filter.pipelineId && filter.statusId);

  // An empty list matches nothing, as an empty amoCRM filter would.
  if (pipelineIds) where.pipelineId = { in: pipelineIds };
  if (responsibleUserIds) where.responsibleUserId = { in: responsibleUserIds };
  if (query.statusFilters) {
    where.OR = statusFilters.map((filter) => ({ pipelineId: filter.pipelineId, status: filter.statusId }));
  }
  if (query.createdAtFrom || query.createdAtTo) {
    where.externalCreatedAt = {
      ...(query.createdAtFrom ? { gte: query.createdAtFrom } : {}),
      ...(query.createdAtTo ? { lte: query.createdAtTo } : {}),
    };
  }

  return where;
}

function dateToUnixSeconds(value: Date | null): number | undefined {
  return value ? Math.floor(value.getTime() / 1000) : undefined;
}

/**
 * The stored amoCRM payload, with the indexed columns laid over it: webhooks keep those columns
 * current between refreshes without replacing the payload.
 */
export function snapshotRowToLead(row: SnapshotLeadRow): AmoCRMLead {
  const payload = asObject(row.metadata) || {};
  const lead: AmoCRMLead = { ...payload };
  const numericId = Number(row.amocrmId);

  lead.id = Number.isFinite(numericId) ? numericId : row.amocrmId ?? undefined;
  lead.name = row.title;
  if (row.status !== null) lead.status_id = Number(row.status) || row.status;
  if (row.pipelineId !== null) lead.pipeline_id = Number(row.pipelineId) || row.pipelineId;
  if (row.responsibleUserId !== null) lead.responsible_user_id = Number(row.responsibleUserId) || row.responsibleUserId;
  lead.created_at = dateToUnixSeconds(row.externalCreatedAt) ?? lead.created_at;
  lead.updated_at = dateToUnixSeconds(row.externalUpdatedAt) ?? lead.updated_at;

  return lead;
}

function matchesQuery(row: SnapshotLeadRow, needle: string): boolean {
  if (row.amocrmId === needle) return true;
  if (row.title.toLowerCase().includes(needle)) return true;

  return JSON.stringify(row.metadata ?? '').toLowerCase().includes(needle);
}

function normalizeQuery(query: string | undefined): string | null {
  const normalized = (query || '').trim().toLowerCase();

  return normalized.length > 0 ? normalized : null;
}

/** Every snapshot lead that matches, like `amocrmService.fetchAllLeads` without the page cap. */
export async function fetchSnapshotLeads(
  tenantId: string,
  query: SnapshotLeadQuery = {},
  db: DbClient = systemPrisma,
): Promise<AmoCRMLead[]> {
  const rows = await db.lead.findMany({
    where: buildSnapshotLeadWhere(tenantId, query),
    select: ROW_SELECT,
    orderBy: ROW_ORDER,
  });
  const needle = normalizeQuery(query.query);
  const unique = dedupeByAmoId(rows);
  const matched = needle ? unique.filter((row) => matchesQuery(row, needle)) : unique;

  return matched.map(snapshotRowToLead);
}

/**
 * One page of snapshot leads in the shape `amocrmService.fetchLeads` returns, so paging callers
 * keep following `_links.next`.
 */
export async function fetchSnapshotLeadPage(
  tenantId: string,
  params: SnapshotLeadQuery & { page?: number; limit?: number },
  db: DbClient = systemPrisma,
): Promise<AmoCRMLeadListResponse> {
  const page = Math.max(Math.floor(params.page || 1), 1);
  const limit = Math.min(Math.max(Math.floor(params.limit || 250), 1), 250);
  const offset = (page - 1) * limit;
  const needle = normalizeQuery(params.query);
  let rows: SnapshotLeadRow[];
  let hasNext: boolean;

  if (needle) {
    const all = await db.lead.findMany({
      where: buildSnapshotLeadWhere(tenantId, params),
      select: ROW_SELECT,
      orderBy: ROW_ORDER,
    });
    const matched = dedupeByAmoId(all).filter((row) => matchesQuery(row, needle));

    rows = matched.slice(offset, offset + limit);
    hasNext = matched.length > offset + limit;
  } else {
    const fetched = await db.lead.findMany({
      where: buildSnapshotLeadWhere(tenantId, params),
      select: ROW_SELECT,
      orderBy: ROW_ORDER,
      skip: offset,
      take: limit + 1,
    });

    rows = dedupeByAmoId(fetched.slice(0, limit));
    hasNext = fetched.length > limit;
  }

  return {
    _embedded: { leads: rows.map(snapshotRowToLead) },
    ...(hasNext ? { _links: { next: { href: `snapshot:page=${page + 1}` } } } : {}),
  };
}

/** One snapshot lead by its amoCRM id, or `null` when the snapshot does not have it. */
export async function fetchSnapshotLeadById(
  tenantId: string,
  amocrmId: string,
  db: DbClient = systemPrisma,
): Promise<AmoCRMLead | null> {
  const row = await db.lead.findUnique({
    where: { tenantId_amocrmId: { tenantId, amocrmId } },
    select: ROW_SELECT,
  });

  return row ? snapshotRowToLead(row) : null;
}

export type AmoAccess = { accessToken: string; baseUrl?: string };

/** The lead snapshot answers once its first full pull (window + open leads) has finished. */
export async function isLeadSnapshotReady(tenantId: string, db: DbClient = systemPrisma): Promise<boolean> {
  const integration = await db.integration.findUnique({
    where: { tenantId_type: { tenantId, type: 'amocrm' } },
    select: { config: true },
  });

  return Boolean(readLeadSnapshotState(integration?.config).lastFullSyncAt);
}

/**
 * Whether a lead query can be answered from the snapshot. It holds leads created in the last
 * SNAPSHOT_WINDOW_DAYS plus every open lead, so a query with no start date (current stages) is
 * served too. Free-text search and ranges starting earlier go to amoCRM.
 */
export function leadQueryUsesSnapshot(query: SnapshotLeadQuery, ready: boolean, now: Date = new Date()): boolean {
  if (!ready || normalizeQuery(query.query)) return false;
  if (!query.createdAtFrom) return true;

  return isRangeInSnapshot(query.createdAtFrom, ready, now);
}

function liveLeadFilters(query: SnapshotLeadQuery) {
  return {
    pipelineIds: query.pipelineIds ?? undefined,
    statusFilters: query.statusFilters ?? undefined,
    responsibleUserIds: query.responsibleUserIds ?? undefined,
    query: query.query,
    createdAtFrom: query.createdAtFrom,
    createdAtTo: query.createdAtTo,
  };
}

/** Matching leads: from the snapshot inside its window, otherwise from amoCRM. */
export async function getAmoLeads(
  tenantId: string,
  query: SnapshotLeadQuery,
  access: AmoAccess,
  db: DbClient = systemPrisma,
): Promise<AmoCRMLead[]> {
  if (leadQueryUsesSnapshot(query, await isLeadSnapshotReady(tenantId, db))) {
    return fetchSnapshotLeads(tenantId, query, db);
  }

  return amocrmService.fetchAllLeads(access.accessToken, { ...liveLeadFilters(query), limit: 250 }, access.baseUrl);
}

/** One page of leads in amoCRM's list shape: snapshot inside its window, otherwise amoCRM. */
export async function getAmoLeadPage(
  tenantId: string,
  params: SnapshotLeadQuery & { page?: number; limit?: number },
  access: AmoAccess,
  db: DbClient = systemPrisma,
): Promise<AmoCRMLeadListResponse & { source: 'snapshot' | 'amocrm' }> {
  if (leadQueryUsesSnapshot(params, await isLeadSnapshotReady(tenantId, db))) {
    return { ...(await fetchSnapshotLeadPage(tenantId, params, db)), source: 'snapshot' };
  }
  const response = await amocrmService.fetchLeads(access.accessToken, '', {
    ...liveLeadFilters(params),
    page: params.page,
    limit: params.limit,
  }, access.baseUrl);

  return { ...response, source: 'amocrm' };
}
