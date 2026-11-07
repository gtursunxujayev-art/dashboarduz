// Pure helpers for the Tahlil → Voronka (manager funnel + lost revenue) report.

export type FunnelStageRef = { pipelineId: string; statusId: string };

export type FunnelPipeline = {
  id: string;
  name: string;
  sort: number;
  statuses: Array<{ id: string; name: string; sort: number }>;
};

export type FunnelLeadLike = {
  id?: number | string | null;
  created_at?: number | string | null;
  pipeline_id?: number | string | null;
  status_id?: number | string | null;
  responsible_user_id?: number | string | null;
  _embedded?: { contacts?: Array<{ id?: number | string | null } | null> | null } | null;
};

export const AMO_WON_STATUS_ID = '142';
export const AMO_LOST_STATUS_ID = '143';

export type StageSortIndex = Map<string, Map<string, number>>;

/**
 * Fetches page 1, then the following pages in parallel waves of `concurrency`, stopping at the first
 * short/empty page. Much faster than strictly sequential paging for amoCRM's slow list endpoints.
 */
export async function fetchPagesConcurrently<T>(
  fetchPage: (page: number) => Promise<T[]>,
  options: { pageSize: number; maxPages: number; concurrency: number },
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  const first = await fetchPage(1);

  items.push(...first);
  if (first.length < options.pageSize) {
    return { items, truncated: false };
  }

  let nextPage = 2;

  while (nextPage <= options.maxPages) {
    const pages: number[] = [];

    for (let page = nextPage; page < nextPage + options.concurrency && page <= options.maxPages; page += 1) {
      pages.push(page);
    }
    const results = await Promise.all(pages.map((page) => fetchPage(page)));

    for (const result of results) {
      items.push(...result);
      if (result.length < options.pageSize) {
        return { items, truncated: false };
      }
    }
    nextPage += pages.length;
  }

  return { items, truncated: true };
}

