// Pure helpers for the Tahlil → Voronka (manager funnel + lost revenue) report.

export type FunnelStageRef = { pipelineId: string; statusId: string };

export type FunnelPipeline = {
  id: string;
  name: string;
  sort: number;
  statuses: Array<{ id: string; name: string; sort: number }>;
};

export type FunnelLeadLike = {
  pipeline_id?: number | string | null;
  status_id?: number | string | null;
  responsible_user_id?: number | string | null;
};

export const AMO_WON_STATUS_ID = '142';
export const AMO_LOST_STATUS_ID = '143';

export type StageSortIndex = Map<string, Map<string, number>>;

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

export function bucketLeadsByResponsible(
  leads: FunnelLeadLike[],
  stages: { ishlangan: FunnelStageRef | null; taklif: FunnelStageRef | null },
  index: StageSortIndex,
): Map<string, LeadBuckets> {
  const buckets = new Map<string, LeadBuckets>();

  for (const lead of leads) {
    const responsible = toId(lead.responsible_user_id);

    if (!responsible) continue;
    const bucket = buckets.get(responsible) || { assigned: 0, ishlangan: 0, taklif: 0 };

    bucket.assigned += 1;
    if (stages.ishlangan && isLeadAtOrAfterStage(lead, stages.ishlangan, index)) bucket.ishlangan += 1;
    if (stages.taklif && isLeadAtOrAfterStage(lead, stages.taklif, index)) bucket.taklif += 1;
    buckets.set(responsible, bucket);
  }

  return buckets;
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
