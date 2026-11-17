/* eslint-disable @typescript-eslint/require-await -- the mocks stand in for async Prisma/Redis/amoCRM calls and must return promises */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type LeadRow = Record<string, any> & { tenantId: string; amocrmId: string; updatedAt: Date };
type Where = Record<string, any>;

const mockLeads = new Map<string, LeadRow>();
const mockIntegrations = new Map<string, { id: string; tenantId: string; status: string; config: any }>();

function mockMatches(row: LeadRow, where: Where): boolean {
  if (where.tenantId && row.tenantId !== where.tenantId) return false;
  if (where.amocrmId?.not === null && row.amocrmId === null) return false;
  if (where.updatedAt?.lt && !(row.updatedAt < where.updatedAt.lt)) return false;

  return true;
}

const mockDb = {
  lead: {
    upsert: jest.fn(async ({ where, update, create }: any) => {
      const key = `${where.tenantId_amocrmId.tenantId}:${where.tenantId_amocrmId.amocrmId}`;
      const existing = mockLeads.get(key);
      const row = existing ? { ...existing, ...update } : { ...create, updatedAt: new Date() };

      mockLeads.set(key, row);

      return row;
    }),
    count: jest.fn(async ({ where }: any) => [...mockLeads.values()].filter((row) => mockMatches(row, where)).length),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;

      for (const [key, row] of mockLeads) {
        if (mockMatches(row, where)) {
          mockLeads.delete(key);
          count += 1;
        }
      }

      return { count };
    }),
  },
  integration: {
    findUnique: jest.fn(async ({ where }: any) => mockIntegrations.get(where.id) ?? null),
    findMany: jest.fn(async () => [...mockIntegrations.values()]),
    update: jest.fn(async ({ where, data }: any) => {
      const integration = mockIntegrations.get(where.id)!;

      integration.config = data.config;

      return integration;
    }),
  },
  $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
};

const mockFetchLeads = jest.fn<(...args: any[]) => Promise<any>>();
const mockRedis = {
  set: jest.fn<(...args: any[]) => Promise<string | null>>(),
  get: jest.fn<(...args: any[]) => Promise<string | null>>(),
  del: jest.fn<(...args: any[]) => Promise<number>>(),
  exists: jest.fn<(...args: any[]) => Promise<number>>(),
};

jest.mock('@dashboarduz/db', () => ({ prisma: mockDb, systemPrisma: mockDb }));
jest.mock('../amocrm', () => ({ amocrmService: { fetchLeads: (...args: any[]) => mockFetchLeads(...args) } }));
jest.mock('../amocrm-live', () => ({
  getTenantAmoCRMContext: async (tenantId: string) => {
    const integration = [...mockIntegrations.values()].find((item) => item.tenantId === tenantId && item.status === 'active');

    return integration
      ? { integrationId: integration.id, accessToken: 'token', baseUrl: 'https://x.amocrm.ru', config: integration.config, selectedPipelineIds: null }
      : null;
  },
}));
jest.mock('../../queue/redis-client', () => ({ getRedisClient: () => mockRedis }));

// eslint-disable-next-line import/first
import {
  isLeadSnapshotDue,
  needsFullSync,
  readLeadSnapshotState,
  refreshDueLeadSnapshots,
  refreshTenantLeadSnapshot,
} from '../amocrm-lead-snapshot';
// eslint-disable-next-line import/first
import { buildSnapshotLeadWhere, snapshotRowToLead } from '../amocrm-lead-snapshot-read';

const NOW = new Date('2026-11-17T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function lead(id: number, updatedAt: number, extra: Record<string, unknown> = {}) {
  return { id, name: `Lead ${id}`, status_id: 100, pipeline_id: 7, responsible_user_id: 501, created_at: updatedAt - 100, updated_at: updatedAt, ...extra };
}

function page(leads: unknown[], hasNext: boolean) {
  return { _embedded: { leads }, ...(hasNext ? { _links: { next: { href: 'next' } } } : {}) };
}

