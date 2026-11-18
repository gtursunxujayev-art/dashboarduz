import { TRPCError } from '@trpc/server';
import { request, response } from 'express';

import { verifyJWT } from '../../../services/auth/jwt';
import { hashPassword } from '../../../services/auth/password';
import type { Context } from '../../context';
import { authRouter } from '../auth';

// Every database call of the router goes through these mocks: systemPrisma (login, registration, OTP) and the
// tenant-scoped client that protectedProcedure builds with forTenant (me, changeCredentials, linkAccount).
const mockDb = {
  user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  tenant: { create: jest.fn() },
  auditLog: { create: jest.fn() },
  userAuthLink: { create: jest.fn() },
  $transaction: jest.fn(),
  $executeRaw: jest.fn(),
};
const mockIsAllowed = jest.fn();
const mockSendOtp = jest.fn();
const mockVerifyOtp = jest.fn();

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
  forTenant: () => mockDb,
}));
jest.mock('../../../services/security/rate-limiter', () => ({
  rateLimiter: { isAllowed: (...args: unknown[]) => mockIsAllowed(...args) },
}));
jest.mock('../../../services/auth/otp', () => ({
  otpService: {
    sendOTP: (...args: unknown[]) => mockSendOtp(...args),
    verifyOTP: (...args: unknown[]) => mockVerifyOtp(...args),
  },
}));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function publicCaller() {
  const ctx: Context = { req: request, res: response };

  return authRouter.createCaller(ctx);
}

function signedInCaller() {
  const ctx: Context = {
    req: request,
    res: response,
    user: { userId: USER_ID, tenantId: TENANT_ID, roles: ['Admin'] },
    tenantId: TENANT_ID,
  };

  return authRouter.createCaller(ctx);
}

async function rejection(promise: Promise<unknown>): Promise<TRPCError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TRPCError) return error;
    throw error;
  }
  throw new Error('Expected the procedure to throw');
}

beforeEach(() => {
  jest.resetAllMocks();
  mockIsAllowed.mockResolvedValue({ allowed: true });
  mockDb.auditLog.create.mockResolvedValue({});
  // The transaction callback receives the same mock client.
  mockDb.$transaction.mockImplementation((fn: (tx: typeof mockDb) => Promise<unknown>) => fn(mockDb));
});

describe('auth.registerWithPassword', () => {
  const input = { login: 'New.User', password: 'secret-pass', confirmPassword: 'secret-pass' };

  it('creates a tenant with an Admin user for a new login and returns a token for it', async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    mockDb.tenant.create.mockResolvedValue({ id: TENANT_ID });
    mockDb.user.create.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID, roles: ['Admin', 'Legacy'] });

    const result = await publicCaller().registerWithPassword(input);

    expect(mockIsAllowed).toHaveBeenCalledWith('new.user', 'auth:register-password', {
      maxRequests: 5,
      windowMs: 15 * 60 * 1000,
      keyPrefix: 'password-register',
    });
    expect(mockDb.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { username: 'new.user' } }));
    expect(mockDb.tenant.create).toHaveBeenCalledWith({ data: { name: 'new.user', plan: 'free' } });
    const createArgs = mockDb.user.create.mock.calls[0][0];

    expect(createArgs.data).toMatchObject({ tenantId: TENANT_ID, username: 'new.user', roles: ['Admin'], authProvider: 'email' });
    expect(createArgs.data.passwordHash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    // Unknown roles are dropped from the token payload.
    expect(result.user).toEqual({ userId: USER_ID, tenantId: TENANT_ID, roles: ['Admin'] });
    expect(verifyJWT(result.token)).toMatchObject({ userId: USER_ID, tenantId: TENANT_ID, roles: ['Admin'] });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT_ID, userId: USER_ID, action: 'register_password', resource: 'auth', metadata: { login: 'new.user' } },
    });
  });

  it('refuses a login that exists without a password: no password set, no session, no tenant or roles taken over', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID, roles: ['Admin'], passwordHash: null });

    const error = await rejection(publicCaller().registerWithPassword(input));

    expect(error).toMatchObject({ code: 'CONFLICT', message: 'Account already exists. Please sign in.' });
    expect(mockDb.user.update).not.toHaveBeenCalled();
    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(mockDb.tenant.create).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses a login that already has a password with the identical error', async () => {
    mockDb.user.findFirst.mockResolvedValueOnce({ id: USER_ID, passwordHash: null });
    const withoutPassword = await rejection(publicCaller().registerWithPassword(input));

    mockDb.user.findFirst.mockResolvedValueOnce({ id: USER_ID, passwordHash: 'a:b' });
    const withPassword = await rejection(publicCaller().registerWithPassword(input));

    expect([withPassword.code, withPassword.message]).toEqual(['CONFLICT', 'Account already exists. Please sign in.']);
    expect([withPassword.code, withPassword.message]).toEqual([withoutPassword.code, withoutPassword.message]);
    // The lookup only asks whether the login exists, not whether it has a password.
    expect(mockDb.user.findFirst).toHaveBeenLastCalledWith({ where: { username: 'new.user' }, select: { id: true } });
  });

  it('maps a unique violation of a concurrent registration to CONFLICT', async () => {
    mockDb.user.findFirst.mockResolvedValue(null);
    mockDb.$transaction.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    const error = await rejection(publicCaller().registerWithPassword(input));

    expect(error).toMatchObject({ code: 'CONFLICT', message: 'Account already exists. Please sign in.' });
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords and rate-limited attempts before touching the database', async () => {
    const mismatch = await rejection(publicCaller().registerWithPassword({ ...input, confirmPassword: 'other-pass' }));

    expect(mismatch).toMatchObject({ code: 'BAD_REQUEST', message: 'Passwords do not match' });

    mockIsAllowed.mockResolvedValue({ allowed: false });
    const limited = await rejection(publicCaller().registerWithPassword(input));

    expect(limited).toMatchObject({ code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Try again later.' });
    expect(mockDb.user.findFirst).not.toHaveBeenCalled();
  });
});

