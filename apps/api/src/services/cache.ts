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
  const client = getCacheClient();

  if (client) {
    try {
      const cached = await client.get(key);
      if (cached !== null) {
        return JSON.parse(cached) as T;
      }
    } catch {
      disableCache();
    }
  }

  const result = await fetchFn();

  if (client && !isCacheDisabled()) {
    try {
      await client.set(key, JSON.stringify(result), 'EX', ttlSeconds);
    } catch {
      disableCache();
    }
  }

  return result;
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