function seedIntegration(tenantId: string, snapshot?: Record<string, unknown>) {
  mockIntegrations.set(`int-${tenantId}`, {
    id: `int-${tenantId}`,
    tenantId,
    status: 'active',
    config: { base_url: 'https://x.amocrm.ru', ...(snapshot ? { lead_snapshot: snapshot } : {}) },
  });
}

function seedLead(tenantId: string, amocrmId: string, updatedAt = new Date('2026-01-01T00:00:00Z')) {
  mockLeads.set(`${tenantId}:${amocrmId}`, { tenantId, amocrmId, title: `Old ${amocrmId}`, updatedAt });
}

function savedState(tenantId: string) {
  return readLeadSnapshotState(mockIntegrations.get(`int-${tenantId}`)!.config);
}

beforeEach(() => {
  mockLeads.clear();
  mockIntegrations.clear();
  jest.clearAllMocks();
  mockFetchLeads.mockReset();
  mockRedis.set.mockResolvedValue('OK');
  mockRedis.get.mockResolvedValue(null);
  mockRedis.del.mockResolvedValue(1);
  mockRedis.exists.mockResolvedValue(0);
});

describe('lead snapshot state', () => {
  it('reads a stored state and ignores junk', () => {
    expect(readLeadSnapshotState({ lead_snapshot: { lastRefreshedAt: '2026-11-17T09:00:00.000Z', cursor: 1700, leadCount: 3 } })).toMatchObject({
      lastRefreshedAt: '2026-11-17T09:00:00.000Z',
      cursor: 1700,
      leadCount: 3,
      lastError: null,
    });
    expect(readLeadSnapshotState({ lead_snapshot: { lastRefreshedAt: 'nope', cursor: -1 } })).toMatchObject({ lastRefreshedAt: null, cursor: null });
    expect(readLeadSnapshotState(null)).toMatchObject({ lastRefreshedAt: null, cursor: null });
  });

  it('is due once an hour, and backs off for 15 minutes after a failure', () => {
    const base = readLeadSnapshotState(null);

    expect(isLeadSnapshotDue(base, NOW)).toBe(true);
    expect(isLeadSnapshotDue({ ...base, lastRefreshedAt: new Date(NOW.getTime() - 59 * 60_000).toISOString() }, NOW)).toBe(false);
    expect(isLeadSnapshotDue({ ...base, lastRefreshedAt: new Date(NOW.getTime() - HOUR).toISOString() }, NOW)).toBe(true);
    expect(isLeadSnapshotDue({ ...base, lastError: 'boom', lastAttemptAt: new Date(NOW.getTime() - 5 * 60_000).toISOString() }, NOW)).toBe(false);
    expect(isLeadSnapshotDue({ ...base, lastError: 'boom', lastAttemptAt: new Date(NOW.getTime() - 16 * 60_000).toISOString() }, NOW)).toBe(true);
  });

  it('needs a full pull without a cursor or after a day', () => {
    const base = readLeadSnapshotState(null);

    expect(needsFullSync(base, NOW)).toBe(true);
    expect(needsFullSync({ ...base, cursor: 1, lastFullSyncAt: new Date(NOW.getTime() - HOUR).toISOString() }, NOW)).toBe(false);
    expect(needsFullSync({ ...base, cursor: 1, lastFullSyncAt: new Date(NOW.getTime() - 25 * HOUR).toISOString() }, NOW)).toBe(true);
  });
});