describe('auth.loginWithPassword', () => {
  it('signs in by username, email or phone and puts phone and email into the token', async () => {
    const passwordHash = await hashPassword('right-pass');

    mockDb.user.findFirst.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID, roles: ['Manager'], passwordHash, isActive: true });
    mockDb.user.update.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID, roles: ['Manager', 'Ghost'], phone: '+998901112233', email: 'm@x.uz' });

    const result = await publicCaller().loginWithPassword({ login: ' M@X.uz ', password: 'right-pass' });

    expect(mockDb.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ username: 'm@x.uz' }, { email: 'm@x.uz' }, { phone: 'm@x.uz' }] },
    }));
    expect(result.user).toEqual({ userId: USER_ID, tenantId: TENANT_ID, roles: ['Manager'], phone: '+998901112233', email: 'm@x.uz' });
    expect(verifyJWT(result.token)).toMatchObject({ phone: '+998901112233', email: 'm@x.uz' });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'login_password', metadata: { login: 'm@x.uz' } }),
    }));
  });

  it('omits phone and email from the token when the user has none', async () => {
    const passwordHash = await hashPassword('right-pass');

    mockDb.user.findFirst.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID, roles: ['Agent'], passwordHash, isActive: true });
    mockDb.user.update.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID, roles: ['Agent'], phone: null, email: null });

    const result = await publicCaller().loginWithPassword({ login: 'agent', password: 'right-pass' });

    expect(result.user).toEqual({ userId: USER_ID, tenantId: TENANT_ID, roles: ['Agent'] });
  });

  it('answers the same for an unknown login, a user without password and a wrong password', async () => {
    const passwordHash = await hashPassword('right-pass');

    mockDb.user.findFirst.mockResolvedValueOnce(null);
    expect(await rejection(publicCaller().loginWithPassword({ login: 'nobody', password: 'x' })))
      .toMatchObject({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });

    mockDb.user.findFirst.mockResolvedValueOnce({ id: USER_ID, tenantId: TENANT_ID, roles: [], passwordHash: null, isActive: true });
    expect(await rejection(publicCaller().loginWithPassword({ login: 'nopass', password: 'x' })))
      .toMatchObject({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });

    mockDb.user.findFirst.mockResolvedValueOnce({ id: USER_ID, tenantId: TENANT_ID, roles: [], passwordHash, isActive: true });
    expect(await rejection(publicCaller().loginWithPassword({ login: 'agent', password: 'wrong-pass' })))
      .toMatchObject({ code: 'UNAUTHORIZED', message: 'Invalid credentials' });
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it('tells a deactivated user so, and rate-limits by login', async () => {
    mockDb.user.findFirst.mockResolvedValueOnce({ id: USER_ID, tenantId: TENANT_ID, roles: [], passwordHash: 'a:b', isActive: false });
    expect(await rejection(publicCaller().loginWithPassword({ login: 'gone', password: 'x' })))
      .toMatchObject({ code: 'UNAUTHORIZED', message: 'User is deactivated' });

    mockIsAllowed.mockResolvedValue({ allowed: false });
    expect(await rejection(publicCaller().loginWithPassword({ login: 'Agent', password: 'x' })))
      .toMatchObject({ code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Try again later.' });
    expect(mockIsAllowed).toHaveBeenLastCalledWith('agent', 'auth:login-password', expect.objectContaining({ maxRequests: 10 }));
  });
});

describe('auth.requestOtp', () => {
  it('sends the code through the OTP provider and returns its session id', async () => {
    mockSendOtp.mockResolvedValue({ success: true, messageId: 'VE123' });

    const result = await publicCaller().requestOtp({ phone: '+998901112233' });

    expect(mockSendOtp).toHaveBeenCalledWith('+998901112233');
    expect(result).toEqual({ success: true, message: 'OTP sent successfully', sessionId: 'VE123' });
  });

  it('reports a provider failure as INTERNAL_SERVER_ERROR', async () => {
    mockSendOtp.mockResolvedValue({ success: false, error: 'down' });

    expect(await rejection(publicCaller().requestOtp({ phone: '+998901112233' })))
      .toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send OTP' });
  });

  it('keeps the rate-limit message when too many codes were requested', async () => {
    mockIsAllowed.mockResolvedValue({ allowed: false });

    const error = await rejection(publicCaller().requestOtp({ phone: '+998901112233' }));

    expect(error.message).toBe('Too many OTP requests. Try again later.');
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it('answers a rate-limited OTP request with TOO_MANY_REQUESTS', async () => {
    mockIsAllowed.mockResolvedValue({ allowed: false });

    expect((await rejection(publicCaller().requestOtp({ phone: '+998901112233' }))).code).toBe('TOO_MANY_REQUESTS');
  });
});

describe('auth.verifyOtp', () => {
  const input = { phone: '+998901112233', code: '123456' };

  it('signs in an existing active user by phone', async () => {
    mockVerifyOtp.mockResolvedValue({ success: true, verified: true });
    mockDb.user.findFirst.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID, roles: ['Agent'], phone: input.phone, isActive: true });
    mockDb.user.update.mockResolvedValue({ id: USER_ID });

    const result = await publicCaller().verifyOtp(input);

    expect(mockVerifyOtp).toHaveBeenCalledWith(input.phone, input.code);
    expect(mockDb.tenant.create).not.toHaveBeenCalled();
    expect(result.user).toEqual({ userId: USER_ID, tenantId: TENANT_ID, roles: ['Agent'], phone: input.phone });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: { tenantId: TENANT_ID, userId: USER_ID, action: 'login_otp', resource: 'auth', metadata: { phone: input.phone } },
    });
  });

  it('creates a tenant and an Admin user on the first OTP sign-in of a phone', async () => {
    mockVerifyOtp.mockResolvedValue({ success: true, verified: true });
    mockDb.user.findFirst.mockResolvedValue(null);
    mockDb.tenant.create.mockResolvedValue({ id: TENANT_ID });
    mockDb.user.create.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID, roles: ['Admin'], phone: input.phone, isActive: true });
    mockDb.user.update.mockResolvedValue({ id: USER_ID });

    const result = await publicCaller().verifyOtp(input);

    expect(mockDb.tenant.create).toHaveBeenCalledWith({ data: { name: `Tenant ${input.phone}`, plan: 'free' } });
    expect(mockDb.user.create.mock.calls[0][0].data).toEqual({
      tenantId: TENANT_ID, phone: input.phone, roles: ['Admin'], authProvider: 'phone',
    });
    expect(result).toMatchObject({ success: true, user: { userId: USER_ID, tenantId: TENANT_ID, roles: ['Admin'] } });
  });

  it('serializes first OTP sign-ins of one phone: the second one, after the lock, uses the user the first created', async () => {
    mockVerifyOtp.mockResolvedValue({ success: true, verified: true });
    // Not found before the lock; found once the lock is held (the concurrent first sign-in created it).
    mockDb.user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: USER_ID, tenantId: TENANT_ID, roles: ['Admin'], phone: input.phone, isActive: true });
    mockDb.user.update.mockResolvedValue({ id: USER_ID });

    const result = await publicCaller().verifyOtp(input);

    expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
    expect(mockDb.$executeRaw.mock.calls[0].slice(1)).toEqual([`otp-first-login:${input.phone}`]);
    expect(mockDb.tenant.create).not.toHaveBeenCalled();
    expect(mockDb.user.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, user: { userId: USER_ID, tenantId: TENANT_ID } });
  });

  it('rejects a wrong code, a provider error, a deactivated user and too many attempts', async () => {
    mockVerifyOtp.mockResolvedValueOnce({ success: true, verified: false });
    expect(await rejection(publicCaller().verifyOtp(input))).toMatchObject({ code: 'UNAUTHORIZED', message: 'Invalid OTP code' });

    mockVerifyOtp.mockResolvedValueOnce({ success: false, verified: false });
    expect(await rejection(publicCaller().verifyOtp(input)))
      .toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'OTP verification service error' });

    mockVerifyOtp.mockResolvedValueOnce({ success: true, verified: true });
    mockDb.user.findFirst.mockResolvedValueOnce({ id: USER_ID, tenantId: TENANT_ID, roles: [], phone: input.phone, isActive: false });
    expect(await rejection(publicCaller().verifyOtp(input))).toMatchObject({ code: 'UNAUTHORIZED', message: 'User is deactivated' });

    mockIsAllowed.mockResolvedValueOnce({ allowed: false });
    expect(await rejection(publicCaller().verifyOtp(input)))
      .toMatchObject({ code: 'TOO_MANY_REQUESTS', message: 'Too many OTP attempts. Try again later.' });
  });

  it('wraps an unexpected database error with its message', async () => {
    mockVerifyOtp.mockResolvedValue({ success: true, verified: true });
    mockDb.user.findFirst.mockRejectedValue(new Error('connection lost'));

    expect(await rejection(publicCaller().verifyOtp(input))).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', message: 'connection lost' });
  });
});