export function safeDiv(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function toId(value: unknown): string {
  if (value === null || value === undefined) return '';

  return String(value).trim();
}

export function buildStageSortIndex(pipelines: FunnelPipeline[]): StageSortIndex {
  const index: StageSortIndex = new Map();

  for (const pipeline of pipelines) {
    const statuses = new Map<string, number>();

    for (const status of pipeline.statuses) {
      statuses.set(toId(status.id), status.sort);
    }
    index.set(toId(pipeline.id), statuses);
  }

  return index;
}

/**
 * True when the lead sits in the stage's pipeline and its current status is at or after
 * the chosen stage. Won (142) counts as past every stage, lost (143) never counts.
 */
export function isLeadAtOrAfterStage(
  lead: FunnelLeadLike,
  stage: FunnelStageRef,
  index: StageSortIndex,
): boolean {
  if (toId(lead.pipeline_id) !== toId(stage.pipelineId)) return false;
  const statusId = toId(lead.status_id);

  if (statusId === AMO_WON_STATUS_ID) return true;
  if (statusId === AMO_LOST_STATUS_ID) return false;
  const statuses = index.get(toId(stage.pipelineId));
  const stageSort = statuses?.get(toId(stage.statusId));
  const leadSort = statuses?.get(statusId);

  if (stageSort === undefined || leadSort === undefined) return false;

  return leadSort >= stageSort;
}

export type LeadBuckets = { assigned: number; ishlangan: number; taklif: number };

/**
 * Groups leads by responsible user. A lead is "ishlangan" when its id is in `answeredLeadIds`
 * (it had an answered call of the minimum length); "taklif" when it reached the chosen stage.
 */
export function bucketLeadsByResponsible(
  leads: FunnelLeadLike[],
  taklifStage: FunnelStageRef | null,
  index: StageSortIndex,
  answeredLeadIds: ReadonlySet<string>,
): Map<string, LeadBuckets> {
  const buckets = new Map<string, LeadBuckets>();

  for (const lead of leads) {
    const responsible = toId(lead.responsible_user_id);

    if (!responsible) continue;
    const bucket = buckets.get(responsible) || { assigned: 0, ishlangan: 0, taklif: 0 };

    bucket.assigned += 1;
    if (answeredLeadIds.has(toId(lead.id))) bucket.ishlangan += 1;
    if (taklifStage && isLeadAtOrAfterStage(lead, taklifStage, index)) bucket.taklif += 1;
    buckets.set(responsible, bucket);
  }

  return buckets;
}

export const CALL_NOTE_TYPES = ['call_in', 'call_out'];
export const MIN_ANSWERED_CALL_SECONDS = 50;

export type CallNoteLike = {
  entity_id?: number | string | null;
  note_type?: string | null;
  created_at?: number | string | null;
  params?: { duration?: number | string | null } | null;
};

function toUnixSeconds(value: unknown): number | null {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return parsed > 1_000_000_000_000 ? Math.floor(parsed / 1000) : parsed;
}

/** Contact ids linked to each lead (from GET /leads?with=contacts). */
export function leadContactIds(lead: FunnelLeadLike): string[] {
  const contacts = lead._embedded?.contacts;

  if (!Array.isArray(contacts)) return [];

  return contacts.map((contact) => toId(contact?.id)).filter(Boolean);
}

/**
 * Lead ids that had an answered call (call note with duration >= minDuration) after the lead was
 * created and no later than `rangeEnd`. Calls may sit on the lead itself or on one of its contacts.
 */
export function findAnsweredLeadIds(
  leads: FunnelLeadLike[],
  leadNotes: CallNoteLike[],
  contactNotes: CallNoteLike[],
  options: { rangeEnd: Date; minDurationSeconds?: number },
): Set<string> {
  const minDuration = options.minDurationSeconds ?? MIN_ANSWERED_CALL_SECONDS;
  const rangeEndSeconds = Math.floor(options.rangeEnd.getTime() / 1000);
  const qualifies = (note: CallNoteLike, leadCreatedAt: number | null) => {
    if (!note.note_type || !CALL_NOTE_TYPES.includes(note.note_type)) return false;
    if (Number(note.params?.duration ?? 0) < minDuration) return false;
    const createdAt = toUnixSeconds(note.created_at);

    if (createdAt === null || createdAt > rangeEndSeconds) return false;

    return leadCreatedAt === null || createdAt >= leadCreatedAt;
  };

  const leadsById = new Map<string, FunnelLeadLike>();
  const leadIdsByContact = new Map<string, string[]>();

  for (const lead of leads) {
    const leadId = toId(lead.id);

    if (!leadId) continue;
    leadsById.set(leadId, lead);
    for (const contactId of leadContactIds(lead)) {
      leadIdsByContact.set(contactId, [...(leadIdsByContact.get(contactId) || []), leadId]);
    }
  }

  const answered = new Set<string>();

  for (const note of leadNotes) {
    const leadId = toId(note.entity_id);
    const lead = leadsById.get(leadId);

    if (lead && qualifies(note, toUnixSeconds(lead.created_at))) answered.add(leadId);
  }
  for (const note of contactNotes) {
    for (const leadId of leadIdsByContact.get(toId(note.entity_id)) || []) {
      if (qualifies(note, toUnixSeconds(leadsById.get(leadId)?.created_at))) answered.add(leadId);
    }
  }

  return answered;
}

/** Runs async tasks with at most `limit` in flight; results keep input order. */
export async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const current = next;

      next += 1;
      const task = tasks[current];

      if (task) results[current] = await task();
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));

  return results;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export type FunnelManagerRow = {
  userId: string;
  name: string;
  /** null when amoCRM leads are unavailable or the manager has no amoCRM mapping. */
  assignedLeads: number | null;
  ishlanganLeads: number | null;
  taklifLeads: number | null;
  calls: number;
  sales: number;
  agreementSum: number;
  avgCheck: number;
  plan: number;
};

