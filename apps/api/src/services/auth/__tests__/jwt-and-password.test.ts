import { scryptSync } from 'crypto';

import type { JWTPayload } from '@dashboarduz/shared';
import { decode, sign, verify } from 'jsonwebtoken';

import { hashPassword, verifyPassword } from '../password';

const PAYLOAD: JWTPayload = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  roles: ['Admin'],
  phone: '+998901234567',
};

const ENV_KEYS = ['JWT_SECRET', 'JWT_EXPIRES_IN', 'NODE_ENV'] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function withJwtModule(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, run: (jwt: typeof import('../jwt')) => void): Promise<void> {
  delete process.env.JWT_SECRET;
  delete process.env.JWT_EXPIRES_IN;
  Object.assign(process.env, env);
  await jest.isolateModulesAsync(async () => {
    run(await import('../jwt'));
  });
}

describe('signJWT / verifyJWT', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    restoreEnv();
  });

  it('signs with JWT_SECRET and a 7-day expiry by default, and verifies its own tokens', async () => {
    await withJwtModule({ JWT_SECRET: 'unit-secret' }, ({ signJWT, verifyJWT }) => {
      const token = signJWT(PAYLOAD);
      const decoded = verify(token, 'unit-secret') as JWTPayload & { iat: number; exp: number };

      expect(decoded).toMatchObject(PAYLOAD);
      expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60);
      expect(verifyJWT(token)).toMatchObject(PAYLOAD);
    });
  });

  it('honours JWT_EXPIRES_IN', async () => {
    await withJwtModule({ JWT_SECRET: 'unit-secret', JWT_EXPIRES_IN: '15m' }, ({ signJWT }) => {
      const decoded = decode(signJWT(PAYLOAD)) as { iat: number; exp: number };

      expect(decoded.exp - decoded.iat).toBe(15 * 60);
    });
  });

  it('falls back to the development secret when JWT_SECRET is unset', async () => {
    await withJwtModule({}, ({ signJWT }) => {
      expect(verify(signJWT(PAYLOAD), 'change-me-in-production')).toMatchObject(PAYLOAD);
    });
  });

  it('rejects tokens signed with another secret, tampered tokens, garbage and expired tokens', async () => {
    await withJwtModule({ JWT_SECRET: 'unit-secret' }, ({ signJWT, verifyJWT }) => {
      const foreign = sign(PAYLOAD, 'other-secret');
      const [header, , signature] = signJWT(PAYLOAD).split('.');
      const forgedBody = Buffer.from(JSON.stringify({ ...PAYLOAD, roles: ['SuperAdmin'] })).toString('base64url');

      expect(() => verifyJWT(foreign)).toThrow('Invalid or expired token');
      expect(() => verifyJWT(`${header}.${forgedBody}.${signature}`)).toThrow('Invalid or expired token');
      expect(() => verifyJWT('not-a-token')).toThrow('Invalid or expired token');

      const token = signJWT(PAYLOAD);
      const realNow = Date.now();

      jest.spyOn(Date, 'now').mockReturnValue(realNow + 8 * 24 * 60 * 60 * 1000);
      expect(() => verifyJWT(token)).toThrow('Invalid or expired token');
    });
  });
});

describe('hashPassword / verifyPassword (scrypt, salt:hash)', () => {
  it('hashes to a 32-hex salt and a 128-hex scrypt key that verifies', async () => {
    const stored = await hashPassword('correct horse battery staple');
    const [salt, hash] = stored.split(':');

    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toMatch(/^[0-9a-f]{128}$/);
    expect(hash).toBe(scryptSync('correct horse battery staple', salt ?? '', 64).toString('hex'));
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
    await expect(verifyPassword('Correct horse battery staple', stored)).resolves.toBe(false);
  });

  it('salts every hash differently', async () => {
    const first = await hashPassword('same');
    const second = await hashPassword('same');

    expect(first).not.toBe(second);
    await expect(verifyPassword('same', first)).resolves.toBe(true);
    await expect(verifyPassword('same', second)).resolves.toBe(true);
  });

  it('verifies a known salt:hash pair', async () => {
    const stored = `abcd:${scryptSync('pw', 'abcd', 64).toString('hex')}`;

    await expect(verifyPassword('pw', stored)).resolves.toBe(true);
    await expect(verifyPassword('pw2', stored)).resolves.toBe(false);
  });

  it('returns false for malformed stored values instead of throwing', async () => {
    await expect(verifyPassword('pw', '')).resolves.toBe(false);
    await expect(verifyPassword('pw', 'no-separator')).resolves.toBe(false);
    await expect(verifyPassword('pw', 'salt:')).resolves.toBe(false);
    await expect(verifyPassword('pw', ':hash')).resolves.toBe(false);
    await expect(verifyPassword('pw', 'salt:abcd')).resolves.toBe(false);
  });
});
