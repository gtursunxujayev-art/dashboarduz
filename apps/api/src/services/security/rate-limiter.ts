// Rate limiting service per tenant

import { getRedisClient } from '../queue/redis-client';
import { logger } from '../../lib/logger';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyPrefix: string; // Redis key prefix
}

export class RateLimiter {
  private defaultConfig: RateLimitConfig = {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100, // 100 requests per minute
    keyPrefix: 'rate_limit',
  };

  // Per-process in-memory fallback used only when Redis is unreachable.
  // Sliding window of timestamps keyed by `${prefix}:${tenantId}:${endpoint}`.
  private memoryWindow: Map<string, number[]> = new Map();
  private lastFallbackWarnAt = 0;

  private warnFallback(error: unknown, op: string): void {
    const now = Date.now();
    if (now - this.lastFallbackWarnAt > 60_000) {
      this.lastFallbackWarnAt = now;
      logger.warn({ err: error, op }, 'RateLimiter: Redis unavailable, using in-memory fallback');
    }
  }

  private memoryCheck(
    key: string,
    now: number,
    finalConfig: RateLimitConfig,
  ): { count: number } {
    const windowStart = now - finalConfig.windowMs;
    const existing = this.memoryWindow.get(key) || [];
    // Drop entries outside the window
    const trimmed = existing.filter((ts) => ts > windowStart);
    trimmed.push(now);
    this.memoryWindow.set(key, trimmed);
    // Opportunistic cleanup: cap memory usage
    if (this.memoryWindow.size > 10_000) {
      for (const [k, v] of this.memoryWindow) {
        if (v.length === 0 || v[v.length - 1]! < windowStart) {
          this.memoryWindow.delete(k);
        }
      }
    }
    return { count: trimmed.length };
  }

  private memoryInfo(
    key: string,
    now: number,
    finalConfig: RateLimitConfig,
  ): { count: number } {
    const windowStart = now - finalConfig.windowMs;
    const existing = this.memoryWindow.get(key) || [];
    const trimmed = existing.filter((ts) => ts > windowStart);
    if (trimmed.length !== existing.length) {
      this.memoryWindow.set(key, trimmed);
    }
    return { count: trimmed.length };
  }

  // Check if request is allowed
  async isAllowed(
    tenantId: string,
    endpoint: string,
    config?: Partial<RateLimitConfig>
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
    limit: number;
  }> {
    const redis = getRedisClient();
    const finalConfig = { ...this.defaultConfig, ...config };
    
    const key = `${finalConfig.keyPrefix}:${tenantId}:${endpoint}`;
    const now = Date.now();
    const windowStart = now - finalConfig.windowMs;

    try {
      // Use Redis sorted set for sliding window rate limiting
      const pipeline = redis.pipeline();
      
      // Remove old entries
      pipeline.zremrangebyscore(key, 0, windowStart);
      
      // Add current request
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      
      // Set expiry on the key
      pipeline.expire(key, Math.ceil(finalConfig.windowMs / 1000) + 1);
      
      // Get count of requests in window
      pipeline.zcard(key);
      
      const results = await pipeline.exec();
      
      if (!results) {
        throw new Error('Redis pipeline execution failed');
      }
      
      const requestCount = Number(results[3]?.[1] ?? 0);
      const remaining = Math.max(0, finalConfig.maxRequests - requestCount);
      const resetTime = now + finalConfig.windowMs;
      
      return {
        allowed: requestCount <= finalConfig.maxRequests,
        remaining,
        resetTime,
        limit: finalConfig.maxRequests,
      };
    } catch (error: any) {
      this.warnFallback(error, 'isAllowed');

      // Redis unavailable: use per-process in-memory sliding window so we still throttle.
      const { count } = this.memoryCheck(key, now, finalConfig);
      const remaining = Math.max(0, finalConfig.maxRequests - count);
      return {
        allowed: count <= finalConfig.maxRequests,
        remaining,
        resetTime: now + finalConfig.windowMs,
        limit: finalConfig.maxRequests,
      };
    }
  }