export type FunnelTotals = {
  assignedLeads: number;
  ishlanganLeads: number;
  taklifLeads: number;
  calls: number;
  sales: number;
  agreementSum: number;
  avgCheck: number;
  plan: number;
};

export function sumFunnelRows(rows: FunnelManagerRow[]): FunnelTotals {
  const totals: FunnelTotals = {
    assignedLeads: 0,
    ishlanganLeads: 0,
    taklifLeads: 0,
    calls: 0,
    sales: 0,
    agreementSum: 0,
    avgCheck: 0,
    plan: 0,
  };

  for (const row of rows) {
    totals.assignedLeads += row.assignedLeads ?? 0;
    totals.ishlanganLeads += row.ishlanganLeads ?? 0;
    totals.taklifLeads += row.taklifLeads ?? 0;
    totals.calls += row.calls;
    totals.sales += row.sales;
    totals.agreementSum += row.agreementSum;
    totals.plan += row.plan;
  }
  totals.avgCheck = safeDiv(totals.agreementSum, totals.sales);

  return totals;
}

export type TeamRatios = {
  leadToSale: number;
  leadToTaklif: number;
  taklifToSale: number;
  avgCheck: number;
};

export function computeTeamRatios(totals: FunnelTotals): TeamRatios {
  return {
    leadToSale: safeDiv(totals.sales, totals.assignedLeads),
    leadToTaklif: safeDiv(totals.taklifLeads, totals.ishlanganLeads),
    taklifToSale: safeDiv(totals.sales, totals.taklifLeads),
    avgCheck: safeDiv(totals.agreementSum, totals.sales),
  };
}

export type LossHole = 'aktivlik' | 'taklif' | 'yopish' | 'chek';
const HOLE_ORDER: LossHole[] = ['aktivlik', 'taklif', 'yopish', 'chek'];

export type LostRevenueRow = {
  userId: string;
  name: string;
  aktivlik: number;
  taklif: number;
  yopish: number;
  chek: number;
  mainHole: LossHole | null;
  lostRevenue: number;
};

export function computeLostRevenueRow(row: FunnelManagerRow, team: TeamRatios): LostRevenueRow {
  const assigned = row.assignedLeads ?? 0;
  const ishlangan = row.ishlanganLeads ?? 0;
  const taklif = row.taklifLeads ?? 0;
  const sales = row.sales;
  // A manager without sales has no own average check; fall back to the team's.
  const avg = sales > 0 ? row.avgCheck : team.avgCheck;

  const values: Record<LossHole, number> = {
    aktivlik: Math.max(0, assigned - ishlangan) * team.leadToSale * avg,
    taklif: (team.leadToTaklif - safeDiv(taklif, ishlangan)) * ishlangan * team.taklifToSale * avg,
    yopish: (team.taklifToSale - safeDiv(sales, taklif)) * taklif * avg,
    chek: sales > 0 ? (team.avgCheck - row.avgCheck) * sales : 0,
  };

  let mainHole: LossHole | null = null;
  let lostRevenue = 0;

  for (const hole of HOLE_ORDER) {
    if (values[hole] > lostRevenue) {
      lostRevenue = values[hole];
      mainHole = hole;
    }
  }

  return { userId: row.userId, name: row.name, ...values, mainHole, lostRevenue };
}

export type LostRevenueTotals = Omit<LostRevenueRow, 'userId' | 'name' | 'mainHole'> & { mainHole: null };

export function sumLostRevenueRows(rows: LostRevenueRow[]): LostRevenueTotals {
  const totals: LostRevenueTotals = { aktivlik: 0, taklif: 0, yopish: 0, chek: 0, lostRevenue: 0, mainHole: null };

  for (const row of rows) {
    totals.aktivlik += row.aktivlik;
    totals.taklif += row.taklif;
    totals.yopish += row.yopish;
    totals.chek += row.chek;
    totals.lostRevenue += row.lostRevenue;
  }

  return totals;
}
