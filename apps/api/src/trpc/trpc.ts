import { forTenant } from '@dashboarduz/db';
import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';

import { logger } from '../lib/logger';

import type { Context } from './context';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof Error && error.cause.name === 'ZodError' 
          ? error.cause 
          : null,
      },
    };
  },
});

export const router = t.router;

function getApproxResponseSize(value: unknown): number | undefined {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return undefined;
  }
}

const performanceMiddleware = t.middleware(async (opts) => {
  const startedAt = Date.now();
  let ok = false;

  try {
    const result = await opts.next();

    ok = result.ok;
    const durationMs = Date.now() - startedAt;
    const responseSize = result.ok ? getApproxResponseSize(result.data) : undefined;

    if (durationMs >= Number(process.env.TRPC_SLOW_PROCEDURE_MS || 750)) {
      logger.warn({
        procedureName: opts.path,
        procedureType: opts.type,
        tenantId: opts.ctx.tenantId,
        userId: opts.ctx.user?.userId,
        durationMs,
        responseSize,
        ok,
      }, 'Slow tRPC procedure');
    } else if (process.env.TRPC_PERF_LOG_ALL === 'true') {
      logger.info({
        procedureName: opts.path,
        procedureType: opts.type,
        tenantId: opts.ctx.tenantId,
        userId: opts.ctx.user?.userId,
        durationMs,
        responseSize,
        ok,
      }, 'tRPC procedure completed');
    }

    return result;
  } catch (error) {
    logger.warn({
      procedureName: opts.path,
      procedureType: opts.type,
      tenantId: opts.ctx.tenantId,
      userId: opts.ctx.user?.userId,
      durationMs: Date.now() - startedAt,
      errorName: (error as Error | undefined)?.name,
    }, 'tRPC procedure failed');
    throw error;
  }
});

// Database errors (including a missing table or column) surface as they are; nothing translates them into a
// softer message, so a schema or query problem is visible in logs and to the caller instead of being masked.
const baseProcedure = t.procedure.use(performanceMiddleware);

export const publicProcedure = baseProcedure;

// Protected procedure that requires authentication
export const protectedProcedure = baseProcedure.use(async (opts) => {
  const { ctx } = opts;
  
  if (!ctx.user || !ctx.tenantId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }

  // Every query of a protected procedure runs with the caller's tenant/user RLS
  // context set transaction-locally (see forTenant in @dashboarduz/db), including
  // this activity check.
  const db = forTenant(ctx.tenantId, ctx.user.userId);

  const activeUser = await db.user.findFirst({
    where: {
      id: ctx.user.userId,
      tenantId: ctx.tenantId,
      isActive: true,
    },
    select: { id: true },
  });

  if (!activeUser) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'User is deactivated',
    });
  }

  return opts.next({
    ctx: {
      ...ctx,
      user: ctx.user,
      tenantId: ctx.tenantId,
      db,
    },
  });
});

// Admin-only procedure
export const adminProcedure = protectedProcedure.use(async (opts) => {
  const { ctx } = opts;
  
  if (!ctx.user?.roles?.includes('Admin')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access required',
    });
  }

  return opts.next();
});

// Admin, Manager or TeamLeader procedure
export const managerProcedure = protectedProcedure.use(async (opts) => {
  const { ctx } = opts;

  const roles = ctx.user?.roles || [];

  if (!roles.includes('Admin') && !roles.includes('Manager') && !roles.includes('TeamLeader')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Manager, TeamLeader or Admin access required',
    });
  }

  return opts.next();
});
