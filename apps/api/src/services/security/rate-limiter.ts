// Rate limiting service per tenant

import { getRedisClient } from '../queue/redis-client';

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
      console.error('[RateLimiter] Error checking rate limit:', error);
      
      // Fail open - allow request if Redis fails
      return {
        allowed: true,
        remaining: finalConfig.maxRequests,
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
      console.error('[RateLimiter] Error getting rate limit info:', error);
      
      return {
        remaining: finalConfig.maxRequests,
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
      console.error('[RateLimiter] Error resetting rate limit:', error);
    }
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
      const keys = await redis.keys(pattern);
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
      console.error('[RateLimiter] Error getting tenant rate limits:', error);
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
