// Redis client configuration for BullMQ

import Redis from 'ioredis';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
    });

    // Event listeners for monitoring
    redisClient.on('connect', () => {
      console.log('[Redis] Connected to Redis server');
    });

    redisClient.on('error', (error) => {
      console.error('[Redis] Redis error:', error);
    });

    redisClient.on('close', () => {
      console.log('[Redis] Redis connection closed');
    });

    redisClient.on('reconnecting', () => {
      console.log('[Redis] Reconnecting to Redis...');
    });
  }

  return redisClient;
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('[Redis] Redis client closed');
  }
}

// Health check
export async function checkRedisHealth(): Promise<{
  status: 'healthy' | 'unhealthy';
  latency?: number;
  error?: string;
}> {
  try {
    const start = Date.now();
    const client = getRedisClient();
    await client.ping();
    const latency = Date.now() - start;

    return {
      status: 'healthy',
      latency,
    };
  } catch (error: any) {
    return {
      status: 'unhealthy',
      error: error.message,
    };
  }
}
