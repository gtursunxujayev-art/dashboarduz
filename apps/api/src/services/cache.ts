/**
 * Lightweight Redis cache layer for expensive queries.
 *
 * Uses a dedicated Redis client (separate from BullMQ) with finite retry
 * limits so that cache failures never block request processing.
 */

import Redis from 'ioredis';

let cacheClient: Redis | null = null;

function getCacheClient(): Redis | null {
  if (cacheClient) return cacheClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    cacheClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      commandTimeout: 2000,
      connectTimeout: 3000,
      retryStrategy: (times) => {
        if (times > 3) return null; // stop retrying
        return Math.min(times * 100, 1000);
      },
      lazyConnect: true,
    });

    cacheClient.on('error', () => {
      // swallow — cache errors must not crash the process
    });

    return cacheClient;
  } catch {
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
      // cache read failed — fall through to fetch
    }
  }

  const result = await fetchFn();

  if (client) {
    try {
      await client.set(key, JSON.stringify(result), 'EX', ttlSeconds);
    } catch {
      // cache write failed — ignore
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
