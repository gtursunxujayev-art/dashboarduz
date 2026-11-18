import { getPreviousTashkentMonthStart } from '../../bonus-auto-finalize';
import { startAmoCallsSyncScheduler, stopAmoCallsSyncScheduler } from '../amocrm-call-sync';

// Runs the amoCRM call sync end to end (through the scheduler's first run) with a mocked database and a mocked
// amoCRM notes API, and pins how calls are attributed to managers (managerUserId).
const mockDb = {
  integration: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  user: { findMany: jest.fn() },
  call: { createMany: jest.fn(), updateMany: jest.fn() },
  $queryRaw: jest.fn(),
};
const mockFetchNotes = jest.fn();
const mockAmoContext = jest.fn();

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
}));
jest.mock('../amocrm', () => ({
  amocrmService: { fetchNotes: (...args: unknown[]) => mockFetchNotes(...args) },
}));
jest.mock('../amocrm-live', () => ({
  getTenantAmoCRMContext: (...args: unknown[]) => mockAmoContext(...args),
}));

const TENANT_ID = 'tenant-1';
/** An hour ago in unix seconds: newer than the backfill start (the previous Tashkent month). */
const BASE = Math.floor(Date.now() / 1000) - 3600;

/** Lets the scheduler's fire-and-forget first run finish. */
async function settle(): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function runSyncOnce(): Promise<void> {
  startAmoCallsSyncScheduler();
  stopAmoCallsSyncScheduler();
  await settle();
}

function callNote(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    entity_id: 900 + id,
    note_type: 'call_out',
    created_at: BASE + id,
    updated_at: BASE + id,
    responsible_user_id: 501,
    params: { duration: 60, phone: '+998901112233', uniq: `u-${id}` },
    ...overrides,
  };
}

/** The config the sync saved last (it is merged into the integration config). */
function savedSyncState() {
  const calls = mockDb.integration.update.mock.calls;

  return calls[calls.length - 1][0].data.config.calls_sync;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.integration.findMany.mockResolvedValue([{ tenantId: TENANT_ID }]);
  mockDb.integration.findUnique.mockResolvedValue({ config: { account_id: '3141' } });
  mockDb.integration.update.mockResolvedValue({});
  mockDb.user.findMany.mockResolvedValue([
    { id: 'manager-a', amocrmResponsibleUserId: '501' },
    { id: 'manager-b', amocrmResponsibleUserId: ' 502 ' },
    { id: 'blank', amocrmResponsibleUserId: '  ' },
  ]);
  mockDb.$queryRaw.mockResolvedValue([]);
  mockDb.call.createMany.mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length }));
  mockDb.call.updateMany.mockResolvedValue({ count: 0 });
  mockAmoContext.mockResolvedValue({
    integrationId: 'int-1',
    accessToken: 'token',
    baseUrl: 'https://acme.amocrm.ru',
    config: {},
    selectedPipelineIds: null,
  });
  mockFetchNotes.mockResolvedValue([]);
});

