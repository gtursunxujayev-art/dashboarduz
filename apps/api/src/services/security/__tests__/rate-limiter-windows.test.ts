import { logger } from '../../../lib/logger';
import { RateLimiter } from '../rate-limiter';

type SortedEntry = { score: number; member: string };

/** An in-memory stand-in for the few ioredis commands the rate limiter uses. */
class FakeRedis {
  sets = new Map<string, SortedEntry[]>();
  strings = new Map<string, string>();
  expiries = new Map<string, number>();
  down = false;
  pipelineReturnsNull = false;
  scanPageSize = 2;
  getOverride: string | null = null;

  private guard(): void {
    if (this.down) {
      throw new Error('connect ECONNREFUSED');
    }
  }

  zremrangebyscoreSync(key: string, min: number, max: number): number {
    const entries = this.sets.get(key) ?? [];
    const kept = entries.filter((entry) => entry.score < min || entry.score > max);

    this.sets.set(key, kept);

    return entries.length - kept.length;
  }

  zaddSync(key: string, score: number, member: string): number {
    const entries = this.sets.get(key) ?? [];

    entries.push({ score, member });
    this.sets.set(key, entries);

    return 1;
  }

  zcardSync(key: string): number {
    return (this.sets.get(key) ?? []).length;
  }

  pipeline() {
    const ops: Array<() => unknown> = [];
    const chain = {
      zremrangebyscore: (key: string, min: number, max: number) => {
        ops.push(() => this.zremrangebyscoreSync(key, min, max));

        return chain;
      },
      zadd: (key: string, score: number, member: string) => {
        ops.push(() => this.zaddSync(key, score, member));

        return chain;
      },
      expire: (key: string, seconds: number) => {
        ops.push(() => {
          this.expiries.set(key, seconds);

          return 1;
        });

        return chain;
      },
      zcard: (key: string) => {
        ops.push(() => this.zcardSync(key));

        return chain;
      },
      exec: (): Promise<Array<[Error | null, unknown]> | null> => {
        if (this.down) {
          return Promise.reject(new Error('connect ECONNREFUSED'));
        }
        if (this.pipelineReturnsNull) {
          return Promise.resolve(null);
        }

        return Promise.resolve(ops.map((op): [Error | null, unknown] => [null, op()]));
      },
    };

    return chain;
  }

  zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    this.guard();

    return Promise.resolve(this.zremrangebyscoreSync(key, min, max));
  }

  zcard(key: string): Promise<number> {
    this.guard();

    return Promise.resolve(this.zcardSync(key));
  }

  del(key: string): Promise<number> {
    this.guard();
    const existed = this.sets.delete(key);

    return Promise.resolve(existed ? 1 : 0);
  }

  scan(cursor: string, _match: 'MATCH', pattern: string, _count: 'COUNT', _size: number): Promise<[string, string[]]> {
    this.guard();
    const prefix = pattern.replace(/\*$/, '');
    const keys = [...this.sets.keys()].filter((key) => key.startsWith(prefix)).sort();
    const start = Number(cursor);
    const batch = keys.slice(start, start + this.scanPageSize);
    const next = start + this.scanPageSize >= keys.length ? '0' : String(start + this.scanPageSize);

    return Promise.resolve([next, batch]);
  }

  set(key: string, value: string, _ex: 'EX', seconds: number): Promise<'OK'> {
    this.guard();
    this.strings.set(key, value);
    this.expiries.set(key, seconds);

    return Promise.resolve('OK');
  }

  get(key: string): Promise<string | null> {
    this.guard();

    return Promise.resolve(this.getOverride ?? this.strings.get(key) ?? null);
  }
}

const mockRedis = new FakeRedis();

jest.mock('../../queue/redis-client', () => ({
  getRedisClient: () => mockRedis,
}));

const NOW = 1_700_000_000_000;

