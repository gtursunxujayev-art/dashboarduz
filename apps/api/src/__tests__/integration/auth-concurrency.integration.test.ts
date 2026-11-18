/**
 * First OTP sign-in of a phone under concurrency, against real Postgres (skipped unless TEST_DATABASE_URL is set).
 * Phone is unique only per tenant, so the schema alone cannot stop two simultaneous first sign-ins from creating two
 * tenants; the advisory lock in auth.verifyOtp must.
 */
import { createTestTenant, deleteTestTenant, describeWithDatabase, disconnectDatabase, loadPrisma } from './harness';

jest.setTimeout(60_000);

describeWithDatabase('first OTP sign-in under concurrency (Postgres integration)', () => {
  const phone = `+99890${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;

  afterAll(async () => {
    const prisma = loadPrisma();
    const users = await prisma.user.findMany({ where: { phone }, select: { tenantId: true } });

    for (const tenantId of new Set(users.map((user) => user.tenantId))) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await deleteTestTenant(tenantId);
    }
    await disconnectDatabase();
  });

  it('creates one tenant and one user when the same phone signs in for the first time three times at once', async () => {
    const { otpService } = await import('../../services/auth/otp');
    const { rateLimiter } = await import('../../services/security/rate-limiter');
    const { appRouter } = await import('../../trpc/routers');

    jest.spyOn(otpService, 'verifyOTP').mockResolvedValue({ success: true, verified: true });
    jest.spyOn(rateLimiter, 'isAllowed').mockResolvedValue({ allowed: true } as never);
    const caller = () => appRouter.createCaller({ req: { headers: {} }, res: {} } as never);

    // Widen the race: every request's lookup before the transaction misses, as when all three read before any of them
    // committed. Only the read inside the transaction (under the lock) can then see the first one's user.
    jest.spyOn(loadPrisma().user, 'findFirst').mockResolvedValue(null);

    const results = await Promise.all([1, 2, 3].map(() => caller().auth.verifyOtp({ phone, code: '123456' })));

    jest.restoreAllMocks();
    const users = await loadPrisma().user.findMany({ where: { phone } });

    expect(users).toHaveLength(1);
    expect(new Set(results.map((result) => result.user.tenantId))).toEqual(new Set([users[0]!.tenantId]));
  });
});

describeWithDatabase('password registration against existing logins (Postgres integration)', () => {
  const tenantsToClean: string[] = [];

  afterAll(async () => {
    for (const tenantId of tenantsToClean) {
      await loadPrisma().auditLog.deleteMany({ where: { tenantId } });
      await deleteTestTenant(tenantId);
    }
    await disconnectDatabase();
  });

  async function publicCaller() {
    const { rateLimiter } = await import('../../services/security/rate-limiter');
    const { appRouter } = await import('../../trpc/routers');

    jest.spyOn(rateLimiter, 'isAllowed').mockResolvedValue({ allowed: true } as never);

    return appRouter.createCaller({ req: { headers: {} }, res: {} } as never);
  }

  it('refuses a login that exists without a password and leaves that user exactly as it was', async () => {
    const prisma = loadPrisma();
    const tenant = await createTestTenant('register-takeover');

    tenantsToClean.push(tenant.tenantId);
    const login = `it-nopass-${tenant.tenantId.slice(0, 8)}`;

    await prisma.user.update({ where: { id: tenant.adminUserId }, data: { username: login, passwordHash: null } });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: tenant.adminUserId } });
    const caller = await publicCaller();

    await expect(caller.auth.registerWithPassword({ login, password: 'attacker-pass', confirmPassword: 'attacker-pass' }))
      .rejects.toMatchObject({ code: 'CONFLICT', message: 'Account already exists. Please sign in.' });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: tenant.adminUserId } });

    expect(after).toEqual(before);
    expect(after.passwordHash).toBeNull();
    expect(await prisma.user.count({ where: { username: login } })).toBe(1);
  });

  it('registers a new login once when three registrations of it run at once', async () => {
    const prisma = loadPrisma();
    const login = `it-race-${Date.now()}`;
    const caller = await publicCaller();
    const results = await Promise.allSettled([1, 2, 3].map(() => caller.auth.registerWithPassword({ login, password: 'secret-pass', confirmPassword: 'secret-pass' })));
    const users = await prisma.user.findMany({ where: { username: login } });

    tenantsToClean.push(...users.map((user) => user.tenantId));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected').map((result) => (result).reason.message))
      .toEqual(['Account already exists. Please sign in.', 'Account already exists. Please sign in.']);
    expect(users).toHaveLength(1);
    expect(await prisma.tenant.count({ where: { name: login } })).toBe(1);
  });
});
