import {
  buildStageSortIndex,
  bucketLeadsByResponsible,
  computeLostRevenueRow,
  computeTeamRatios,
  isLeadAtOrAfterStage,
  safeDiv,
  sumFunnelRows,
  sumLostRevenueRows,
  type FunnelManagerRow,
  type FunnelPipeline,
} from '../funnel-metrics';

const pipelines: FunnelPipeline[] = [
  {
    id: '1',
    name: 'Sotuv',
    sort: 1,
    statuses: [
      { id: '10', name: 'Yangi', sort: 10 },
      { id: '20', name: 'Aloqa', sort: 20 },
      { id: '30', name: 'Taklif', sort: 30 },
      { id: '40', name: 'Shartnoma', sort: 40 },
    ],
  },
  { id: '2', name: 'Boshqa', sort: 2, statuses: [{ id: '99', name: 'X', sort: 50 }] },
];
const index = buildStageSortIndex(pipelines);
const stage = { pipelineId: '1', statusId: '20' };

function row(partial: Partial<FunnelManagerRow>): FunnelManagerRow {
  return {
    userId: 'u',
    name: 'U',
    assignedLeads: 0,
    ishlanganLeads: 0,
    taklifLeads: 0,
    calls: 0,
    sales: 0,
    agreementSum: 0,
    avgCheck: 0,
    plan: 0,
    ...partial,
  };
}

describe('safeDiv', () => {
  it('returns 0 for zero or negative denominators', () => {
    expect(safeDiv(5, 0)).toBe(0);
    expect(safeDiv(5, -1)).toBe(0);
    expect(safeDiv(6, 3)).toBe(2);
  });
});

describe('isLeadAtOrAfterStage', () => {
  it('compares current status sort within the stage pipeline', () => {
    expect(isLeadAtOrAfterStage({ pipeline_id: 1, status_id: 20 }, stage, index)).toBe(true);
    expect(isLeadAtOrAfterStage({ pipeline_id: '1', status_id: '40' }, stage, index)).toBe(true);
    expect(isLeadAtOrAfterStage({ pipeline_id: 1, status_id: 10 }, stage, index)).toBe(false);
  });

  it('treats won as past every stage and lost as not reached', () => {
    expect(isLeadAtOrAfterStage({ pipeline_id: 1, status_id: 142 }, stage, index)).toBe(true);
    expect(isLeadAtOrAfterStage({ pipeline_id: 1, status_id: 143 }, stage, index)).toBe(false);
  });

  it('ignores other pipelines and unknown statuses', () => {
    expect(isLeadAtOrAfterStage({ pipeline_id: 2, status_id: 99 }, stage, index)).toBe(false);
    expect(isLeadAtOrAfterStage({ pipeline_id: 2, status_id: 142 }, stage, index)).toBe(false);
    expect(isLeadAtOrAfterStage({ pipeline_id: 1, status_id: 777 }, stage, index)).toBe(false);
  });
});

describe('bucketLeadsByResponsible', () => {
  it('counts assigned, ishlangan and taklif per responsible user', () => {
    const buckets = bucketLeadsByResponsible(
      [
        { pipeline_id: 1, status_id: 10, responsible_user_id: 5 },
        { pipeline_id: 1, status_id: 30, responsible_user_id: 5 },
        { pipeline_id: 1, status_id: 142, responsible_user_id: 5 },
        { pipeline_id: 1, status_id: 30, responsible_user_id: 6 },
        { pipeline_id: 1, status_id: 30 },
      ],
      { ishlangan: stage, taklif: { pipelineId: '1', statusId: '30' } },
      index,
    );
    expect(buckets.get('5')).toEqual({ assigned: 3, ishlangan: 2, taklif: 2 });
    expect(buckets.get('6')).toEqual({ assigned: 1, ishlangan: 1, taklif: 1 });
    expect(buckets.size).toBe(2);
  });

  it('leaves stage counts at 0 when no stage is chosen', () => {
    const buckets = bucketLeadsByResponsible(
      [{ pipeline_id: 1, status_id: 40, responsible_user_id: 5 }],
      { ishlangan: null, taklif: null },
      index,
    );
    expect(buckets.get('5')).toEqual({ assigned: 1, ishlangan: 0, taklif: 0 });
  });
});

