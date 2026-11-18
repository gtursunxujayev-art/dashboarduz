import { EncryptionService } from '../encryption';
import { RateLimiter } from '../rate-limiter';

// A minimal in-memory stand-in for the ioredis calls the rate limiter makes (sorted sets, pipeline, scan).
class FakeRedis {
  sets = new Map<string, Map<string, number>>();
  strings = new Map<string, string>();
  failing = false;
  pipelineResult: unknown = undefined;

  private check() {
    if (this.failing) throw new Error('ECONNREFUSED');
  }

  zremrangebyscore(key: string, min: number, max: number) {
    this.check();
    const set = this.sets.get(key);

    if (set) for (const [member, score] of set) if (score >= min && score <= max) set.delete(member);

    return Promise.resolve(0);
  }

  zadd(key: string, score: number, member: string) {
    this.check();
    const set = this.sets.get(key) ?? new Map<string, number>();

    set.set(member, score);
    this.sets.set(key, set);

    return Promise.resolve(1);
  }

  zcard(key: string) {
    this.check();

    return Promise.resolve(this.sets.get(key)?.size ?? 0);
  }

  expire() {
    return Promise.resolve(1);
  }

  del(key: string) {
    this.check();
    this.sets.delete(key);

    return Promise.resolve(1);
  }

  set(key: string, value: string) {
    this.check();
    this.strings.set(key, value);

    return Promise.resolve('OK');
  }

  get(key: string) {
    this.check();

    return Promise.resolve(this.strings.get(key) ?? null);
  }

  scan(cursor: string, _match: string, pattern: string) {
    this.check();
    const prefix = pattern.replace(/\*$/, '');
    const keys = Array.from(this.sets.keys()).filter((key) => key.startsWith(prefix));

    // Two pages, to exercise the cursor loop.
    return Promise.resolve(cursor === '0' ? ['7', keys.slice(0, 1)] : ['0', keys.slice(1)]);
  }

  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    const pipe = {
      zremrangebyscore: (key: string, min: number, max: number) => {
        ops.push(() => this.zremrangebyscore(key, min, max));

        return pipe;
      },
      zadd: (key: string, score: number, member: string) => {
        ops.push(() => this.zadd(key, score, member));

        return pipe;
      },
      expire: () => {
        ops.push(() => this.expire());

        return pipe;
      },
      zcard: (key: string) => {
        ops.push(() => this.zcard(key));

        return pipe;
      },
      exec: async () => {
        if (this.pipelineResult !== undefined) return this.pipelineResult;
        const results: Array<[null, unknown]> = [];

        for (const op of ops) results.push([null, await op()]);

        return results;
      },
    };

    return pipe;
  }
}

const mockRedis = new FakeRedis();

jest.mock('../../queue/redis-client', () => ({
  getRedisClient: () => mockRedis,
}));

beforeEach(() => {
  mockRedis.sets.clear();
  mockRedis.strings.clear();
  mockRedis.failing = false;
  mockRedis.pipelineResult = undefined;
});

describe('RateLimiter with Redis', () => {
  it('allows up to maxRequests in the window and reports the remaining budget', async () => {
    const limiter = new RateLimiter();
    const config = { maxRequests: 2, windowMs: 60_000, keyPrefix: 'test' };

    const first = await limiter.isAllowed('t1', 'login', config);
    const second = await limiter.isAllowed('t1', 'login', config);
    const third = await limiter.isAllowed('t1', 'login', config);

    expect([first.allowed, second.allowed, third.allowed]).toEqual([true, true, false]);
    expect([first.remaining, second.remaining, third.remaining]).toEqual([1, 0, 0]);
    expect(third.limit).toBe(2);
    expect(mockRedis.sets.get('test:t1:login')?.size).toBe(3);
    // Another endpoint has its own window.
    expect((await limiter.isAllowed('t1', 'other', config)).allowed).toBe(true);
  });

  it('reads the window without consuming it and resets it', async () => {
    const limiter = new RateLimiter();

    await limiter.isAllowed('t1', 'api');
    await limiter.isAllowed('t1', 'api');

    expect(await limiter.getRateLimitInfo('t1', 'api')).toMatchObject({ remaining: 98, limit: 100 });
    expect(await limiter.getRateLimitInfo('t1', 'api')).toMatchObject({ remaining: 98 });

    await limiter.resetRateLimit('t1', 'api');
    expect(await limiter.getRateLimitInfo('t1', 'api')).toMatchObject({ remaining: 100 });
  });

  it('lists every endpoint window of a tenant across scan pages', async () => {
    const limiter = new RateLimiter();

    await limiter.isAllowed('t1', 'a');
    await limiter.isAllowed('t1', 'b');
    await limiter.isAllowed('t1', 'b');
    await limiter.isAllowed('t2', 'c');

    const limits = await limiter.getTenantRateLimits('t1');

    expect(limits.map((row) => [row.endpoint, row.remaining, row.limit])).toEqual([['a', 99, 100], ['b', 98, 100]]);
  });

  it('maps plans to limits and builds rate-limit headers', async () => {
    const limiter = new RateLimiter();

    expect(limiter.getPlanConfig('Enterprise')).toEqual({ maxRequests: 1000, windowMs: 60_000 });
    expect(limiter.getPlanConfig('pro')).toEqual({ maxRequests: 500, windowMs: 60_000 });
    expect(limiter.getPlanConfig('anything')).toEqual({ maxRequests: 100, windowMs: 60_000 });

    const result = await limiter.middleware('t1', 'x', 'pro');

    expect(result.allowed).toBe(true);
    expect(result.headers).toMatchObject({ 'X-RateLimit-Limit': '500', 'X-RateLimit-Remaining': '499' });
    expect(result.headers?.['X-RateLimit-Reset']).toMatch(/^\d+$/);
  });

  it('refuses through the middleware once the plan budget is spent', async () => {
    const limiter = new RateLimiter();

    for (let index = 0; index < 100; index += 1) await limiter.isAllowed('t1', 'busy', limiter.getPlanConfig('free'));

    expect(await limiter.middleware('t1', 'busy')).toMatchObject({ allowed: false, error: 'Rate limit exceeded' });
  });

  it('reports Redis health', async () => {
    const limiter = new RateLimiter();

    expect(await limiter.healthCheck()).toEqual({ status: 'healthy' });

    jest.spyOn(mockRedis, 'get').mockResolvedValueOnce('other');
    expect(await limiter.healthCheck()).toEqual({ status: 'unhealthy', error: 'Redis test failed' });

    mockRedis.failing = true;
    expect(await limiter.healthCheck()).toEqual({ status: 'unhealthy', error: 'ECONNREFUSED' });
  });
});

