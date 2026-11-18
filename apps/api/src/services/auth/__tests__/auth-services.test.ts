import { TRPCError } from '@trpc/server';
import { request, response } from 'express';

import { createContext, type Context } from '../../../trpc/context';
import { adminProcedure, managerProcedure, router } from '../../../trpc/trpc';
import { signJWT, verifyJWT } from '../jwt';
import type { OTPProvider } from '../otp';
import { hashPassword, verifyPassword } from '../password';

const mockActiveUser = jest.fn();

jest.mock('@dashboarduz/db', () => ({
  forTenant: () => ({ user: { findFirst: (...args: unknown[]) => mockActiveUser(...args) } }),
}));

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('password hashing', () => {
  it('verifies the right password only, with a fresh salt each time', async () => {
    const first = await hashPassword('pa55word');
    const second = await hashPassword('pa55word');

    expect(first).not.toBe(second);
    expect(await verifyPassword('pa55word', first)).toBe(true);
    expect(await verifyPassword('pa55word', second)).toBe(true);
    expect(await verifyPassword('other', first)).toBe(false);
  });

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'no-colon')).toBe(false);
    expect(await verifyPassword('x', 'salt:abcd')).toBe(false);
  });
});

describe('JWT', () => {
  it('round-trips the payload and rejects tampered tokens', () => {
    const token = signJWT({ userId: USER_ID, tenantId: TENANT_ID, roles: ['Admin'], phone: '+998' });

    expect(verifyJWT(token)).toMatchObject({ userId: USER_ID, tenantId: TENANT_ID, roles: ['Admin'], phone: '+998' });
    expect(() => verifyJWT(`${token}x`)).toThrow('Invalid or expired token');
    expect(() => verifyJWT('garbage')).toThrow('Invalid or expired token');
  });
});

describe('createContext', () => {
  function requestWith(headers: Record<string, string>) {
    return Object.assign(Object.create(request), { headers });
  }

  it('authenticates a valid bearer token', async () => {
    const token = signJWT({ userId: USER_ID, tenantId: TENANT_ID, roles: ['Manager'] });
    const ctx = await createContext({ req: requestWith({ authorization: `Bearer ${token}`, host: 'app.example.uz' }), res: response });

    expect(ctx.user).toMatchObject({ userId: USER_ID, tenantId: TENANT_ID, roles: ['Manager'] });
    expect(ctx.tenantId).toBe(TENANT_ID);
  });

  it('leaves the context anonymous for a missing, malformed or invalid token', async () => {
    const none = await createContext({ req: requestWith({ host: 'localhost' }), res: response });
    const basic = await createContext({ req: requestWith({ authorization: 'Basic abc' }), res: response });
    const invalid = await createContext({ req: requestWith({ authorization: 'Bearer nope' }), res: response });

    for (const ctx of [none, basic, invalid]) {
      expect(ctx).not.toHaveProperty('user');
      expect(ctx).not.toHaveProperty('tenantId');
    }
  });
});

describe('role procedures', () => {
  const testRouter = router({
    adminOnly: adminProcedure.query(() => 'admin ok'),
    managers: managerProcedure.query(() => 'manager ok'),
  });

  function callerWithRoles(roles: Array<'Admin' | 'Manager' | 'TeamLeader' | 'Agent'>) {
    const ctx: Context = {
      req: request,
      res: response,
      user: { userId: USER_ID, tenantId: TENANT_ID, roles },
      tenantId: TENANT_ID,
    };

    return testRouter.createCaller(ctx);
  }

  async function errorCode(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof TRPCError) return `${error.code}: ${error.message}`;
      throw error;
    }

    return 'resolved';
  }

  beforeEach(() => {
    mockActiveUser.mockReset();
    mockActiveUser.mockResolvedValue({ id: USER_ID });
  });

  it('lets an Admin into admin and manager procedures', async () => {
    await expect(callerWithRoles(['Admin']).adminOnly()).resolves.toBe('admin ok');
    await expect(callerWithRoles(['Admin']).managers()).resolves.toBe('manager ok');
    expect(mockActiveUser).toHaveBeenCalledWith({
      where: { id: USER_ID, tenantId: TENANT_ID, isActive: true },
      select: { id: true },
    });
  });

  it('lets Managers and TeamLeaders into manager procedures only', async () => {
    await expect(callerWithRoles(['Manager']).managers()).resolves.toBe('manager ok');
    await expect(callerWithRoles(['TeamLeader']).managers()).resolves.toBe('manager ok');
    expect(await errorCode(callerWithRoles(['Manager']).adminOnly())).toBe('FORBIDDEN: Admin access required');
    expect(await errorCode(callerWithRoles(['Agent']).managers())).toBe('FORBIDDEN: Manager, TeamLeader or Admin access required');
  });

  it('refuses a deactivated user and an anonymous caller', async () => {
    mockActiveUser.mockResolvedValue(null);
    expect(await errorCode(callerWithRoles(['Admin']).adminOnly())).toBe('UNAUTHORIZED: User is deactivated');

    const anonymous = testRouter.createCaller({ req: request, res: response });

    expect(await errorCode(anonymous.managers())).toBe('UNAUTHORIZED: Authentication required');
  });
});

