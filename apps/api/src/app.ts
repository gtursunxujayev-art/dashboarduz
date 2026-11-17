import { systemPrisma } from '@dashboarduz/db';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';

import { logger } from './lib/logger';
import { applyObservabilityMiddleware } from './middleware/observability';
import { startAmoCallsSyncScheduler, stopAmoCallsSyncScheduler } from './services/integrations/amocrm-call-sync';
import { startAmoLeadSnapshotScheduler, stopAmoLeadSnapshotScheduler } from './services/integrations/amocrm-lead-snapshot';
import { initSentry } from './services/observability';
import { checkRedisHealth } from './services/queue/redis-client';
import { startTelegramAgentPerformanceScheduler, stopTelegramAgentPerformanceScheduler } from './services/reports/telegram-agent-performance-scheduler';
import { startTelegramGroupSummaryScheduler, stopTelegramGroupSummaryScheduler } from './services/reports/telegram-group-summary-scheduler';
import { startTelegramReportScheduler, stopTelegramReportScheduler } from './services/reports/telegram-report-scheduler';
import { trpcMiddleware } from './trpc/server';
import webhookRouter from './webhooks';

dotenv.config();

if (process.env.SKIP_ENV_VALIDATION !== 'true') {
  try {
    const { validateAllFeatures } = require('./config/env-validator');

    validateAllFeatures();
    logger.info('[Config] Environment variables validated successfully');
  } catch (error: any) {
    logger.error({ error: (error as Error).message }, '[Config] Environment validation failed:');
    process.exit(1);
  }
} else {
  logger.info('[Config] Skipping environment validation (SKIP_ENV_VALIDATION=true)');
}

initSentry();
const parseBooleanEnv = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const schedulerEnabledInApi = parseBooleanEnv(
  process.env.ENABLE_SCHEDULERS_IN_API,
  false,
);

if (schedulerEnabledInApi) {
  startTelegramReportScheduler();
  startTelegramAgentPerformanceScheduler();
  startTelegramGroupSummaryScheduler();
  startAmoCallsSyncScheduler();
  startAmoLeadSnapshotScheduler();
  logger.info({
    mode: 'api',
    env: process.env.NODE_ENV || 'unknown',
  }, 'Report schedulers are enabled in API process');
} else {
  logger.info({
    mode: 'worker_only',
  }, 'Queue workers are disabled in API process. Start worker service separately.');
}

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
  limit: process.env.JSON_BODY_LIMIT || '10mb',
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

app.use(express.urlencoded({
  extended: true,
  limit: process.env.JSON_BODY_LIMIT || '10mb',
  verify: (req: any, _res, buf) => {
    if (!req.rawBody) {
      req.rawBody = buf.toString('utf8');
    }
  },
}));

app.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Request payload is too large. Split the upload into smaller batches.',
    });
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({
      error: 'Invalid JSON payload.',
    });
  }

  return next(error);
});

app.get('/health', async (_req, res) => {
  try {
    const [redisHealth, dbHealth] = await Promise.all([
      checkRedisHealth(),
      systemPrisma.$queryRaw`SELECT 1`,
    ]);
    const healthStatus = {
      status: redisHealth.status === 'healthy' ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        api: 'healthy',
        redis: redisHealth,
        db: dbHealth ? 'healthy' : 'unhealthy',
        schedulers: schedulerEnabledInApi ? 'enabled_in_api' : 'worker_only',
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

    await systemPrisma.$queryRaw`SELECT 1`;

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

app.get('/health/schedulers', async (_req, res) => {
  return res.json({
    status: 'ok',
    schedulersEnabledInApi: schedulerEnabledInApi,
    mode: schedulerEnabledInApi ? 'api' : 'worker_only',
    timestamp: new Date().toISOString(),
  });
});

app.use('/webhooks', webhookRouter);

app.use('/api/trpc', trpcMiddleware);

app.get('/api', (_req, res) => {
  res.json({ message: 'Dashboarduz API v1', trpc: '/api/trpc', webhooks: '/webhooks' });
});

function stopSchedulersInApi(): void {
  if (!schedulerEnabledInApi) {
    return;
  }
  stopTelegramAgentPerformanceScheduler();
  stopTelegramGroupSummaryScheduler();
  stopAmoCallsSyncScheduler();
  stopAmoLeadSnapshotScheduler();
  stopTelegramReportScheduler();
}

process.on('SIGTERM', stopSchedulersInApi);
process.on('SIGINT', stopSchedulersInApi);

export default app;
