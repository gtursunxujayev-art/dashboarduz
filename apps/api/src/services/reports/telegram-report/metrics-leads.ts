/**
 * Lead side of the Telegram report: which leads are qualified / non-qualified (per the tenant's dashboard
 * settings), their loss reasons and sources, and leads per amoCRM manager. Reads live amoCRM leads when
 * the integration is connected, else the local lead table.
 */
import { type DbClient, type Prisma } from '@dashboarduz/db';

import { logger } from '../../../lib/logger';
import { asObject, asObjectOrEmpty } from '../../../lib/object';
import { isMappedValue } from '../../dashboard/catalog-fields';
import { getAmoLeads } from '../../integrations/amocrm-lead-snapshot-read';
import { extractLeadValue, getTenantAmoCRMContext } from '../../integrations/amocrm-live';

import { isLostLeadStatus } from './format';

/** Loss reason bucket for a non-qualified lead without a reason (unreachable while a reason must match). */
const NO_REASON_LABEL = "Sabab ko'rsatilmagan";

/** The `dashboard` settings that decide lead quality, and the lead fields holding the loss reason and source. */
export type LeadOutcomeSettings = {
  qualifiedStageIds: string[];
  qualifiedValues: string[];
  nonQualifiedValues: string[];
  reasonFieldKey: string | null;
  sourceFieldKey: string | null;
};

export type ManagerLeadCounts = { leads: number; qualified: number; nonQualified: number };

/** Loss reasons and sources (label → count) and lead counters per amoCRM manager id, in first-seen order. */
export type LeadTally = {
  reasons: Map<string, number>;
  sources: Map<string, number>;
  managerLeadsByAmoId: Map<string, ManagerLeadCounts>;
};

/** One lead, reduced to what the report counts. */
export type ReportLeadFacts = {
  statusId: string;
  reasonValue: string | null;
  sourceValue: string | null;
  responsibleUserId: string;
};

export type ReportLeadMetrics = { newLeads: number; qualifiedLeads: number; tally: LeadTally };

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Reads `tenantSettings.dashboard`; anything missing or of the wrong type gives empty lists / null. */
export function readLeadOutcomeSettings(tenantSettings: unknown): LeadOutcomeSettings {
  const dashboard = asObjectOrEmpty(asObject(tenantSettings)?.dashboard);

  return {
    qualifiedStageIds: toStringList(dashboard.qualifiedStageIds),
    qualifiedValues: toStringList(dashboard.qualifiedValues),
    nonQualifiedValues: toStringList(dashboard.nonQualifiedValues),
    reasonFieldKey: stringOrNull(dashboard.reasonFieldKey),
    sourceFieldKey: stringOrNull(dashboard.sourceFieldKey),
  };
}

/** amoCRM-synced leads created in the period (by amoCRM's creation time, else ours), optionally in the given pipelines. */
export function buildReportLeadWhere(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
  pipelineIds: string[],
): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {
    tenantId,
    amocrmId: { not: null },
    OR: [
      { externalCreatedAt: { gte: periodStart, lte: periodEnd } },
      {
        externalCreatedAt: null,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
    ],
  };

  if (pipelineIds.length > 0) {
    where.pipelineId = { in: pipelineIds };
  }

  return where;
}

/** True when the trimmed value equals one of the mapped values, ignoring case; blank values never match. */
function matchesMappedValue(raw: string | null, mappedValues: string[]): boolean {
  const normalized = (raw || '').trim();

  return normalized !== '' && mappedValues.length > 0 && isMappedValue(normalized, mappedValues);
}

/**
 * Qualified: the status is a qualified stage (when stages are configured), else the reason is a qualified value.
 * Non-qualified: lost (status 143) with a reason listed as non-qualified.
 */
export function classifyLeadOutcome(
  settings: LeadOutcomeSettings,
  statusIdRaw: string,
  reasonValueRaw: string | null,
): { isQualified: boolean; isNonQualified: boolean } {
  const statusId = statusIdRaw.trim();
  const reasonValue = (reasonValueRaw || '').trim();
  const isQualified = settings.qualifiedStageIds.length > 0
    ? Boolean(statusId) && settings.qualifiedStageIds.includes(statusId)
    : matchesMappedValue(reasonValue, settings.qualifiedValues);
  const isNonQualified = isLostLeadStatus(statusId) && matchesMappedValue(reasonValue, settings.nonQualifiedValues);

  return { isQualified, isNonQualified };
}

export function createLeadTally(): LeadTally {
  return { reasons: new Map(), sources: new Map(), managerLeadsByAmoId: new Map() };
}

function increment(counts: Map<string, number>, label: string): void {
  counts.set(label, (counts.get(label) || 0) + 1);
}

