/**
 * Lightweight Redis cache layer for expensive queries.
 *
 * Uses a dedicated Redis client (separate from BullMQ) with finite retry
 * limits so that cache failures never block request processing.
 *
 * If Redis is unreachable, the cache disables itself for 60 seconds
 * to avoid adding latency to every request.
 */

import Redis from 'ioredis';

let cacheClient: Redis | null = null;
let cacheDisabledUntil = 0;

type CacheMetaResult<T> = {
  value: T;
  hit: boolean;
  stale: boolean;
};

function isCacheDisabled(): boolean {
  return Date.now() < cacheDisabledUntil;
}

function disableCache(): void {
  cacheDisabledUntil = Date.now() + 60_000; // back off for 60 seconds
}

function getCacheClient(): Redis | null {
  if (isCacheDisabled()) return null;
  if (cacheClient) return cacheClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    cacheClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      commandTimeout: 500,
      connectTimeout: 1000,
      retryStrategy: (times) => {
        if (times > 1) {
          disableCache();
          return null;
        }
        return 200;
      },
      lazyConnect: true,
    });

    cacheClient.on('error', () => {
      disableCache();
    });

    return cacheClient;
  } catch {
    disableCache();
    return null;
  }
}

/**
 * Get a cached value or compute + store it.
 *
 * Cache errors are always swallowed — the fetch function runs as fallback.
 */
export async function getOrSet<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  const result = await getOrSetWithMeta(key, ttlSeconds, fetchFn);
  return result.value;
}

/**
 * Get a cached value with hit/miss metadata and basic stampede protection.
 */
export async function getOrSetWithMeta<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
  options?: {
    lockTtlMs?: number;
    waitMs?: number;
    staleTtlSeconds?: number;
  },
): Promise<CacheMetaResult<T>> {
  const client = getCacheClient();
  const staleKey = `${key}:stale`;
  if (client) {
    try {
      const cached = await client.get(key);
      if (cached !== null) {
        return { value: JSON.parse(cached) as T, hit: true, stale: false };
      }
    } catch {
      disableCache();
    }
  }

  if (!client || isCacheDisabled()) {
    return { value: await fetchFn(), hit: false, stale: false };
  }

  const lockKey = `${key}:lock`;
  const lockTtlMs = options?.lockTtlMs ?? 10_000;
  const waitMs = options?.waitMs ?? 150;
  let hasLock = false;

  try {
    const lockResult = await client.set(lockKey, '1', 'PX', lockTtlMs, 'NX');
    hasLock = lockResult === 'OK';

    if (!hasLock) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      const cachedAfterWait = await client.get(key);
      if (cachedAfterWait !== null) {
        return { value: JSON.parse(cachedAfterWait) as T, hit: true, stale: false };
      }

      const stale = await client.get(staleKey);
      if (stale !== null) {
        return { value: JSON.parse(stale) as T, hit: true, stale: true };
      }
    }

    const value = await fetchFn();
    const serialized = JSON.stringify(value);
    await client.set(key, serialized, 'EX', ttlSeconds);
    const staleTtlSeconds = options?.staleTtlSeconds ?? 0;
    if (staleTtlSeconds > ttlSeconds) {
      await client.set(staleKey, serialized, 'EX', staleTtlSeconds);
    }
    return { value, hit: false, stale: false };
  } catch {
    disableCache();
    return { value: await fetchFn(), hit: false, stale: false };
  } finally {
    if (hasLock) {
      try {
        await client.del(lockKey);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Invalidate a cached key (best-effort).
 */
export async function invalidateCache(key: string): Promise<void> {
  const client = getCacheClient();
  if (!client) return;
  try {
    await client.del(key);
  } catch {
    // ignore
  }
}

/**
 * Invalidate cached keys by prefix (best-effort, bounded SCAN).
 */
export async function invalidateCachePrefix(prefix: string): Promise<number> {
  const client = getCacheClient();
  if (!client) return 0;
  let cursor = '0';
  let deleted = 0;
  try {
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await client.del(...keys);
      }
    } while (cursor !== '0');
  } catch {
    return deleted;
  }
  return deleted;
}

/**
 * Build a deterministic cache key from parts.
 */
export function buildCacheKey(prefix: string, parts: Record<string, string | string[] | undefined | null>): string {
  const segments = Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}=${v.sort().join(',')}`;
      return `${k}=${v ?? ''}`;
    });
  return `dash:${prefix}:${segments.join(':')}`;
}