  // Get rate limit info without consuming a request
  async getRateLimitInfo(
    tenantId: string,
    endpoint: string,
    config?: Partial<RateLimitConfig>
  ): Promise<{
    remaining: number;
    resetTime: number;
    limit: number;
  }> {
    const redis = getRedisClient();
    const finalConfig = { ...this.defaultConfig, ...config };
    
    const key = `${finalConfig.keyPrefix}:${tenantId}:${endpoint}`;
    const now = Date.now();
    const windowStart = now - finalConfig.windowMs;

    try {
      // Remove old entries
      await redis.zremrangebyscore(key, 0, windowStart);
      
      // Get count of requests in window
      const requestCount = await redis.zcard(key);
      const remaining = Math.max(0, finalConfig.maxRequests - requestCount);
      const resetTime = now + finalConfig.windowMs;
      
      return {
        remaining,
        resetTime,
        limit: finalConfig.maxRequests,
      };
    } catch (error: any) {
      this.warnFallback(error, 'getRateLimitInfo');

      const { count } = this.memoryInfo(key, now, finalConfig);
      const remaining = Math.max(0, finalConfig.maxRequests - count);
      return {
        remaining,
        resetTime: now + finalConfig.windowMs,
        limit: finalConfig.maxRequests,
      };
    }
  }

  // Reset rate limit for a tenant and endpoint
  async resetRateLimit(
    tenantId: string,
    endpoint: string,
    config?: Partial<RateLimitConfig>
  ): Promise<void> {
    const redis = getRedisClient();
    const finalConfig = { ...this.defaultConfig, ...config };
    
    const key = `${finalConfig.keyPrefix}:${tenantId}:${endpoint}`;
    
    try {
      await redis.del(key);
    } catch (error: any) {
      this.warnFallback(error, 'resetRateLimit');
    }
    // Also clear any in-memory fallback entry for the same key.
    this.memoryWindow.delete(key);
  }

  // Get all rate limit keys for a tenant (for admin purposes)
  async getTenantRateLimits(tenantId: string): Promise<Array<{
    endpoint: string;
    remaining: number;
    limit: number;
    resetTime: number;
  }>> {
    const redis = getRedisClient();
    const pattern = `${this.defaultConfig.keyPrefix}:${tenantId}:*`;
    
    try {
      // Use cursor-based SCAN instead of KEYS to avoid blocking Redis on large key spaces.
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== '0');

      const results = [];
      for (const key of keys) {
        const endpoint = key.split(':').pop() || 'unknown';
        const info = await this.getRateLimitInfo(tenantId, endpoint);

        results.push({
          endpoint,
          remaining: info.remaining,
          limit: info.limit,
          resetTime: info.resetTime,
        });
      }

      return results;
    } catch (error: any) {
      this.warnFallback(error, 'getTenantRateLimits');
      return [];
    }
  }

  // Apply different rate limits based on tenant plan
  getPlanConfig(plan: string): Partial<RateLimitConfig> {
    switch (plan.toLowerCase()) {
      case 'enterprise':
        return {
          maxRequests: 1000,
          windowMs: 60 * 1000, // 1 minute
        };
      case 'pro':
        return {
          maxRequests: 500,
          windowMs: 60 * 1000,
        };
      case 'free':
      default:
        return {
          maxRequests: 100,
          windowMs: 60 * 1000,
        };
    }
  }

  // Middleware for Express/trpc
  async middleware(
    tenantId: string,
    endpoint: string,
    plan: string = 'free'
  ): Promise<{
    allowed: boolean;
    headers?: Record<string, string>;
    error?: string;
  }> {
    const planConfig = this.getPlanConfig(plan);
    const result = await this.isAllowed(tenantId, endpoint, planConfig);
    
    const headers = {
      'X-RateLimit-Limit': result.limit.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000).toString(),
    };
    
    if (!result.allowed) {
      return {
        allowed: false,
        headers,
        error: 'Rate limit exceeded',
      };
    }
    
    return {
      allowed: true,
      headers,
    };
  }

  // Health check
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    error?: string;
  }> {
    try {
      const testKey = 'health_check:test';
      const redis = getRedisClient();
      
      // Test Redis connection and basic operations
      await redis.set(testKey, 'test', 'EX', 1);
      const value = await redis.get(testKey);
      
      if (value !== 'test') {
        return {
          status: 'unhealthy',
          error: 'Redis test failed',
        };
      }
      
      return { status: 'healthy' };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        error: error.message,
      };
    }
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

// Rate limit middleware for tRPC
export function createRateLimitMiddleware(planResolver?: (ctx: any) => string) {
  return async (opts: any) => {
    const { ctx, path } = opts;
    
    if (!ctx.tenantId) {
      return opts.next();
    }
    
    const plan = planResolver ? planResolver(ctx) : 'free';
    const endpoint = path.replace(/\./g, ':');
    
    const result = await rateLimiter.middleware(ctx.tenantId, endpoint, plan);
    
    if (!result.allowed) {
      throw new Error(result.error || 'Rate limit exceeded');
    }
    
    // Add rate limit headers to response
    if (result.headers && ctx.res) {
      Object.entries(result.headers).forEach(([key, value]) => {
        ctx.res.setHeader(key, value);
      });
    }
    
    return opts.next();
  };
}