describe('refreshTenantLeadSnapshot', () => {
  it('does a full pull on the first run, pages through amoCRM and drops leads amoCRM no longer has', async () => {
    seedIntegration('t1');
    seedLead('t1', '999'); // deleted in amoCRM
    seedLead('t2', '999'); // another tenant: untouched
    const firstPage = Array.from({ length: 250 }, (_, index) => lead(index + 1, 1_000 + index));

    mockFetchLeads
      .mockResolvedValueOnce(page(firstPage, true))
      .mockResolvedValueOnce(page([lead(251, 5_000)], false));

    const outcome = await refreshTenantLeadSnapshot('t1', { now: NOW });

    expect(outcome).toMatchObject({ status: 'refreshed', result: { mode: 'full', fetched: 251, removed: 1, complete: true, leadCount: 251 } });
    expect(mockFetchLeads).toHaveBeenCalledTimes(2);
    expect(mockFetchLeads.mock.calls[0]![2]).toMatchObject({ page: 1, limit: 250, with: 'contacts', updatedAtFrom: undefined, order: { field: 'id', direction: 'asc' } });
    expect(mockFetchLeads.mock.calls[1]![2]).toMatchObject({ page: 2 });
    expect(mockLeads.has('t1:999')).toBe(false);
    expect(mockLeads.has('t2:999')).toBe(true);
    expect(mockLeads.get('t1:251')).toMatchObject({ title: 'Lead 251', status: '100', pipelineId: '7', responsibleUserId: '501', source: 'amocrm' });
    expect(savedState('t1')).toMatchObject({ cursor: 5_000, leadCount: 251, lastError: null });
    expect(savedState('t1').lastFullSyncAt).not.toBeNull();
    expect(savedState('t1').lastRefreshedAt).not.toBeNull();
    expect(mockRedis.set).toHaveBeenCalledWith('amocrm-lead-snapshot:lock:t1', expect.any(String), 'EX', expect.any(Number), 'NX');
  });

  it('pulls only changed leads when a recent full pull exists, and keeps the other rows', async () => {
    seedIntegration('t1', { cursor: 2_000, lastFullSyncAt: new Date(NOW.getTime() - HOUR).toISOString() });
    seedLead('t1', '1');
    seedLead('t1', '2');
    mockFetchLeads.mockResolvedValueOnce(page([lead(2, 2_500, { name: 'Renamed' }), lead(3, 2_400)], false));

    const outcome = await refreshTenantLeadSnapshot('t1', { now: NOW });

    expect(outcome).toMatchObject({ status: 'refreshed', result: { mode: 'incremental', fetched: 2, removed: 0, leadCount: 3 } });
    expect(mockFetchLeads.mock.calls[0]![2]).toMatchObject({
      updatedAtFrom: new Date((2_000 - 60) * 1000),
      order: { field: 'updated_at', direction: 'asc' },
    });
    expect(mockDb.lead.deleteMany).not.toHaveBeenCalled();
    expect(mockLeads.get('t1:2')).toMatchObject({ title: 'Renamed' });
    expect(savedState('t1')).toMatchObject({ cursor: 2_500 });
  });

  it('keeps the stored leads when a full pull returns nothing', async () => {
    seedIntegration('t1');
    seedLead('t1', '1');
    mockFetchLeads.mockResolvedValueOnce(page([], false));

    const outcome = await refreshTenantLeadSnapshot('t1', { now: NOW, forceFull: true });

    expect(outcome).toMatchObject({ status: 'refreshed', result: { removed: 0, leadCount: 1 } });
    expect(mockLeads.has('t1:1')).toBe(true);
  });

  it('records the error, keeps the progress made, and rethrows', async () => {
    seedIntegration('t1', { cursor: 2_000, lastFullSyncAt: new Date(NOW.getTime() - HOUR).toISOString(), lastRefreshedAt: '2026-11-17T08:00:00.000Z' });
    const fullPage = Array.from({ length: 250 }, (_, index) => lead(index + 1, 3_000 + index));

    mockFetchLeads
      .mockResolvedValueOnce(page(fullPage, true))
      .mockRejectedValueOnce(new Error('amoCRM 503'));

    await expect(refreshTenantLeadSnapshot('t1', { now: NOW })).rejects.toThrow('amoCRM 503');
    expect(savedState('t1')).toMatchObject({
      lastError: 'amoCRM 503',
      cursor: 3_249,
      lastRefreshedAt: '2026-11-17T08:00:00.000Z',
    });
    expect(mockRedis.del).not.toHaveBeenCalled(); // the lock value did not match (get returned null)
  });

  it('releases its own lock when done', async () => {
    seedIntegration('t1');
    mockFetchLeads.mockResolvedValueOnce(page([], false));
    mockRedis.get.mockImplementation(async () => (mockRedis.set.mock.calls[0]?.[1] as string) ?? null);

    await refreshTenantLeadSnapshot('t1', { now: NOW });

    expect(mockRedis.del).toHaveBeenCalledWith('amocrm-lead-snapshot:lock:t1');
  });

  it('skips the refresh while another instance holds the lock', async () => {
    seedIntegration('t1');
    mockRedis.set.mockResolvedValue(null);

    await expect(refreshTenantLeadSnapshot('t1', { now: NOW })).resolves.toEqual({ status: 'already_running' });
    expect(mockFetchLeads).not.toHaveBeenCalled();
  });

  it('skips a second refresh started in the same process', async () => {
    seedIntegration('t1');
    let release: (value: unknown) => void = () => undefined;

    mockFetchLeads.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    const first = refreshTenantLeadSnapshot('t1', { now: NOW });

    await expect(refreshTenantLeadSnapshot('t1', { now: NOW })).resolves.toEqual({ status: 'already_running' });
    release(page([], false));
    await expect(first).resolves.toMatchObject({ status: 'refreshed' });
  });

  it('still refreshes when Redis is unreachable', async () => {
    seedIntegration('t1');
    mockRedis.set.mockRejectedValue(new Error('ECONNREFUSED'));
    mockFetchLeads.mockResolvedValueOnce(page([lead(1, 10)], false));

    await expect(refreshTenantLeadSnapshot('t1', { now: NOW })).resolves.toMatchObject({ status: 'refreshed' });
  });

  it('reports a tenant without an active amoCRM integration', async () => {
    await expect(refreshTenantLeadSnapshot('nobody', { now: NOW })).resolves.toEqual({ status: 'not_connected' });
  });
});