describe('auth.telegramLogin', () => {
  it('is disabled', async () => {
    const error = await rejection(publicCaller().telegramLogin({ id: 1, first_name: 'A', auth_date: 1, hash: 'h' }));

    expect(error.code).toBe('PRECONDITION_FAILED');
    expect(error.message).toContain('Telegram direct login is disabled in MVP');
  });
});

describe('auth.me', () => {
  it('returns the signed-in user and requires authentication', async () => {
    const me = { id: USER_ID, tenantId: TENANT_ID, username: 'admin', roles: ['Admin'] };

    // First findFirst is protectedProcedure's active-user check.
    mockDb.user.findFirst.mockResolvedValue({ id: USER_ID });
    mockDb.user.findUnique.mockResolvedValue(me);

    await expect(signedInCaller().me()).resolves.toEqual(me);
    expect(mockDb.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: USER_ID } }));
    expect(await rejection(publicCaller().me())).toMatchObject({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  });

  it('rejects a deactivated user and a user that no longer exists', async () => {
    mockDb.user.findFirst.mockResolvedValueOnce(null);
    expect(await rejection(signedInCaller().me())).toMatchObject({ code: 'UNAUTHORIZED', message: 'User is deactivated' });

    mockDb.user.findFirst.mockResolvedValueOnce({ id: USER_ID });
    mockDb.user.findUnique.mockResolvedValueOnce(null);
    expect(await rejection(signedInCaller().me())).toMatchObject({ code: 'NOT_FOUND', message: 'User not found' });
  });
});

