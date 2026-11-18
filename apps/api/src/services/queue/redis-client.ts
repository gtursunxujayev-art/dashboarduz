// Redis client configuration for BullMQ

import Redis from 'ioredis';

import { errorMessage } from '../../lib/errors';
import { logger } from '../../lib/logger';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = new Redis(redisUrl, {
      // BullMQ workers require this to be null for blocking commands.
      maxRetriesPerRequest: null,
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
      logger.info('[Redis] Connected to Redis server');
    });

    redisClient.on('error', (error) => {
      logger.error({ err: error }, '[Redis] Redis error:');
    });

    redisClient.on('close', () => {
      logger.info('[Redis] Redis connection closed');
    });

    redisClient.on('reconnecting', () => {
      logger.info('[Redis] Reconnecting to Redis...');
    });
  }

  return redisClient;
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
  } catch (error: unknown) {
    return {
      status: 'unhealthy',
      error: errorMessage(error),
    };
  }
}