describe('Twilio OTP provider', () => {
  const env = { ...process.env };
  let fetchSpy: jest.SpyInstance;

  function loadProvider(configured: boolean): OTPProvider {
    if (configured) {
      process.env.TWILIO_ACCOUNT_SID = 'AC1';
      process.env.TWILIO_AUTH_TOKEN = 'token';
      process.env.TWILIO_VERIFY_SERVICE_SID = 'VA1';
    } else {
      delete process.env.TWILIO_ACCOUNT_SID;
    }
    let provider: OTPProvider | undefined;

    jest.isolateModules(() => {
      provider = jest.requireActual<typeof import('../otp')>('../otp').otpService;
    });
    if (!provider) throw new Error('OTP module did not load');

    return provider;
  }

  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, statusText: status === 200 ? 'OK' : 'Error' });
  }

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = { ...env };
  });

  it('sends a verification SMS with basic auth and returns its sid', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { sid: 'VE1' }));

    const result = await loadProvider(true).sendOTP('+998901112233');

    expect(result).toEqual({ success: true, messageId: 'VE1' });
    const [url, init] = fetchSpy.mock.calls[0];

    expect(url).toBe('https://verify.twilio.com/v2/Services/VA1/Verifications');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('AC1:token').toString('base64')}`);
    expect(String(init.body)).toBe('To=%2B998901112233&Channel=sms');
  });

  it('fails to send without credentials, for a non-E.164 phone and on an API error', async () => {
    expect(await loadProvider(false).sendOTP('+998901112233')).toEqual({ success: false, error: 'Twilio OTP provider not initialized' });

    const provider = loadProvider(true);

    expect(await provider.sendOTP('998901112233')).toEqual({ success: false, error: 'Invalid phone number format' });
    fetchSpy.mockResolvedValue(new Response('bad', { status: 400, statusText: 'Bad Request' }));
    expect(await provider.sendOTP('+998901112233')).toEqual({ success: false, error: 'Twilio API error: 400 Bad Request' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('verifies an approved code and rejects pending, malformed and expired ones', async () => {
    const provider = loadProvider(true);

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { status: 'approved', sid: 'VE1' }));
    expect(await provider.verifyOTP('+998901112233', '123456')).toEqual({ success: true, verified: true });
    expect(String(fetchSpy.mock.calls[0][1].body)).toBe('To=%2B998901112233&Code=123456');

    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { status: 'pending' }));
    expect(await provider.verifyOTP('+998901112233', '123456')).toEqual({ success: true, verified: false });

    expect(await provider.verifyOTP('+998901112233', '12ab')).toEqual({ success: true, verified: false });

    fetchSpy.mockResolvedValueOnce(new Response('gone', { status: 404 }));
    expect(await provider.verifyOTP('+998901112233', '123456')).toEqual({ success: true, verified: false });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('reports verification service errors', async () => {
    expect(await loadProvider(false).verifyOTP('+998901112233', '123456'))
      .toEqual({ success: false, verified: false, error: 'Twilio OTP provider not initialized' });

    const provider = loadProvider(true);

    fetchSpy.mockResolvedValueOnce(new Response('oops', { status: 500, statusText: 'Server Error' }));
    expect(await provider.verifyOTP('+998901112233', '123456'))
      .toEqual({ success: false, verified: false, error: 'Twilio API error: 500 Server Error' });

    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    expect(await provider.verifyOTP('+998901112233', '123456')).toEqual({ success: false, verified: false, error: 'network down' });
  });
});
