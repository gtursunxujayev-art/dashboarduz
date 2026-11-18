// Observability middleware for Express

import { randomUUID } from 'crypto';

import type { Express, NextFunction, Request, Response } from 'express';

import { asObjectOrEmpty } from '../lib/object';
import {
  LogLevel,
  logWithContext,
  Metrics,
  setSentryUserContext,
  clearSentryUserContext,
} from '../services/observability';
import { checkRedisHealth } from '../services/queue/redis-client';

export interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
  startTime: number;
}

// Add request context to Express request (`Request` in 'express' extends this interface).
declare module 'express-serve-static-core' {
  interface Request {
    context: RequestContext;
    /** Set by tenant-aware middleware when present; read here for the Sentry user context. */
    userId?: string;
    tenantId?: string;
  }
}

// Generate request ID middleware
function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] as string || randomUUID();

  req.context = {
    requestId,
    startTime: Date.now(),
  };

  res.setHeader('x-request-id', requestId);
  next();
}

// Request logging middleware
function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const { requestId, startTime } = req.context;

  // Log request start
  logWithContext(LogLevel.INFO, 'Request started', {
    requestId,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    operation: `${req.method} ${req.path}`,
  });

  // Capture response details
  const originalSend = res.send;

  res.send = function (this: Response, body?: unknown) {
    const duration = Date.now() - startTime;

    // Log request completion
    logWithContext(
      res.statusCode >= 400 ? LogLevel.WARN : LogLevel.INFO,
      'Request completed',
      {
        requestId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        operation: `${req.method} ${req.path}`,
      }
    );

    // Record metrics
    Metrics.increment('http_requests_total', {
      method: req.method,
      path: req.path,
      status: `${res.statusCode.toString().charAt(0)}xx`, // 2xx, 4xx, 5xx
    });

    Metrics.recordHistogram('http_request_duration_ms', duration, {
      method: req.method,
      path: req.path,
    });

    return originalSend.call(this, body);
  };

  next();
}

// Error logging middleware
function errorLoggingMiddleware(
  error: unknown,
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const { requestId, startTime } = req.context;
  const duration = Date.now() - startTime;
  const details = asObjectOrEmpty(error);

  logWithContext(LogLevel.ERROR, 'Request failed', {
    requestId,
    method: req.method,
    url: req.url,
    statusCode: details.statusCode || 500,
    duration,
    error: details.message,
    stack: process.env.NODE_ENV === 'development' ? details.stack : undefined,
    operation: `${req.method} ${req.path}`,
  });

  // Record error metric
  Metrics.increment('http_errors_total', {
    method: req.method,
    path: req.path,
    error_type: details.name ? String(details.name) : 'UnknownError',
  });

  next(error);
}

// User context middleware (sets Sentry user context)
function userContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  // Use tenantId and userId from request (set by tenant middleware)
  const { userId, tenantId } = req;

  // Update request context
  if (userId) req.context.userId = userId;
  if (tenantId) req.context.tenantId = tenantId;

  // Set Sentry user context
  setSentryUserContext(userId, tenantId);

  next();
}

// Cleanup middleware (clears Sentry context after request)
function cleanupMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    clearSentryUserContext();
  });
  next();
}

// Metrics endpoint middleware
function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/metrics') {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(Metrics.export());

    return;
  }
  next();
}

// Health check endpoint with detailed metrics
function healthCheckMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/health/detailed') {
    Promise.all([
      checkRedisHealth(),
    ]).then(([redisHealth]) => {
      const metrics = Metrics.toJSON();

      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        services: {
          redis: redisHealth,
        },
        metrics: {
          counters: Object.keys(metrics.counters).length,
          gauges: Object.keys(metrics.gauges).length,
          histograms: Object.keys(metrics.histograms).length,
        },
      });
    }).catch((error: Error) => {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
      });
    });

    return;
  }
  next();
}

// Apply all observability middleware
export function applyObservabilityMiddleware(app: Express) {
  app.use(requestIdMiddleware);
  app.use(userContextMiddleware);
  app.use(requestLoggingMiddleware);
  app.use(metricsMiddleware);
  app.use(healthCheckMiddleware);
  app.use(errorLoggingMiddleware);
  app.use(cleanupMiddleware);
}
