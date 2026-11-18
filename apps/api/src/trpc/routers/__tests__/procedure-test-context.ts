/**
 * Shared pieces for tests that call a tRPC router through `createCaller` with a mocked database.
 *
 * `protectedProcedure` swaps `ctx.db` for `forTenant(...)`, so a test mocks `@dashboarduz/db` to make
 * `forTenant` return its fake client, then builds the caller context with {@link buildCallerContext}.
 */
import type { JWTPayload } from '@dashboarduz/shared';
import type { Request, Response } from 'express';

import type { Context } from '../../context';

export function buildCallerContext(params: { tenantId: string; userId: string; roles: JWTPayload['roles'] }): Context {
  return {
    req: {} as Request,
    res: {} as Response,
    tenantId: params.tenantId,
    user: { userId: params.userId, tenantId: params.tenantId, roles: params.roles },
  };
}

/** A procedure answer as plain JSON (dates as ISO strings), so key order is compared too. */
export function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