describe('team ratios and lost revenue', () => {
  // Team: A(100 assigned, 60 ishlangan, 30 taklif, 10 sales, 10M) + B(100, 40, 10, 2, 1M)
  const a = row({ userId: 'a', name: 'A', assignedLeads: 100, ishlanganLeads: 60, taklifLeads: 30, sales: 10, agreementSum: 10_000_000, avgCheck: 1_000_000 });
  const b = row({ userId: 'b', name: 'B', assignedLeads: 100, ishlanganLeads: 40, taklifLeads: 10, sales: 2, agreementSum: 1_000_000, avgCheck: 500_000 });
  const totals = sumFunnelRows([a, b]);
  const team = computeTeamRatios(totals);

  it('sums rows and recomputes the average check from sums', () => {
    expect(totals.assignedLeads).toBe(200);
    expect(totals.sales).toBe(12);
    expect(totals.avgCheck).toBeCloseTo(11_000_000 / 12);
  });

  it('computes team ratios', () => {
    expect(team.leadToSale).toBeCloseTo(12 / 200);
    expect(team.leadToTaklif).toBeCloseTo(40 / 100);
    expect(team.taklifToSale).toBeCloseTo(12 / 40);
    expect(team.avgCheck).toBeCloseTo(11_000_000 / 12);
  });

  it('computes the four components and picks the biggest hole', () => {
    const result = computeLostRevenueRow(b, team);
    // Aktivlik = (100-40) * 0.06 * 500k = 1.8M
    expect(result.aktivlik).toBeCloseTo(60 * (12 / 200) * 500_000);
    // Taklif = (0.4 - 10/40) * 40 * 0.3 * 500k = 0.15*40*0.3*500k = 900k
    expect(result.taklif).toBeCloseTo((0.4 - 0.25) * 40 * 0.3 * 500_000);
    // Yopish = (0.3 - 2/10) * 10 * 500k = 500k
    expect(result.yopish).toBeCloseTo((0.3 - 0.2) * 10 * 500_000);
    // Chek = (916_666.67 - 500k) * 2
    expect(result.chek).toBeCloseTo((11_000_000 / 12 - 500_000) * 2);
    expect(result.mainHole).toBe('aktivlik');
    expect(result.lostRevenue).toBeCloseTo(result.aktivlik);
  });

  it('uses team average check when the manager has no sales; chek is 0', () => {
    const c = row({ assignedLeads: 50, ishlanganLeads: 10, taklifLeads: 0, sales: 0 });
    const result = computeLostRevenueRow(c, team);
    expect(result.aktivlik).toBeCloseTo(40 * team.leadToSale * team.avgCheck);
    expect(result.chek).toBe(0);
  });

  it('reports no hole when every component is <= 0', () => {
    const result = computeLostRevenueRow(row({}), team);
    expect(result.mainHole).toBeNull();
    expect(result.lostRevenue).toBe(0);
  });

  it('treats null lead counts as 0 and sums loss rows', () => {
    const nullRow = row({ assignedLeads: null, ishlanganLeads: null, taklifLeads: null, sales: 1, avgCheck: 100 });
    const result = computeLostRevenueRow(nullRow, team);
    expect(Number.isFinite(result.aktivlik)).toBe(true);
    const sums = sumLostRevenueRows([computeLostRevenueRow(a, team), computeLostRevenueRow(b, team)]);
    expect(sums.mainHole).toBeNull();
    expect(sums.lostRevenue).toBeGreaterThan(0);
  });
});
