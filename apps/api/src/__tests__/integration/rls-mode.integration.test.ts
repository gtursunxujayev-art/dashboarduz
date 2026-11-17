/**
 * Guards the "Enforced RLS" CI job: when TEST_DATABASE_APP_URL / TEST_DATABASE_SYSTEM_URL are set, prove that the
 * other integration tests really run against the restricted roles with FORCE ROW LEVEL SECURITY, so a passing
 * job means the app works with RLS enforced (and not that it silently ran as the table owner).
 * Skipped unless that mode is configured (see ./harness.ts).
 */
import { createCaller, createTestTenant, deleteTestTenant, disconnectDatabase, loadPrisma, rlsEnforced } from './harness';

const describeEnforced: jest.Describe = rlsEnforced ? describe : describe.skip;

jest.setTimeout(60_000);

describeEnforced('integration tests run with RLS enforced', () => {
  const tenants: string[] = [];

  afterAll(async () => {
    for (const tenantId of tenants) await deleteTestTenant(tenantId);
    await disconnectDatabase();
  });

  it('connects request code as dashboarduz_app and systemPrisma as dashboarduz_system', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- loaded after the harness set the URLs
    const { forTenant } = require('@dashboarduz/db') as typeof import('@dashboarduz/db');
    const tenant = await createTestTenant('rls-mode');

    tenants.push(tenant.tenantId);
    const [appRole] = await forTenant(tenant.tenantId, tenant.adminUserId).$queryRaw<Array<{ role: string }>>`SELECT current_user AS role`;
    const [systemRole] = await loadPrisma().$queryRaw<Array<{ role: string }>>`SELECT current_user AS role`;
    const [forced] = await loadPrisma().$queryRaw<Array<{ forced: boolean }>>`
      SELECT relforcerowsecurity AS forced FROM pg_class WHERE relname = 'incomes' AND relkind = 'r'`;

    expect(appRole?.role).toBe('dashboarduz_app');
    expect(systemRole?.role).toBe('dashboarduz_system');
    expect(forced?.forced).toBe(true);
  });

  it('leaves no application table without row level security', async () => {
    const unprotected = await loadPrisma().$queryRaw<Array<{ table: string }>>`
      SELECT c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
        AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
      ORDER BY 1`;

    expect(unprotected).toEqual([]);
  });

  it('keeps a tenant from reading another tenant through the API', async () => {
    const a = await createTestTenant('rls-mode-a');
    const b = await createTestTenant('rls-mode-b');

    tenants.push(a.tenantId, b.tenantId);
    const adminA = await createCaller({ tenantId: a.tenantId, userId: a.adminUserId, roles: ['Admin'] });
    const courseB = await (await createCaller({ tenantId: b.tenantId, userId: b.adminUserId, roles: ['Admin'] }))
      .customerIncome.createCourse({ name: 'B only', category: 'online' });
    const coursesSeenByA = await adminA.customerIncome.courseCatalog();

    expect(JSON.stringify(coursesSeenByA)).not.toContain(courseB.id);
  });
});
