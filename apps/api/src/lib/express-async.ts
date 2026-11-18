import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Adapts an async route handler to Express 4, which ignores the promise a handler returns.
 * The handlers keep their own try/catch and responses; a rejection that still escapes goes to `next`
 * (Express' error handling) instead of becoming an unhandled rejection.
 */
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