describe('refreshDueLeadSnapshots', () => {
  it('refreshes only tenants whose snapshot is an hour old, and carries on after a failure', async () => {
    seedIntegration('fresh', { lastRefreshedAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(), cursor: 1 });
    seedIntegration('failing');
    seedIntegration('stale', { lastRefreshedAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(), cursor: 1, lastFullSyncAt: NOW.toISOString() });
    mockFetchLeads.mockImplementation(async (_token: unknown, _account: unknown, params: any) => {
      if (params.updatedAtFrom) return page([lead(1, 10)], false);
      throw new Error('boom');
    });

    const refreshed = await refreshDueLeadSnapshots(NOW);

    expect(refreshed).toEqual(['stale']);
    expect(savedState('failing').lastError).toBe('boom');
    expect(savedState('fresh').lastError).toBeNull();
  });
});

describe('snapshot reads', () => {
  it('builds the amoCRM filters as a tenant-scoped query', () => {
    expect(buildSnapshotLeadWhere('t1', {
      pipelineIds: ['7'],
      responsibleUserIds: ['501', ' '],
      statusFilters: [{ pipelineId: '7', statusId: '142' }],
      createdAtFrom: new Date('2026-11-01T00:00:00Z'),
    })).toEqual({
      tenantId: 't1',
      amocrmId: { not: null },
      pipelineId: { in: ['7'] },
      responsibleUserId: { in: ['501'] },
      OR: [{ pipelineId: '7', status: '142' }],
      externalCreatedAt: { gte: new Date('2026-11-01T00:00:00Z') },
    });
    expect(buildSnapshotLeadWhere('t1', {})).toEqual({ tenantId: 't1', amocrmId: { not: null } });
  });

  it('serves the stored payload with the webhook-updated columns on top', () => {
    const result = snapshotRowToLead({
      amocrmId: '42',
      title: 'New name',
      status: '143',
      pipelineId: '7',
      responsibleUserId: '501',
      metadata: { id: 42, name: 'Old name', status_id: 100, custom_fields_values: [{ field_code: 'SRC', values: [{ value: 'Ads' }] }] },
      externalCreatedAt: new Date(1_000_000),
      externalUpdatedAt: new Date(2_000_000),
    });

    expect(result).toMatchObject({
      id: 42,
      name: 'New name',
      status_id: 143,
      pipeline_id: 7,
      responsible_user_id: 501,
      created_at: 1_000,
      updated_at: 2_000,
      custom_fields_values: [{ field_code: 'SRC', values: [{ value: 'Ads' }] }],
    });
  });
});
