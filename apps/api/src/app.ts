import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { trpcMiddleware } from './trpc/server';
import webhookRouter from './webhooks';
import { initSentry, log, LogLevel } from './services/observability';
import { checkRedisHealth } from './services/queue/redis-client';
import { applyObservabilityMiddleware } from './middleware/observability';
import { prisma } from '@dashboarduz/db';

dotenv.config();

if (process.env.SKIP_ENV_VALIDATION !== 'true') {
  try {
    const { validateAllFeatures } = require('./config/env-validator');
    validateAllFeatures();
    console.log('[Config] Environment variables validated successfully');
  } catch (error: any) {
    console.error('[Config] Environment validation failed:', error.message);
    process.exit(1);
  }
} else {
  console.log('[Config] Skipping environment validation (SKIP_ENV_VALIDATION=true)');
}

initSentry();
log(LogLevel.INFO, 'Queue workers are disabled in API process. Start worker service separately.');

const app = express();

applyObservabilityMiddleware(app);

const allowedOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    const normalizedOrigin = origin.replace(/\/+$/, '');
    if (allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS blocked'));
  },
  credentials: true,
}));

app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

app.get('/health', async (_req, res) => {
  try {
    const [redisHealth, dbHealth] = await Promise.all([
      checkRedisHealth(),
      prisma.$queryRaw`SELECT 1`,
    ]);
    const healthStatus = {
      status: redisHealth.status === 'healthy' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        api: 'healthy',
        redis: redisHealth,
        db: dbHealth ? 'healthy' : 'unhealthy',
      },
    };

    const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthStatus);
  } catch (error: any) {
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
    });
  }
});

app.get('/health/ready', async (_req, res) => {
  try {
    const [redisHealth, queueHealth] = await Promise.all([
      checkRedisHealth(),
      (async () => {
        const { queueService } = await import('./services/queue');
        return queueService.healthCheck();
      })(),
    ]);
    await prisma.$queryRaw`SELECT 1`;

    if (redisHealth.status !== 'healthy' || queueHealth.status === 'unhealthy') {
      return res.status(503).json({
        status: 'not_ready',
        redis: redisHealth,
        queues: queueHealth,
      });
    }

    return res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      redis: redisHealth,
      queues: queueHealth,
    });
  } catch (error: any) {
    return res.status(503).json({
      status: 'not_ready',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/health/queues', async (_req, res) => {
  try {
    const { queueService } = await import('./services/queue');
    const health = await queueService.healthCheck();
    res.json(health);
  } catch (error: any) {
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

app.use('/webhooks', webhookRouter);

try {
  const amocrmRouter = require('./routes/integrations/amocrm').default;
  app.use('/api/integrations/amocrm', amocrmRouter);
  console.log('[Config] AmoCRM routes registered');
} catch (error: any) {
  console.error('[Config] Failed to register AmoCRM routes:', error.message);
}

app.use('/api/trpc', trpcMiddleware);

app.get('/api', (_req, res) => {
  res.json({ message: 'Dashboarduz API v1', trpc: '/api/trpc', webhooks: '/webhooks' });
});

export default app;
