/**
 * Reads amoCRM leads from the per-tenant snapshot in the `leads` table instead of calling
 * amoCRM on every request. The snapshot is filled by `amocrm-lead-snapshot.ts` (hourly and on
 * demand); the filters here mirror the ones `amocrmService.fetchLeads` sent to amoCRM.
 */
import { systemPrisma, type DbClient } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';

import { asObject } from '../../lib/object';

import type { AmoCRMLead, AmoCRMLeadListResponse } from './amocrm';

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

function toUnixSeconds(value: Date | null): number | undefined {
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
  lead.created_at = toUnixSeconds(row.externalCreatedAt) ?? lead.created_at;
  lead.updated_at = toUnixSeconds(row.externalUpdatedAt) ?? lead.updated_at;

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
  const matched = needle ? rows.filter((row) => matchesQuery(row, needle)) : rows;

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
    const matched = all.filter((row) => matchesQuery(row, needle));

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

    rows = fetched.slice(0, limit);
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