describe('amoCRM call sync run', () => {
  it('imports call notes of every entity type with the manager mapped from the responsible amoCRM user', async () => {
    mockFetchNotes.mockImplementation((_token: string, entityType: string) => Promise.resolve(entityType === 'contacts'
      ? [
        callNote(1),
        callNote(2, { responsible_user_id: 0, created_by: 502, note_type: 'call_in', params: { duration: 0, phone: '+1' } }),
        callNote(3, { responsible_user_id: 777 }),
        { id: 4, note_type: 'common', created_at: BASE + 4, updated_at: BASE + 50 },
      ]
      : []));

    await runSyncOnce();

    expect(mockDb.user.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, amocrmResponsibleUserId: { not: null } },
      select: { id: true, amocrmResponsibleUserId: true },
    });
    expect(mockFetchNotes.mock.calls.map((call) => call[1])).toEqual(['contacts', 'leads', 'companies']);
    const [, , options, baseUrl] = mockFetchNotes.mock.calls[0];

    expect(baseUrl).toBe('https://acme.amocrm.ru');
    expect(options).toMatchObject({ page: 1, limit: 250, noteTypes: ['call_in', 'call_out'], orderByUpdatedAsc: true });

    const { data, skipDuplicates } = mockDb.call.createMany.mock.calls[0][0];

    expect(skipDuplicates).toBe(true);
    expect(data.map((row: { callIdExternal: string; managerUserId: string | null; direction: string; status: string }) => [
      row.callIdExternal, row.managerUserId, row.direction, row.status,
    ])).toEqual([
      ['uniq:u-1', 'manager-a', 'outbound', 'completed'],
      // No responsible user: the author (created_by) is the caller; the stored id is trimmed when mapped.
      ['note:contacts:2', 'manager-b', 'inbound', 'missed'],
      // An amoCRM user nobody is mapped to: kept, without a manager.
      ['uniq:u-3', null, 'outbound', 'completed'],
    ]);
  });

  it('saves per-entity cursors at the newest note seen, including non-call notes', async () => {
    mockFetchNotes.mockImplementation((_token: string, entityType: string) => Promise.resolve(entityType === 'leads'
      ? [callNote(10), { id: 11, note_type: 'common', created_at: BASE + 11, updated_at: BASE + 999 }]
      : []));

    await runSyncOnce();

    const state = savedSyncState();

    expect(state.cursors.leads).toBe(BASE + 999);
    // Entity types without notes keep the backfill start (the previous Tashkent month start).
    const backfillFrom = Math.floor(getPreviousTashkentMonthStart(new Date()).getTime() / 1000);

    expect(state.cursors.contacts).toBe(backfillFrom);
    expect(state.cursors.companies).toBe(backfillFrom);
    expect(state).toMatchObject({ lastError: null, backfillComplete: true, lastRunAt: expect.any(String) });
    // Settings saved meanwhile are kept: the config is re-read and merged.
    expect(mockDb.integration.update.mock.calls[0][0]).toMatchObject({ where: { id: 'int-1' }, data: { config: { account_id: '3141' } } });
  });

  it('resumes from the stored cursors on the next run and pages through full pages', async () => {
    mockAmoContext.mockResolvedValue({
      integrationId: 'int-1',
      accessToken: 'token',
      config: { calls_sync: { cursors: { contacts: 1_700_000_000, leads: 1_700_000_100, companies: 1_700_000_200 }, backfillComplete: true } },
      selectedPipelineIds: null,
    });
    const fullPage = Array.from({ length: 250 }, (_, index) => callNote(100 + index));

    mockFetchNotes.mockImplementation((_token: string, entityType: string, options: { page: number }) => Promise.resolve(
      entityType === 'contacts' && options.page === 1 ? fullPage : [],
    ));

    await runSyncOnce();

    const contactCalls = mockFetchNotes.mock.calls.filter((call) => call[1] === 'contacts');

    expect(contactCalls.map((call) => call[2].page)).toEqual([1, 2]);
    expect(contactCalls[0][2].updatedAtFrom).toEqual(new Date(1_700_000_000 * 1000));
    expect(mockFetchNotes.mock.calls.find((call) => call[1] === 'leads')?.[2].updatedAtFrom).toEqual(new Date(1_700_000_100 * 1000));
    expect(savedSyncState().cursors).toEqual({ contacts: BASE + 349, leads: 1_700_000_100, companies: 1_700_000_200 });
  });

  it('attaches earlier calls of a newly mapped amoCRM user to that manager', async () => {
    mockDb.$queryRaw.mockResolvedValue([{ amo_user_id: '501' }, { amo_user_id: '999' }, { amo_user_id: null }]);
    mockDb.call.updateMany.mockResolvedValue({ count: 4 });

    await runSyncOnce();

    expect(mockDb.call.updateMany).toHaveBeenCalledTimes(1);
    expect(mockDb.call.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_ID,
        provider: 'amocrm',
        managerUserId: null,
        metadata: { path: ['amocrm_user_id'], equals: '501' },
      },
      data: { managerUserId: 'manager-a' },
    });
  });

  it('keeps the progress and records the error when amoCRM fails mid-run', async () => {
    mockFetchNotes.mockImplementation((_token: string, entityType: string) => (entityType === 'leads'
      ? Promise.reject(new Error('amoCRM 502'))
      : Promise.resolve(entityType === 'contacts' ? [callNote(5)] : [])));

    await runSyncOnce();

    const state = savedSyncState();

    expect(state.lastError).toBe('amoCRM 502');
    expect(state.cursors.contacts).toBe(BASE + 5);
    expect(state.backfillComplete).toBe(false);
    expect(mockDb.call.createMany).toHaveBeenCalledTimes(1);
  });

  it('skips tenants without a usable amoCRM connection', async () => {
    mockAmoContext.mockResolvedValue(null);

    await runSyncOnce();

    expect(mockFetchNotes).not.toHaveBeenCalled();
    expect(mockDb.integration.update).not.toHaveBeenCalled();
  });
});
