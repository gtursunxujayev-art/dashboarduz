import {
  buildStageSortIndex,
  bucketLeadsByResponsible,
  chunk,
  findAnsweredLeadIds,
  runWithConcurrency,
  computeLostRevenueRow,
  computeTeamRatios,
  fetchPagesConcurrently,
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

describe('fetchPagesConcurrently', () => {
  it('fetches pages in waves and stops at the first short page', async () => {
    const requested: number[] = [];
    const fetchPage = async (page: number) => {
      requested.push(page);
      return page < 6 ? [page, page] : page === 6 ? [page] : [];
    };
    const result = await fetchPagesConcurrently(fetchPage, { pageSize: 2, maxPages: 40, concurrency: 4 });
    expect(result.items).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6]);
    expect(result.truncated).toBe(false);
    // page 1, then wave 2-5, then wave 6-9 (6 is short, so we stop)
    expect(requested.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('stops after one request when the first page is short', async () => {
    const fetchPage = jest.fn(async () => [1]);
    const result = await fetchPagesConcurrently(fetchPage, { pageSize: 2, maxPages: 40, concurrency: 4 });
    expect(result.items).toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('reports truncation at the page cap', async () => {
    const result = await fetchPagesConcurrently(async () => [1, 1], { pageSize: 2, maxPages: 3, concurrency: 4 });
    expect(result.items).toHaveLength(6);
    expect(result.truncated).toBe(true);
  });
});

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
  it('counts assigned, answered (ishlangan) and taklif per responsible user', () => {
    const buckets = bucketLeadsByResponsible(
      [
        { id: 1, pipeline_id: 1, status_id: 10, responsible_user_id: 5 },
        { id: 2, pipeline_id: 1, status_id: 30, responsible_user_id: 5 },
        { id: 3, pipeline_id: 1, status_id: 142, responsible_user_id: 5 },
        { id: 4, pipeline_id: 1, status_id: 30, responsible_user_id: 6 },
        { id: 5, pipeline_id: 1, status_id: 30 },
      ],
      { pipelineId: '1', statusId: '30' },
      index,
      new Set(['1', '2', '4']),
    );
    expect(buckets.get('5')).toEqual({ assigned: 3, ishlangan: 2, taklif: 2 });
    expect(buckets.get('6')).toEqual({ assigned: 1, ishlangan: 1, taklif: 1 });
    expect(buckets.size).toBe(2);
  });

  it('leaves taklif at 0 when no stage is chosen', () => {
    const buckets = bucketLeadsByResponsible(
      [{ id: 1, pipeline_id: 1, status_id: 40, responsible_user_id: 5 }],
      null,
      index,
      new Set(),
    );
    expect(buckets.get('5')).toEqual({ assigned: 1, ishlangan: 0, taklif: 0 });
  });
});

describe('findAnsweredLeadIds', () => {
  const created = Math.floor(new Date('2026-10-12T09:00:00Z').getTime() / 1000);
  const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
  const rangeEnd = new Date('2026-11-07T18:59:59Z');
  const leads = [
    { id: 100, created_at: created, _embedded: { contacts: [{ id: 900 }] } },
    { id: 101, created_at: created, _embedded: { contacts: [{ id: 901 }] } },
    { id: 102, created_at: created },
  ];

  it('counts a lead with a call note of at least 50 seconds on the lead', () => {
    const result = findAnsweredLeadIds(
      leads,
      [
        { entity_id: 100, note_type: 'call_out', created_at: at('2026-11-03T10:34:00Z'), params: { duration: 116 } },
        { entity_id: 102, note_type: 'call_out', created_at: at('2026-10-16T11:03:00Z'), params: { duration: 0 } },
      ],
      [],
      { rangeEnd },
    );
    expect([...result]).toEqual(['100']);
  });

  it('counts calls stored on the lead contact, incoming or outgoing', () => {
    const result = findAnsweredLeadIds(
      leads,
      [],
      [{ entity_id: 901, note_type: 'call_in', created_at: at('2026-10-20T08:00:00Z'), params: { duration: '50' } }],
      { rangeEnd },
    );
    expect([...result]).toEqual(['101']);
  });

  it('ignores short calls, non-call notes, calls before lead creation and after the period', () => {
    const result = findAnsweredLeadIds(
      leads,
      [
        { entity_id: 100, note_type: 'call_out', created_at: at('2026-10-20T08:00:00Z'), params: { duration: 49 } },
        { entity_id: 100, note_type: 'common', created_at: at('2026-10-20T08:00:00Z'), params: { duration: 300 } },
        { entity_id: 100, note_type: 'call_out', created_at: created - 60, params: { duration: 300 } },
        { entity_id: 100, note_type: 'call_out', created_at: at('2026-11-08T08:00:00Z'), params: { duration: 300 } },
        { entity_id: 555, note_type: 'call_out', created_at: at('2026-10-20T08:00:00Z'), params: { duration: 300 } },
      ],
      [],
      { rangeEnd },
    );
    expect(result.size).toBe(0);
  });
});

describe('runWithConcurrency and chunk', () => {
  it('keeps order and never exceeds the limit', async () => {
    let active = 0;
    let peak = 0;
    const tasks = [30, 10, 20, 5, 15].map((ms, i) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, ms));
      active -= 1;
      return i;
    });
    expect(await runWithConcurrency(tasks, 2)).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
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
