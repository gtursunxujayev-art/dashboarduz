import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { trpcMiddleware } from './trpc/server';
import webhookRouter from './webhooks';
import { initSentry, log, LogLevel } from './services/observability';
import { checkRedisHealth } from './services/queue/redis-client';
import { applyObservabilityMiddleware } from './middleware/observability';
import { prisma } from '@dashboarduz/db';
import { decryptIntegrationTokens } from './services/security/encryption';
import { telegramService } from './services/integrations/telegram';

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

function parseTelegramGroupIds(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  return Array.from(
    new Set(
      rawValue
        .split(/[,\n;]+/g)
        .map((value) => value.replace(/^['"`]+|['"`]+$/g, '').trim())
        .map((value) => value.replace(/\s+/g, ''))
        .filter(Boolean),
    ),
  );
}

function isTelegramDebugAuthorized(req: express.Request): boolean {
  const configuredKey = (process.env.TELEGRAM_DEBUG_KEY || '').trim();
  if (!configuredKey) {
    return process.env.NODE_ENV !== 'production';
  }

  const queryKey = typeof req.query.key === 'string' ? req.query.key : '';
  const headerKey = typeof req.headers['x-debug-key'] === 'string' ? req.headers['x-debug-key'] : '';
  const bodyKey = typeof req.body?.key === 'string' ? req.body.key : '';
  const providedKey = String(queryKey || headerKey || bodyKey || '').trim();
  return providedKey.length > 0 && providedKey === configuredKey;
}

async function resolveTelegramDebugContext(req: express.Request): Promise<{
  tenantId: string | null;
  botToken: string | null;
  tokenSource: 'integration' | 'env' | 'none';
  groupIds: string[];
}> {
  const queryTenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId.trim() : '';
  const bodyTenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
  const tenantId = queryTenantId || bodyTenantId || null;

  const queryGroupId = typeof req.query.group_id === 'string' ? req.query.group_id.trim() : '';
  const bodyGroupId = typeof req.body?.group_id === 'string' ? req.body.group_id.trim() : '';
  const explicitGroups = parseTelegramGroupIds(queryGroupId || bodyGroupId || undefined);
  const envGroups = Array.from(
    new Set([
      ...parseTelegramGroupIds(process.env.OFLINE_GROUP_ID),
      ...parseTelegramGroupIds(process.env.OFFLINE_GROUP_ID),
      ...parseTelegramGroupIds(process.env.OFLINE_GROUP_IDS),
      ...parseTelegramGroupIds(process.env.OFFLINE_GROUP_IDS),
      ...parseTelegramGroupIds(process.env.ONLINE_GROUP_ID),
      ...parseTelegramGroupIds(process.env.ONLINE_GROUP_IDS),
      ...parseTelegramGroupIds(process.env.PAYMENT_RETURN_GROUP_ID),
      ...parseTelegramGroupIds(process.env.PAYMENT_RETURN_GROUP_IDS),
      ...parseTelegramGroupIds(process.env.REFUND_GROUP_ID),
      ...parseTelegramGroupIds(process.env.REFUND_GROUP_IDS),
      ...parseTelegramGroupIds(process.env.RETURN_GROUP_ID),
      ...parseTelegramGroupIds(process.env.RETURN_GROUP_IDS),
      ...parseTelegramGroupIds(process.env.KORPORATIV_GROUP_ID),
      ...parseTelegramGroupIds(process.env.KORPORATIV_GROUP_IDS),
      ...parseTelegramGroupIds(process.env.CORPORATE_GROUP_ID),
      ...parseTelegramGroupIds(process.env.CORPORATE_GROUP_IDS),
      ...parseTelegramGroupIds(process.env.CORPORATE_CALL_GROUP_ID),
      ...parseTelegramGroupIds(process.env.CORPORATE_CALL_GROUP_IDS),
    ]),
  );
  const groupIds = explicitGroups.length > 0 ? explicitGroups : envGroups;

  const envToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim() || null;

  const integration = await prisma.integration.findFirst({
    where: {
      ...(tenantId ? { tenantId } : {}),
      type: 'telegram',
      status: 'active',
      tokensEncrypted: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      tenantId: true,
      tokensEncrypted: true,
    },
  });

  let integrationToken: string | null = null;
  if (integration?.tokensEncrypted) {
    try {
      const tokens = decryptIntegrationTokens<{ botToken?: string; token?: string }>(integration.tokensEncrypted);
      integrationToken = String(tokens.botToken || tokens.token || '').trim() || null;
    } catch (_error) {
      integrationToken = null;
    }
  }

  if (integrationToken) {
    return {
      tenantId: integration?.tenantId || tenantId,
      botToken: integrationToken,
      tokenSource: 'integration',
      groupIds,
    };
  }

  if (envToken) {
    return {
      tenantId: integration?.tenantId || tenantId,
      botToken: envToken,
      tokenSource: 'env',
      groupIds,
    };
  }

  return {
    tenantId: integration?.tenantId || tenantId,
    botToken: null,
    tokenSource: 'none',
    groupIds,
  };
}

app.get('/debug/telegram', async (req, res) => {
  if (!isTelegramDebugAuthorized(req)) {
    return res.status(403).json({
      ok: false,
      error: 'Forbidden. Provide TELEGRAM_DEBUG_KEY via ?key=... or x-debug-key header.',
    });
  }

  const context = await resolveTelegramDebugContext(req);
  const responseBody: Record<string, unknown> = {
    ok: true,
    endpoint: '/debug/telegram',
    mode: 'inspect',
    tenantId: context.tenantId,
    groupIds: context.groupIds,
  };
  if (context.botToken) {
    responseBody.hasBotToken = true;
  }
  return res.json(responseBody);
});

app.post('/debug/telegram', async (req, res) => {
  if (!isTelegramDebugAuthorized(req)) {
    return res.status(403).json({
      ok: false,
      error: 'Forbidden. Provide TELEGRAM_DEBUG_KEY via body/query/header.',
    });
  }

  try {
    const context = await resolveTelegramDebugContext(req);
    if (!context.botToken) {
      return res.status(400).json({
        ok: false,
        error: 'Telegram bot token not found. Connect Telegram integration or set TELEGRAM_BOT_TOKEN.',
      });
    }

    if (!context.groupIds.length) {
      return res.status(400).json({
        ok: false,
        error: 'Group id not found. Set OFFLINE/ONLINE/REFUND/KORPORATIV group env ids or pass group_id in request.',
      });
    }

    const text = String(req.body?.text || '').trim() || `[DEBUG] Telegram test OK ${new Date().toISOString()}`;
    const results: Array<{ groupId: string; ok: boolean; error?: string }> = [];

    for (const groupId of context.groupIds) {
      try {
        await telegramService.sendMessage(context.botToken, groupId, text, {
          disable_web_page_preview: true,
        });
        results.push({ groupId, ok: true });
      } catch (error: any) {
        results.push({
          groupId,
          ok: false,
          error: String(error?.message || error),
        });
      }
    }

    const deliveredCount = results.filter((item) => item.ok).length;
    const failedCount = results.length - deliveredCount;

    return res.json({
      ok: deliveredCount > 0,
      endpoint: '/debug/telegram',
      mode: 'send',
      tenantId: context.tenantId,
      tokenSource: context.tokenSource,
      sentText: text,
      deliveredCount,
      failedCount,
      results,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error),
    });
  }
});

app.use('/webhooks', webhookRouter);

app.use('/api/trpc', trpcMiddleware);

app.get('/api', (_req, res) => {
  res.json({ message: 'Dashboarduz API v1', trpc: '/api/trpc', webhooks: '/webhooks' });
});

export default app;
