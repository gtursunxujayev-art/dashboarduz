// Observability middleware for Express

import { Request, Response, NextFunction } from 'express';
import { LogLevel, logWithContext, setSentryUserContext, clearSentryUserContext } from '../services/observability';
import { randomUUID } from 'crypto';

export interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
  startTime: number;
}

// Add request context to Express request
declare global {
  namespace Express {
    interface Request {
      context: RequestContext;
    }
  }
}

// Generate request ID middleware
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] as string || randomUUID();
  
  req.context = {
    requestId,
    startTime: Date.now(),
  };

  res.setHeader('x-request-id', requestId);
  next();
}

// Request logging middleware
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
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
  res.send = function(body: any) {
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
    const { Metrics } = require('../services/observability');
    Metrics.increment('http_requests_total', {
      method: req.method,
      path: req.path,
      status: res.statusCode.toString().charAt(0) + 'xx', // 2xx, 4xx, 5xx
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
export function errorLoggingMiddleware(
  error: any,
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const { requestId, startTime } = req.context;
  const duration = Date.now() - startTime;

  logWithContext(LogLevel.ERROR, 'Request failed', {
    requestId,
    method: req.method,
    url: req.url,
    statusCode: error.statusCode || 500,
    duration,
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    operation: `${req.method} ${req.path}`,
  });

  // Record error metric
  const { Metrics } = require('../services/observability');
  Metrics.increment('http_errors_total', {
    method: req.method,
    path: req.path,
    error_type: error.name || 'UnknownError',
  });

  next(error);
}

// User context middleware (sets Sentry user context)
export function userContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  // Use tenantId and userId from request (set by tenant middleware)
  const userId = (req as any).userId;
  const tenantId = (req as any).tenantId;

  // Update request context
  if (userId) req.context.userId = userId;
  if (tenantId) req.context.tenantId = tenantId;

  // Set Sentry user context
  setSentryUserContext(userId, tenantId);

  next();
}

// Cleanup middleware (clears Sentry context after request)
export function cleanupMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    clearSentryUserContext();
  });
  next();
}

// Metrics endpoint middleware
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/metrics') {
    const { Metrics } = require('../services/observability');
    
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(Metrics.export());
    return;
  }
  next();
}

// Health check endpoint with detailed metrics
export function healthCheckMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/health/detailed') {
    const { Metrics } = require('../services/observability');
    const { checkRedisHealth } = require('../services/queue/redis-client');
    
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
export function applyObservabilityMiddleware(app: any) {
  app.use(requestIdMiddleware);
  app.use(userContextMiddleware);
  app.use(requestLoggingMiddleware);
  app.use(metricsMiddleware);
  app.use(healthCheckMiddleware);
  app.use(errorLoggingMiddleware);
  app.use(cleanupMiddleware);
}