describe('RateLimiter fallback without Redis', () => {
  it('keeps throttling with the in-memory sliding window', async () => {
    mockRedis.failing = true;
    const limiter = new RateLimiter();
    const config = { maxRequests: 2, windowMs: 60_000, keyPrefix: 'mem' };

    const results = [];

    for (let index = 0; index < 3; index += 1) results.push(await limiter.isAllowed('t1', 'otp', config));

    expect(results.map((result) => result.allowed)).toEqual([true, true, false]);
    expect(await limiter.getRateLimitInfo('t1', 'otp', config)).toMatchObject({ remaining: 0, limit: 2 });

    await limiter.resetRateLimit('t1', 'otp', config);
    expect(await limiter.getRateLimitInfo('t1', 'otp', config)).toMatchObject({ remaining: 2 });
    expect(await limiter.getTenantRateLimits('t1')).toEqual([]);
  });

  it('forgets in-memory requests older than the window', async () => {
    mockRedis.failing = true;
    const limiter = new RateLimiter();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

    await limiter.isAllowed('t1', 'slow', { maxRequests: 1, windowMs: 1000 });
    expect((await limiter.isAllowed('t1', 'slow', { maxRequests: 1, windowMs: 1000 })).allowed).toBe(false);

    nowSpy.mockReturnValue(1_005_000);
    expect(await limiter.getRateLimitInfo('t1', 'slow', { maxRequests: 1, windowMs: 1000 })).toMatchObject({ remaining: 1 });
    expect((await limiter.isAllowed('t1', 'slow', { maxRequests: 1, windowMs: 1000 })).allowed).toBe(true);
    nowSpy.mockRestore();
  });

  it('falls back when the pipeline returns nothing', async () => {
    mockRedis.pipelineResult = null;
    const limiter = new RateLimiter();

    expect(await limiter.isAllowed('t1', 'null-pipe', { maxRequests: 1 })).toMatchObject({ allowed: true, remaining: 0, limit: 1 });
  });
});

describe('EncryptionService', () => {
  const previousKey = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    if (previousKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previousKey;
  });

  it('round-trips text and JSON with AES-256-GCM and a random IV', () => {
    process.env.ENCRYPTION_KEY = 'unit-test-key';
    const service = new EncryptionService();

    const first = service.encrypt('secret');
    const second = service.encrypt('secret');

    expect(first).not.toBeNull();
    expect(first).not.toBe(second);
    expect(JSON.parse(Buffer.from(first ?? '', 'base64').toString('utf8'))).toMatchObject({ algorithm: 'aes-256-gcm', version: '1.0' });
    expect(service.decrypt(first ?? '')).toBe('secret');

    const json = service.encryptJSON({ access_token: 'a', expires: 5 });

    expect(service.decryptJSON(json ?? '')).toEqual({ access_token: 'a', expires: 5 });
  });

  it('refuses data encrypted with another key, tampered data and malformed input', () => {
    process.env.ENCRYPTION_KEY = 'key-one';
    const one = new EncryptionService();

    process.env.ENCRYPTION_KEY = 'key-two';
    const two = new EncryptionService();
    const encrypted = one.encrypt('secret') ?? '';

    expect(two.decrypt(encrypted)).toBeNull();
    const payload = JSON.parse(Buffer.from(encrypted, 'base64').toString('utf8'));
    const tampered = Buffer.from(JSON.stringify({ ...payload, algorithm: 'aes-128-cbc' })).toString('base64');

    expect(one.decrypt(tampered)).toBeNull();
    expect(one.decrypt('not base64 json')).toBeNull();
    expect(one.decryptJSON(one.encrypt('not json') ?? '')).toBeNull();
    expect(one.decryptJSON('garbage')).toBeNull();
  });

  it('returns null for everything when no key is configured', () => {
    delete process.env.ENCRYPTION_KEY;
    const disabled = new EncryptionService();

    expect(disabled.encrypt('x')).toBeNull();
    expect(disabled.decrypt('x')).toBeNull();
    expect(disabled.encryptJSON({ a: 1 })).toBeNull();
  });

  it('hashes, signs and verifies HMACs', () => {
    expect(EncryptionService.hash('data')).toBe('3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7');
    expect(EncryptionService.hash('data', 'salt')).not.toBe(EncryptionService.hash('data'));
    expect(EncryptionService.generateRandomString(8)).toMatch(/^[0-9a-f]{16}$/);

    const signature = EncryptionService.generateHMAC('payload', 'secret');

    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(EncryptionService.verifyHMAC('payload', signature, 'secret')).toBe(true);
    expect(EncryptionService.verifyHMAC('payload', signature, 'other')).toBe(false);
    expect(EncryptionService.verifyHMAC('payload', 'abcd', 'secret')).toBe(false);
  });
});
