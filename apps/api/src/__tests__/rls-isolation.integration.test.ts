import { randomBytes, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { forTenant } from '@dashboarduz/db';
import { PrismaClient } from '@prisma/client';

/**
 * Integration test for tenant isolation through the scoped client with RLS enforced.
 *
 * Runs only when TEST_DATABASE_URL points at a THROWAWAY database that already has
 * all migrations applied (`prisma migrate deploy`), connecting as its owner with
 * superuser or BYPASSRLS. It runs packages/db/scripts/rls-enforce.sql there
 * (roles, grants, FORCE RLS), gives the test roles random passwords and then
 * connects as dashboarduz_app / dashboarduz_system. Never point it at a real
 * database. Skipped otherwise.
 */

const ownerUrl = process.env.TEST_DATABASE_URL;
const describeDb = ownerUrl ? describe : describe.skip;

/** Splits a SQL script into statements, keeping $$-quoted bodies intact. */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollar = false;

  for (const line of sql.split('\n')) {
    const trimmed = line.trim();

    if (!inDollar && (trimmed.startsWith('--') || trimmed.length === 0)) continue;
    current += `${line}\n`;
    const dollarCount = (line.match(/\$\$/g) || []).length;

    if (dollarCount % 2 === 1) inDollar = !inDollar;
    if (!inDollar && trimmed.endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());

  return statements.filter((s) => !/^(BEGIN|COMMIT);$/i.test(s));
}

function urlForRole(base: string, role: string, password: string, connectionLimit: number): string {
  const url = new URL(base);

  url.username = role;
  url.password = password;
  url.searchParams.set('connection_limit', String(connectionLimit));

  return url.toString();
}

describeDb('RLS tenant isolation (integration)', () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();
  const password = randomBytes(18).toString('hex');

  let owner: PrismaClient;
  let app: PrismaClient;
  let system: PrismaClient;

  beforeAll(async () => {
    owner = new PrismaClient({ datasourceUrl: ownerUrl });
    const script = fs.readFileSync(path.resolve(__dirname, '../../../../packages/db/scripts/rls-enforce.sql'), 'utf8');

    for (const statement of splitSqlStatements(script)) {
      await owner.$executeRawUnsafe(statement);
    }
    await owner.$executeRawUnsafe(`ALTER ROLE dashboarduz_app PASSWORD '${password}'`);
    await owner.$executeRawUnsafe(`ALTER ROLE dashboarduz_system PASSWORD '${password}'`);

    await owner.tenant.createMany({
      data: [
        { id: tenantA, name: 'RLS test A' },
        { id: tenantB, name: 'RLS test B' },
      ],
    });
    await owner.user.createMany({
      data: [
        { id: userA, tenantId: tenantA, authProvider: 'test', username: `rls-a-${tenantA}` },
        { id: userB, tenantId: tenantB, authProvider: 'test', username: `rls-b-${tenantB}` },
      ],
    });
    await owner.customer.createMany({
      data: [
        { id: customerA, tenantId: tenantA, customerNumber: 'A-1', name: 'Customer A' },
        { id: customerB, tenantId: tenantB, customerNumber: 'B-1', name: 'Customer B' },
      ],
    });

    // A single pooled connection makes any context leak between requests visible.
    app = new PrismaClient({ datasourceUrl: urlForRole(ownerUrl as string, 'dashboarduz_app', password, 1) });
    system = new PrismaClient({ datasourceUrl: urlForRole(ownerUrl as string, 'dashboarduz_system', password, 1) });
  }, 60_000);

  afterAll(async () => {
    await owner?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await Promise.all([owner?.$disconnect(), app?.$disconnect(), system?.$disconnect()]);
  });

  it('reads only the current tenant rows', async () => {
    const dbA = forTenant(tenantA, userA, { client: app });
    const rows = await dbA.customer.findMany({ where: { id: { in: [customerA, customerB] } } });

    expect(rows.map((row) => row.id)).toEqual([customerA]);
    await expect(dbA.customer.findUnique({ where: { id: customerB } })).resolves.toBeNull();
    await expect(dbA.tenant.findMany({ where: { id: { in: [tenantA, tenantB] } } })).resolves.toHaveLength(1);
  });

  it('cannot write into or modify another tenant', async () => {
    const dbA = forTenant(tenantA, userA, { client: app });

    await expect(dbA.customer.create({
      data: { id: randomUUID(), tenantId: tenantB, customerNumber: 'A-into-B', name: 'Injected' },
    })).rejects.toThrow(/row-level security/i);
    await expect(dbA.customer.updateMany({ where: { id: customerB }, data: { name: 'Hijacked' } }))
      .resolves.toEqual({ count: 0 });
    await expect(dbA.customer.deleteMany({ where: { id: customerB } })).resolves.toEqual({ count: 0 });
    await expect(dbA.customer.update({ where: { id: customerA }, data: { tenantId: tenantB } }))
      .rejects.toThrow(/row-level security/i);

    const stillB = await owner.customer.findUnique({ where: { id: customerB } });

    expect(stillB?.name).toBe('Customer B');
    expect(stillB?.tenantId).toBe(tenantB);
  });

  it('scopes batch and interactive transactions and raw queries', async () => {
    const dbB = forTenant(tenantB, userB, { client: app });
    const [batchRows] = await dbB.$transaction([dbB.customer.findMany({ where: { id: { in: [customerA, customerB] } } })]);

    expect(batchRows.map((row) => row.id)).toEqual([customerB]);
    const interactive = await dbB.$transaction(async (tx) => tx.customer.findMany({ where: { id: { in: [customerA, customerB] } } }));

    expect(interactive.map((row) => row.id)).toEqual([customerB]);
    const raw = await dbB.$queryRaw<Array<{ id: string }>>`SELECT id FROM customers WHERE id IN (${customerA}, ${customerB})`;

    expect(raw.map((row) => row.id)).toEqual([customerB]);
  });

  it('does not leak context to the next request on the same connection', async () => {
    await forTenant(tenantA, userA, { client: app }).customer.findMany();
    const settings = await app.$queryRaw<Array<{ tenant: string | null }>>`SELECT current_setting('app.current_tenant', true) AS tenant`;

    expect(settings[0]?.tenant || '').toBe('');
    // No context at all: nothing is visible to the app role.
    await expect(app.customer.findMany({ where: { id: { in: [customerA, customerB] } } })).resolves.toHaveLength(0);

    const asB = await forTenant(tenantB, userB, { client: app }).customer.findMany({ where: { id: { in: [customerA, customerB] } } });

    expect(asB.map((row) => row.id)).toEqual([customerB]);
  });

  it('keeps concurrent requests for different tenants apart', async () => {
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => {
      const [tenant, user, expected] = i % 2 === 0 ? [tenantA, userA, customerA] : [tenantB, userB, customerB];

      return forTenant(tenant, user, { client: app })
        .customer.findMany({ where: { id: { in: [customerA, customerB] } }, select: { id: true } })
        .then((rows) => ({ expected, got: rows.map((row) => row.id) }));
    }));

    for (const result of results) {
      expect(result.got).toEqual([result.expected]);
    }
  });

  it('lets the system role see every tenant', async () => {
    const rows = await system.customer.findMany({ where: { id: { in: [customerA, customerB] } }, orderBy: { customerNumber: 'asc' } });

    expect(rows.map((row) => row.id)).toEqual([customerA, customerB]);
  });
});