describe('auth.changeCredentials', () => {
  beforeEach(() => {
    mockDb.user.findFirst.mockResolvedValue({ id: USER_ID });
  });

  it('changes login and password after checking the current password', async () => {
    const passwordHash = await hashPassword('current-pass');

    mockDb.user.findUnique.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID, username: 'old', passwordHash });
    // active check, then the cross-tenant duplicate check
    mockDb.user.findFirst.mockResolvedValueOnce({ id: USER_ID }).mockResolvedValueOnce(null);
    mockDb.user.update.mockResolvedValue({ id: USER_ID, username: 'fresh' });

    const result = await signedInCaller().changeCredentials({ currentPassword: 'current-pass', newLogin: 'Fresh', newPassword: 'next-password' });

    expect(result).toEqual({ success: true, user: { id: USER_ID, username: 'fresh' } });
    expect(mockDb.user.findFirst).toHaveBeenLastCalledWith({ where: { username: 'fresh', NOT: { id: USER_ID } }, select: { id: true } });
    const data = mockDb.user.update.mock.calls[0][0].data;

    expect(data.username).toBe('fresh');
    expect(data.passwordHash).not.toBe(passwordHash);
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        userId: USER_ID,
        action: 'self_credentials_update',
        resource: 'auth',
        resourceId: USER_ID,
        metadata: { loginUpdated: true, passwordUpdated: true },
      },
    });
  });

  it('refuses a login taken by another user, a wrong password and an empty change', async () => {
    const passwordHash = await hashPassword('current-pass');

    mockDb.user.findUnique.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID, username: 'old', passwordHash });

    mockDb.user.findFirst.mockResolvedValueOnce({ id: USER_ID }).mockResolvedValueOnce({ id: 'someone-else' });
    expect(await rejection(signedInCaller().changeCredentials({ currentPassword: 'current-pass', newLogin: 'taken' })))
      .toMatchObject({ code: 'CONFLICT', message: 'Login already in use.' });

    expect(await rejection(signedInCaller().changeCredentials({ currentPassword: 'nope', newPassword: 'next-password' })))
      .toMatchObject({ code: 'UNAUTHORIZED', message: 'Current password is incorrect.' });

    expect(await rejection(signedInCaller().changeCredentials({ currentPassword: 'current-pass' })))
      .toMatchObject({ code: 'BAD_REQUEST', message: 'No changes provided.' });
    expect(mockDb.user.update).not.toHaveBeenCalled();
  });

  it('skips the duplicate check when the new login equals the current one', async () => {
    const passwordHash = await hashPassword('current-pass');

    mockDb.user.findUnique.mockResolvedValue({ id: USER_ID, tenantId: TENANT_ID, username: 'old', passwordHash });
    mockDb.user.update.mockResolvedValue({ id: USER_ID, username: 'old' });

    await signedInCaller().changeCredentials({ currentPassword: 'current-pass', newLogin: 'OLD' });

    // Only protectedProcedure's active-user check ran.
    expect(mockDb.user.findFirst).toHaveBeenCalledTimes(1);
    expect(mockDb.user.update.mock.calls[0][0].data).toEqual({ username: 'old' });
    expect(mockDb.auditLog.create.mock.calls[0][0].data.metadata).toEqual({ loginUpdated: true, passwordUpdated: false });
  });

  it('needs an existing user with password login', async () => {
    mockDb.user.findUnique.mockResolvedValueOnce(null);
    expect(await rejection(signedInCaller().changeCredentials({ currentPassword: 'x' })))
      .toMatchObject({ code: 'NOT_FOUND', message: 'User not found' });

    mockDb.user.findUnique.mockResolvedValueOnce({ id: USER_ID, tenantId: TENANT_ID, username: 'old', passwordHash: null });
    expect(await rejection(signedInCaller().changeCredentials({ currentPassword: 'x' })))
      .toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Password login is not configured for this user.' });
  });
});

describe('auth.linkAccount', () => {
  it('stores a verified auth link and audits it', async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: USER_ID });
    mockDb.userAuthLink.create.mockResolvedValue({});

    await expect(signedInCaller().linkAccount({ provider: 'telegram', providerId: '777' })).resolves.toEqual({ success: true });
    expect(mockDb.userAuthLink.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, provider: 'telegram', providerId: '777', verified: true },
    });
    expect(mockDb.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT_ID,
        userId: USER_ID,
        action: 'link_account',
        resource: 'auth',
        metadata: { provider: 'telegram', providerId: '777' },
      },
    });
  });
});
