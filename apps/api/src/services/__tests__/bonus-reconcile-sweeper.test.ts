import { InMemoryPrisma } from '../../__tests__/helpers/in-memory-prisma';
import * as bonusEngine from '../bonus-engine';
import { sweepBonusReconcileRequests } from '../bonus-reconcile-sweeper';

let mockStore: InMemoryPrisma;

jest.mock('@dashboarduz/db', () => ({
  ...jest.requireActual('@dashboarduz/db'),
  get systemPrisma() {
    return mockStore.client();
  },
  forTenant: () => mockStore.client(),
}));

describe('bonus reconcile sweeper', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
  let tenantA: string;
  let tenantB: string;

  beforeEach(() => {
    mockStore = new InMemoryPrisma();
    [tenantA, tenantB] = mockStore.seed('Tenant', [{ name: 'A' }, { name: 'B' }]).map((row) => String(row.id)) as [string, string];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries owed reconciles once per tenant and clears them, leaving fresh ones to the request that wrote them', async () => {
    const reconcile = jest.spyOn(bonusEngine, 'reconcileFinalizedBonusMonths').mockResolvedValue(1);

    mockStore.seed('BonusReconcileRequest', [
      { tenantId: tenantA, reason: 'createIncome', createdAt: minutesAgo(30) },
      { tenantId: tenantA, reason: 'updateIncome', createdAt: minutesAgo(10) },
      { tenantId: tenantB, reason: 'deleteIncome', createdAt: minutesAgo(1) },
    ]);

    await expect(sweepBonusReconcileRequests(now)).resolves.toEqual({ tenants: 1, failed: 0 });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ tenantId: tenantA, actorUserId: null }));
    expect(mockStore.rows('BonusReconcileRequest').map((row) => row.tenantId)).toEqual([tenantB]);
  });

  it('keeps a request whose reconcile fails again and records the attempt', async () => {
    jest.spyOn(bonusEngine, 'reconcileFinalizedBonusMonths').mockRejectedValue(new Error('still broken'));
    mockStore.seed('BonusReconcileRequest', [{ tenantId: tenantA, reason: 'createIncome', attempts: 2, createdAt: minutesAgo(30) }]);

    await expect(sweepBonusReconcileRequests(now)).resolves.toEqual({ tenants: 1, failed: 1 });
    expect(mockStore.rows('BonusReconcileRequest')).toEqual([expect.objectContaining({ attempts: 3, lastError: 'still broken' })]);
  });
});
