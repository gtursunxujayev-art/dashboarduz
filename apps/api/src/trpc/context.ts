import type { Request, Response } from 'express';
import type { JWTPayload } from '@dashboarduz/shared';

export interface Context {
  req: Request;
  res: Response;
  user?: JWTPayload;
  tenantId?: string;
}

export async function createContext(opts: { req: Request; res: Response }): Promise<Context> {
  // Extract JWT from Authorization header
  const authHeader = opts.req.headers.authorization;
  let user: JWTPayload | undefined;
  let tenantId: string | undefined;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const { verifyJWT } = await import('../services/auth/jwt');
      user = verifyJWT(token);
      tenantId = user.tenantId;
    } catch (error) {
      // Invalid token - user remains undefined
    }
  }

  // Also check subdomain for tenant resolution
  const host = opts.req.headers.host || '';
  const subdomain = host.split('.')[0];
  if (subdomain && subdomain !== 'localhost' && subdomain !== 'www') {
    // TODO: Resolve tenant from subdomain
  }

  return {
    req: opts.req,
    res: opts.res,
    ...(user ? { user } : {}),
    ...(tenantId ? { tenantId } : {}),
  };
}
