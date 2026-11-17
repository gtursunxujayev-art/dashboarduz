import type { DbClient } from '@dashboarduz/db';

import { type AmoCRMLead, type AmoCRMLeadPipeline, amocrmService } from '../integrations/amocrm';
import { fetchSnapshotLeads } from '../integrations/amocrm-lead-snapshot-read';

import { asString, parseAmoDate } from './metrics';

export async function computeLeadResponseTimes(params: {
  accessToken: string;
  baseUrl: string | undefined;
  managerIds: string[];
  newLeads: AmoCRMLead[];
  rangeStart: Date;
  rangeEnd: Date;
}): Promise<Map<string, { avgResponseSeconds: number; medianResponseSeconds: number; respondedCount: number; totalCount: number }>> {
  const result = new Map<string, { avgResponseSeconds: number; medianResponseSeconds: number; respondedCount: number; totalCount: number }>();

  if (!params.newLeads.length || !params.managerIds.length) {
    return result;
  }

  // Fetch events (notes, status changes, etc.) for leads in the period
  let events: Array<Record<string, unknown>> = [];

  try {
    events = await amocrmService.fetchAllEvents(
      params.accessToken,
      {
        dateFrom: params.rangeStart,
        dateTo: params.rangeEnd,
        userIds: params.managerIds,
        entityType: 'lead',
        limit: 250,
        maxPages: 30,
      },
      params.baseUrl,
    );
  } catch {
    return result;
  }

  // Map entity_id -> earliest event timestamp (seconds)
  const firstEventByLead = new Map<string, number>();

  for (const event of events) {
    const entityId = String(event.entity_id ?? '').trim();

    if (!entityId) continue;
    const createdAt = event.created_at;
    let eventTs: number | null = null;

    if (typeof createdAt === 'number' && Number.isFinite(createdAt)) {
      eventTs = createdAt > 1_000_000_000_000 ? createdAt / 1000 : createdAt;
    } else if (typeof createdAt === 'string') {
      const asNum = Number(createdAt);

      if (!Number.isNaN(asNum)) {
        eventTs = asNum > 1_000_000_000_000 ? asNum / 1000 : asNum;
      }
    }
    if (eventTs === null) continue;
    const existing = firstEventByLead.get(entityId);

    if (!existing || eventTs < existing) {
      firstEventByLead.set(entityId, eventTs);
    }
  }

  // Group new leads by responsible manager
  const leadsByManager = new Map<string, AmoCRMLead[]>();
  const managerIdSet = new Set(params.managerIds);

  for (const lead of params.newLeads) {
    const managerId = asString(lead.responsible_user_id);

    if (!managerId || !managerIdSet.has(managerId)) continue;
    const current = leadsByManager.get(managerId) || [];

    current.push(lead);
    leadsByManager.set(managerId, current);
  }

  // Calculate response times per manager
  for (const [managerId, leads] of leadsByManager.entries()) {
    const responseTimes: number[] = [];

    for (const lead of leads) {
      const leadId = asString(lead.id);

      if (!leadId) continue;
      const leadCreatedAt = parseAmoDate(lead.created_at).getTime() / 1000;
      const firstEvent = firstEventByLead.get(leadId);

      if (firstEvent !== undefined && firstEvent > leadCreatedAt) {
        responseTimes.push(firstEvent - leadCreatedAt);
      }
    }
    const totalCount = leads.length;
    const respondedCount = responseTimes.length;

    if (respondedCount === 0) {
      result.set(managerId, { avgResponseSeconds: 0, medianResponseSeconds: 0, respondedCount: 0, totalCount });
      continue;
    }
    const avg = responseTimes.reduce((s, v) => s + v, 0) / respondedCount;
    const sorted = responseTimes.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : (sorted[mid] ?? 0);

    result.set(managerId, {
      avgResponseSeconds: Math.round(avg),
      medianResponseSeconds: Math.round(median as number),
      respondedCount,
      totalCount,
    });
  }

  return result;
}

export function getSelectedPipelines(
  selectedPipelineIds: string[] | null,
  pipelines: AmoCRMLeadPipeline[],
): string[] {
  if (selectedPipelineIds !== null) {
    return selectedPipelineIds.map((id) => String(id).trim()).filter(Boolean);
  }

  return pipelines
    .map((pipeline) => asString(pipeline.id))
    .filter(Boolean) as string[];
}

export function buildStatusFilters(
  selectedPipelineIds: string[],
  pipelines: AmoCRMLeadPipeline[],
  statusIds: string[],
): Array<{ pipelineId: string; statusId: string }> {
  if (selectedPipelineIds.length === 0 || statusIds.length === 0) {
    return [];
  }

  const selected = new Set(selectedPipelineIds);
  const unique = new Set<string>();
  const filters: Array<{ pipelineId: string; statusId: string }> = [];

  for (const pipeline of pipelines) {
    const pipelineId = asString(pipeline.id);

    if (!pipelineId || !selected.has(pipelineId)) {
      continue;
    }

    const statuses = Array.isArray(pipeline._embedded?.statuses) ? pipeline._embedded.statuses : [];
    const availableStatusIds = new Set(
      statuses
        .map((status) => asString(status.id))
        .filter(Boolean) as string[],
    );

    for (const statusId of statusIds) {
      if (!availableStatusIds.has(statusId)) {
        continue;
      }

      const key = `${pipelineId}:${statusId}`;

      if (unique.has(key)) {
        continue;
      }
      unique.add(key);
      filters.push({ pipelineId, statusId });
    }
  }

  return filters;
}

/** Snapshot leads in the given pipeline/status pairs, assigned to the given managers. */
export async function fetchLeadsByStatusFilters(
  tenantId: string,
  db: DbClient,
  pipelineIds: string[],
  statusFilters: Array<{ pipelineId: string; statusId: string }>,
  responsibleUserIds: string[],
  rangeStart?: Date,
  rangeEnd?: Date,
): Promise<AmoCRMLead[]> {
  if (pipelineIds.length === 0 || statusFilters.length === 0 || responsibleUserIds.length === 0) {
    return [];
  }

  return fetchSnapshotLeads(
    tenantId,
    {
      pipelineIds,
      statusFilters,
      responsibleUserIds,
      createdAtFrom: rangeStart,
      createdAtTo: rangeEnd,
    },
    db,
  );
}
