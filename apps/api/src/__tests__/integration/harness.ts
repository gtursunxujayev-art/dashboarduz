/**
 * Shared harness for integration tests that run tRPC procedures against a real Postgres.
 *
 * The tests are skipped unless TEST_DATABASE_URL is set. The URL must point at a throwaway database whose name
 * contains "test" (e.g. postgresql://postgres:postgres@localhost:5432/dashboarduz_test) and whose schema is already
 * migrated (`npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma` with DATABASE_URL set to it).
 * Never point it at a shared or production database: every test creates and deletes its own tenant.
 *
 * Import this module before anything that imports `@dashboarduz/db`, so the Prisma client picks up the test URL.
 */
import { randomUUID } from 'crypto';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || '';

function assertSafeTestDatabaseUrl(url: string): void {
  const parsed = new URL(url);
  const databaseName = parsed.pathname.replace(/^\//, '');

  if (!/test/i.test(databaseName)) {
    throw new Error(
      `TEST_DATABASE_URL must name a throwaway database whose name contains "test" (got "${databaseName}").`,
    );
  }
}

if (testDatabaseUrl) {
  assertSafeTestDatabaseUrl(testDatabaseUrl);
  // The Prisma singleton reads DATABASE_URL when it first connects; tests must never reach any other database.
  process.env.DATABASE_URL = testDatabaseUrl;
  // systemPrisma prefers DATABASE_SYSTEM_URL; drop it so the unscoped client also uses the test database.
  delete process.env.DATABASE_SYSTEM_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET || `integration-test-${randomUUID()}`;
  // Keep integration runs away from Redis-backed caching and outbound Telegram calls.
  delete process.env.REDIS_URL;
  delete process.env.TELEGRAM_BOT_TOKEN;
}

export const hasTestDatabase = Boolean(testDatabaseUrl);

/** `describe` when a test database is configured, otherwise `describe.skip` (so the suite reports as skipped). */
export const describeWithDatabase: jest.Describe = hasTestDatabase ? describe : describe.skip;

export type TestRole = 'Admin' | 'Manager' | 'Agent' | 'Finance';

export type TestTenant = {
  tenantId: string;
  adminUserId: string;
  agentUserId: string;
};

/* eslint-disable @typescript-eslint/no-var-requires -- loaded lazily so DATABASE_URL is set before Prisma is created */
function loadPrisma(): typeof import('@dashboarduz/db').systemPrisma {
  return (require('@dashboarduz/db') as typeof import('@dashboarduz/db')).systemPrisma;
}

/** Creates an isolated tenant with an Admin and a sales Agent (only Agent-like roles earn bonuses). */
export async function createTestTenant(label: string): Promise<TestTenant> {
  const prisma = loadPrisma();
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({
    data: { name: `it-${label}-${suffix}` },
  });
  const admin = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: `Admin ${suffix}`,
      username: `it-admin-${suffix}`,
      roles: ['Admin'],
      authProvider: 'email',
    },
  });
  const agent = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      name: `Agent ${suffix}`,
      username: `it-agent-${suffix}`,
      roles: ['Agent'],
      authProvider: 'email',
    },
  });

  return { tenantId: tenant.id, adminUserId: admin.id, agentUserId: agent.id };
}

/** Deletes everything the tenant owns. Rows without a cascade to Tenant are removed explicitly first. */
export async function deleteTestTenant(tenantId: string): Promise<void> {
  const prisma = loadPrisma();

  await prisma.$transaction([
    prisma.bonusAdjustmentApplication.deleteMany({ where: { tenantId } }),
    prisma.bonusAdjustmentAudit.deleteMany({ where: { tenantId } }),
    prisma.bonusAdjustment.deleteMany({ where: { tenantId } }),
    prisma.bonusSnapshotItem.deleteMany({ where: { tenantId } }),
    prisma.bonusSnapshotLine.deleteMany({ where: { tenantId } }),
    prisma.bonusMonthSnapshot.deleteMany({ where: { tenantId } }),
    prisma.bonusPolicyVersion.deleteMany({ where: { tenantId } }),
    prisma.auditLog.deleteMany({ where: { tenantId } }),
    prisma.incomeAdjustmentRequest.deleteMany({ where: { tenantId } }),
    prisma.income.updateMany({ where: { tenantId }, data: { relatedDebtIncomeId: null } }),
    prisma.income.deleteMany({ where: { tenantId } }),
    prisma.customer.deleteMany({ where: { tenantId } }),
    prisma.subTariff.deleteMany({ where: { tenantId } }),
    prisma.tariff.deleteMany({ where: { tenantId } }),
    prisma.course.deleteMany({ where: { tenantId } }),
    prisma.user.deleteMany({ where: { tenantId } }),
    prisma.tenant.delete({ where: { id: tenantId } }),
  ]);
}

/**
 * Builds a tRPC caller through the real `createContext`, authenticated with a signed JWT. Going through
 * createContext (instead of hand-building the context object) keeps these tests valid when the context grows,
 * e.g. a tenant-scoped database client.
 */
export async function createCaller(params: { tenantId: string; userId: string; roles: TestRole[] }) {
  const { signJWT } = require('../../services/auth/jwt') as typeof import('../../services/auth/jwt');
  const { createContext } = require('../../trpc/context') as typeof import('../../trpc/context');
  const { appRouter } = require('../../trpc/routers') as typeof import('../../trpc/routers');

  const token = signJWT({ userId: params.userId, tenantId: params.tenantId, roles: params.roles });
  const req = { headers: { authorization: `Bearer ${token}`, host: 'localhost' } };
  const res = {};
  const ctx = await createContext({
    req: req as unknown as Parameters<typeof createContext>[0]['req'],
    res: res as unknown as Parameters<typeof createContext>[0]['res'],
  });

  return appRouter.createCaller(ctx);
}

export async function disconnectDatabase(): Promise<void> {
  if (!hasTestDatabase) return;
  await loadPrisma().$disconnect();
}

export { loadPrisma };
/* eslint-enable @typescript-eslint/no-var-requires */

/** YYYY-MM-DD for a day in the previous Tashkent calendar month (always in the past, always in a finalizable month). */
export function previousMonthDay(day: number, now = new Date()): { date: string; month: string } {
  const tashkentNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const year = tashkentNow.getUTCFullYear();
  const monthIndex = tashkentNow.getUTCMonth() - 1;
  const target = new Date(Date.UTC(year, monthIndex, day));
  const yyyy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');

  return { date: `${yyyy}-${mm}-${dd}`, month: `${yyyy}-${mm}` };
}
