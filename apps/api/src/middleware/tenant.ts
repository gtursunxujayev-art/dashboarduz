// src/middleware/tenant.ts
import { Request, Response, NextFunction } from 'express';
import { verifyJWT } from '../services/auth/jwt';
import { logger } from '../lib/logger';

export async function resolveTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;

    // Require Bearer token
    if (!authHeader?.startsWith('Bearer ')) {
      logger.warn({ 
        msg: 'Missing Bearer token for tenant resolution',
        path: req.path,
        ip: req.ip 
      });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const payload = verifyJWT(token); // throws if invalid

    // Expect payload to contain tenantId
    if (!payload || !payload.tenantId) {
      logger.warn({ 
        msg: 'Token missing tenantId',
        payload,
        path: req.path 
      });
      return res.status(401).json({ error: 'Invalid session' });
    }

    // Attach to request
    (req as any).tenantId = payload.tenantId;
    (req as any).userId = payload.userId;
    (req as any).roles = payload.roles || [];

    next();
  } catch (err) {
    logger.warn({ 
      err, 
      msg: 'Failed to resolve tenant from JWT',
      path: req.path,
      ip: req.ip 
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

// Optional tenant resolution for public endpoints
export function optionalTenant(req: Request, _res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (!token) {
        return next();
      }
      const payload = verifyJWT(token);
      
      if (payload?.tenantId) {
        (req as any).tenantId = payload.tenantId;
        (req as any).userId = payload.userId;
        (req as any).roles = payload.roles || [];
      }
    }
    
    next();
  } catch (err) {
    // Token present but invalid; proceed unauthenticated for optional resolution but log for observability.
    logger.warn({
      err,
      msg: 'optionalTenant: JWT parse failed; proceeding unauthenticated',
      path: req.path,
      ip: req.ip,
    });
    next();
  }
}

// Tenant validation middleware - ensures tenant has access to resource
export function validateTenantAccess(resourceTenantId: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestTenantId = (req as any).tenantId;
    
    if (!requestTenantId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    
    if (requestTenantId !== resourceTenantId) {
      logger.warn({
        msg: 'Tenant access violation',
        requestTenantId,
        resourceTenantId,
        userId: (req as any).userId,
        path: req.path,
        method: req.method
      });
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    
    next();
  };
}