/** Adds one lead to the tally and says whether it is qualified. */
export function tallyLead(tally: LeadTally, settings: LeadOutcomeSettings, lead: ReportLeadFacts): boolean {
  const { isQualified, isNonQualified } = classifyLeadOutcome(settings, lead.statusId, lead.reasonValue);

  if (isNonQualified) {
    increment(tally.reasons, lead.reasonValue || NO_REASON_LABEL);
  }
  if (lead.sourceValue) {
    increment(tally.sources, lead.sourceValue);
  }
  if (lead.responsibleUserId) {
    const counts = tally.managerLeadsByAmoId.get(lead.responsibleUserId) || { leads: 0, qualified: 0, nonQualified: 0 };

    counts.leads += 1;
    if (isQualified) counts.qualified += 1;
    if (isNonQualified) counts.nonQualified += 1;
    tally.managerLeadsByAmoId.set(lead.responsibleUserId, counts);
  }

  return isQualified;
}

/** The facts of a live amoCRM lead payload. */
export function amoLeadFacts(lead: Record<string, unknown>, settings: LeadOutcomeSettings): ReportLeadFacts {
  return {
    statusId: String(lead.status_id || '').trim(),
    reasonValue: extractLeadValue(lead, settings.reasonFieldKey),
    sourceValue: extractLeadValue(lead, settings.sourceFieldKey),
    responsibleUserId: String(lead.responsible_user_id || '').trim(),
  };
}

/** The facts of a local lead row (reason and source come from its metadata). */
export function localLeadFacts(
  lead: { status: string | null; responsibleUserId: string | null; metadata: unknown },
  settings: LeadOutcomeSettings,
): ReportLeadFacts {
  return {
    statusId: lead.status ? String(lead.status) : '',
    reasonValue: extractLeadValue(lead.metadata, settings.reasonFieldKey),
    sourceValue: extractLeadValue(lead.metadata, settings.sourceFieldKey),
    responsibleUserId: String(lead.responsibleUserId || '').trim(),
  };
}

/** `error.message` when present and non-empty, else "Unknown error". */
function warningText(error: unknown): unknown {
  return asObject(error)?.message || 'Unknown error';
}

/**
 * Counts from live amoCRM leads, or null when amoCRM is not connected or cannot be read. A read that fails
 * part-way leaves what it already counted in `tally` (the local fallback then adds to it).
 */
async function tallyLiveLeads(
  params: { tenantId: string; periodStart: Date; periodEnd: Date; selectedPipelineIds: string[]; db: DbClient },
  settings: LeadOutcomeSettings,
  tally: LeadTally,
): Promise<{ newLeads: number; qualifiedLeads: number } | null> {
  let amoContext: Awaited<ReturnType<typeof getTenantAmoCRMContext>> = null;

  try {
    amoContext = await getTenantAmoCRMContext(params.tenantId, params.db);
  } catch (error: unknown) {
    logger.warn({
      tenantId: params.tenantId,
      error: warningText(error),
    }, 'Report generation: failed to load AmoCRM context, falling back to local lead metrics');
  }
  if (!amoContext) {
    return null;
  }
  try {
    const liveLeads = await getAmoLeads(params.tenantId, {
      pipelineIds: params.selectedPipelineIds.length > 0 ? params.selectedPipelineIds : undefined,
      createdAtFrom: params.periodStart,
      createdAtTo: params.periodEnd,
    }, amoContext, params.db);
    let qualifiedLeads = 0;

    for (const lead of liveLeads) {
      if (tallyLead(tally, settings, amoLeadFacts(lead, settings))) {
        qualifiedLeads += 1;
      }
    }

    return { newLeads: liveLeads.length, qualifiedLeads };
  } catch (error: unknown) {
    logger.warn({
      tenantId: params.tenantId,
      error: warningText(error),
    }, 'Falling back to local lead metrics for report generation');

    return null;
  }
}

/** Counts from the local lead table: totals by query, reasons / sources / managers from up to 10 000 rows. */
async function tallyLocalLeads(
  db: DbClient,
  where: Prisma.LeadWhereInput,
  settings: LeadOutcomeSettings,
  tally: LeadTally,
): Promise<{ newLeads: number; qualifiedLeads: number }> {
  const [newLeads, qualifiedLeads, leadsDetailed] = await Promise.all([
    db.lead.count({ where }),
    settings.qualifiedStageIds.length > 0
      ? db.lead.count({
          where: {
            ...where,
            status: { in: settings.qualifiedStageIds },
          },
        })
      : Promise.resolve(0),
    db.lead.findMany({
      where,
      select: {
        status: true,
        responsibleUserId: true,
        metadata: true,
      },
      take: 10000,
    }),
  ]);

  for (const lead of leadsDetailed) {
    tallyLead(tally, settings, localLeadFacts(lead, settings));
  }

  return { newLeads, qualifiedLeads };
}

/** Lead counts for the report period: live amoCRM leads when possible, else the local leads. */
export async function collectReportLeadMetrics(params: {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  selectedPipelineIds: string[];
  db: DbClient;
}, settings: LeadOutcomeSettings): Promise<ReportLeadMetrics> {
  const tally = createLeadTally();
  const live = await tallyLiveLeads(params, settings, tally);

  if (live) {
    return { ...live, tally };
  }
  const where = buildReportLeadWhere(params.tenantId, params.periodStart, params.periodEnd, params.selectedPipelineIds);

  return { ...(await tallyLocalLeads(params.db, where, settings, tally)), tally };
}