describe('RateLimiter (sliding window over a Redis sorted set)', () => {
  let now = NOW;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    mockRedis.sets.clear();
    mockRedis.strings.clear();
    mockRedis.expiries.clear();
    mockRedis.down = false;
    mockRedis.pipelineReturnsNull = false;
    mockRedis.getOverride = null;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows maxRequests calls in a window, then blocks, with remaining, resetTime and limit', async () => {
    const limiter = new RateLimiter();
    const config = { maxRequests: 3, windowMs: 10_000 };

    const first = await limiter.isAllowed('t1', 'auth:login', config);

    expect(first).toEqual({ allowed: true, remaining: 2, resetTime: NOW + 10_000, limit: 3 });
    expect((await limiter.isAllowed('t1', 'auth:login', config)).remaining).toBe(1);
    expect(await limiter.isAllowed('t1', 'auth:login', config)).toEqual({ allowed: true, remaining: 0, resetTime: NOW + 10_000, limit: 3 });
    expect(await limiter.isAllowed('t1', 'auth:login', config)).toEqual({ allowed: false, remaining: 0, resetTime: NOW + 10_000, limit: 3 });

    // Every call is recorded, blocked ones too.
    expect(mockRedis.zcardSync('rate_limit:t1:auth:login')).toBe(4);
    expect(mockRedis.sets.get('rate_limit:t1:auth:login')?.[0]).toEqual({ score: NOW, member: `${NOW}-0.5` });
  });

  it('uses the key prefix, tenant and endpoint as the key and expires it one second after the window', async () => {
    const limiter = new RateLimiter();

    await limiter.isAllowed('tenant-a', 'webhook', { keyPrefix: 'password-register', windowMs: 15 * 60 * 1000 });
    await limiter.isAllowed('tenant-a', 'webhook', { windowMs: 1500 });

    expect(mockRedis.expiries.get('password-register:tenant-a:webhook')).toBe(901);
    expect(mockRedis.expiries.get('rate_limit:tenant-a:webhook')).toBe(3);
  });

  it('drops requests older than the window, so a blocked caller is allowed again later', async () => {
    const limiter = new RateLimiter();
    const config = { maxRequests: 2, windowMs: 1000 };

    await limiter.isAllowed('t1', 'e', config);
    now += 400;
    await limiter.isAllowed('t1', 'e', config);
    now += 100;
    expect((await limiter.isAllowed('t1', 'e', config)).allowed).toBe(false);

    // At NOW + 1000 the first request (score NOW) is exactly at the window start and is removed.
    now = NOW + 1000;
    const result = await limiter.isAllowed('t1', 'e', config);

    expect(result.allowed).toBe(false);
    expect(mockRedis.zcardSync('rate_limit:t1:e')).toBe(3);

    now = NOW + 1501;
    expect(await limiter.isAllowed('t1', 'e', config)).toEqual({ allowed: true, remaining: 0, resetTime: NOW + 2501, limit: 2 });
  });

  it('keeps tenants and endpoints apart', async () => {
    const limiter = new RateLimiter();
    const config = { maxRequests: 1 };

    expect((await limiter.isAllowed('t1', 'a', config)).allowed).toBe(true);
    expect((await limiter.isAllowed('t1', 'a', config)).allowed).toBe(false);
    expect((await limiter.isAllowed('t2', 'a', config)).allowed).toBe(true);
    expect((await limiter.isAllowed('t1', 'b', config)).allowed).toBe(true);
  });

  it('falls back to an in-memory window when Redis is down, and warns at most once a minute', async () => {
    const limiter = new RateLimiter();
    const config = { maxRequests: 2, windowMs: 5000 };

    mockRedis.down = true;

    expect(await limiter.isAllowed('t1', 'e', config)).toEqual({ allowed: true, remaining: 1, resetTime: NOW + 5000, limit: 2 });
    expect(await limiter.isAllowed('t1', 'e', config)).toEqual({ allowed: true, remaining: 0, resetTime: NOW + 5000, limit: 2 });
    expect((await limiter.isAllowed('t1', 'e', config)).allowed).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[1]).toBe('RateLimiter: Redis unavailable, using in-memory fallback');

    // The memory window slides as well.
    now = NOW + 5001;
    expect((await limiter.isAllowed('t1', 'e', config)).allowed).toBe(true);

    now = NOW + 60_001;
    await limiter.isAllowed('t1', 'e', config);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('treats an empty pipeline result as a Redis failure', async () => {
    const limiter = new RateLimiter();

    mockRedis.pipelineReturnsNull = true;

    expect(await limiter.isAllowed('t1', 'e', { maxRequests: 1 })).toEqual({ allowed: true, remaining: 0, resetTime: NOW + 60_000, limit: 1 });
    expect((await limiter.isAllowed('t1', 'e', { maxRequests: 1 })).allowed).toBe(false);
    expect(warnSpy.mock.calls[0]?.[0]).toMatchObject({ op: 'isAllowed' });
  });

  it('reports the window without consuming a request', async () => {
    const limiter = new RateLimiter();
    const config = { maxRequests: 5, windowMs: 1000 };

    await limiter.isAllowed('t1', 'e', config);
    await limiter.isAllowed('t1', 'e', config);

    expect(await limiter.getRateLimitInfo('t1', 'e', config)).toEqual({ remaining: 3, resetTime: NOW + 1000, limit: 5 });
    expect(await limiter.getRateLimitInfo('t1', 'e', config)).toEqual({ remaining: 3, resetTime: NOW + 1000, limit: 5 });

    now = NOW + 1000;
    expect((await limiter.getRateLimitInfo('t1', 'e', config)).remaining).toBe(5);
  });

  it('reads the in-memory window for info when Redis is down', async () => {
    const limiter = new RateLimiter();
    const config = { maxRequests: 4, windowMs: 1000 };

    mockRedis.down = true;
    await limiter.isAllowed('t1', 'e', config);

    expect(await limiter.getRateLimitInfo('t1', 'e', config)).toEqual({ remaining: 3, resetTime: NOW + 1000, limit: 4 });
    now = NOW + 1000;
    expect((await limiter.getRateLimitInfo('t1', 'e', config)).remaining).toBe(4);
  });

  it('resets both the Redis key and the in-memory entry', async () => {
    const limiter = new RateLimiter();
    const config = { maxRequests: 1 };

    await limiter.isAllowed('t1', 'e', config);
    await limiter.resetRateLimit('t1', 'e', config);
    expect(mockRedis.sets.has('rate_limit:t1:e')).toBe(false);
    expect((await limiter.isAllowed('t1', 'e', config)).allowed).toBe(true);

    mockRedis.down = true;
    await limiter.isAllowed('t1', 'e', config);
    expect((await limiter.isAllowed('t1', 'e', config)).allowed).toBe(false);
    await limiter.resetRateLimit('t1', 'e', config);
    expect((await limiter.isAllowed('t1', 'e', config)).allowed).toBe(true);
  });

  it('lists a tenant\'s endpoints across scan pages with the default limits', async () => {
    const limiter = new RateLimiter();

    await limiter.isAllowed('t1', 'alpha');
    await limiter.isAllowed('t1', 'beta');
    await limiter.isAllowed('t1', 'beta');
    await limiter.isAllowed('t1', 'gamma');
    await limiter.isAllowed('t2', 'alpha');

    expect(await limiter.getTenantRateLimits('t1')).toEqual([
      { endpoint: 'alpha', remaining: 99, limit: 100, resetTime: NOW + 60_000 },
      { endpoint: 'beta', remaining: 98, limit: 100, resetTime: NOW + 60_000 },
      { endpoint: 'gamma', remaining: 99, limit: 100, resetTime: NOW + 60_000 },
    ]);

    mockRedis.down = true;
    expect(await limiter.getTenantRateLimits('t1')).toEqual([]);
  });

  it('maps plans to limits, unknown plans to the free one', () => {
    const limiter = new RateLimiter();

    expect(limiter.getPlanConfig('Enterprise')).toEqual({ maxRequests: 1000, windowMs: 60_000 });
    expect(limiter.getPlanConfig('pro')).toEqual({ maxRequests: 500, windowMs: 60_000 });
    expect(limiter.getPlanConfig('free')).toEqual({ maxRequests: 100, windowMs: 60_000 });
    expect(limiter.getPlanConfig('legacy')).toEqual({ maxRequests: 100, windowMs: 60_000 });
  });

  it('returns rate-limit headers, and an error once the plan limit is exceeded', async () => {
    const limiter = new RateLimiter();

    for (let index = 0; index < 499; index += 1) {
      await limiter.isAllowed('t1', 'api', limiter.getPlanConfig('pro'));
    }

    expect(await limiter.middleware('t1', 'api', 'pro')).toEqual({
      allowed: true,
      headers: {
        'X-RateLimit-Limit': '500',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil((NOW + 60_000) / 1000)),
      },
    });
    expect(await limiter.middleware('t1', 'api', 'pro')).toEqual({
      allowed: false,
      headers: {
        'X-RateLimit-Limit': '500',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil((NOW + 60_000) / 1000)),
      },
      error: 'Rate limit exceeded',
    });
  });

  it('health-checks Redis with a set/get round trip', async () => {
    const limiter = new RateLimiter();

    expect(await limiter.healthCheck()).toEqual({ status: 'healthy' });
    expect(mockRedis.expiries.get('health_check:test')).toBe(1);

    mockRedis.getOverride = 'other';
    expect(await limiter.healthCheck()).toEqual({ status: 'unhealthy', error: 'Redis test failed' });

    mockRedis.down = true;
    expect(await limiter.healthCheck()).toEqual({ status: 'unhealthy', error: 'connect ECONNREFUSED' });
  });
});
