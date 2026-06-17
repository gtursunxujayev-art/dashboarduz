import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context';
import { prisma } from '@dashboarduz/db';
import { Prisma } from '@prisma/client';
import superjson from 'superjson';
import { log, LogLevel } from '../services/observability';

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

function isPrismaSchemaMismatchError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2021' || error.code === 'P2022') {
      return true;
    }
  }

  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('does not exist in the current database')
    || (message.includes('column') && message.includes('does not exist'))
    || (message.includes('table') && message.includes('does not exist'))
    || (message.includes('relation') && message.includes('does not exist'))
  );
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
      log(LogLevel.WARN, 'Slow tRPC procedure', {
        procedureName: opts.path,
        procedureType: opts.type,
        tenantId: opts.ctx.tenantId,
        userId: opts.ctx.user?.userId,
        durationMs,
        responseSize,
        ok,
      });
    } else if (process.env.TRPC_PERF_LOG_ALL === 'true') {
      log(LogLevel.INFO, 'tRPC procedure completed', {
        procedureName: opts.path,
        procedureType: opts.type,
        tenantId: opts.ctx.tenantId,
        userId: opts.ctx.user?.userId,
        durationMs,
        responseSize,
        ok,
      });
    }
    return result;
  } catch (error) {
    log(LogLevel.WARN, 'tRPC procedure failed', {
      procedureName: opts.path,
      procedureType: opts.type,
      tenantId: opts.ctx.tenantId,
      userId: opts.ctx.user?.userId,
      durationMs: Date.now() - startedAt,
      errorName: (error as Error | undefined)?.name,
    });
    throw error;
  }
});

const baseProcedure = t.procedure.use(performanceMiddleware).use(async (opts) => {
  try {
    return await opts.next();
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    if (isPrismaSchemaMismatchError(error)) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Database schema is out of date. Run `npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma` and redeploy API/worker.',
      });
    }

    throw error;
  }
});

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

  const activeUser = await prisma.user.findFirst({
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

  try {
    await prisma.$executeRaw`SELECT app.set_tenant_context(${ctx.tenantId}::uuid, ${ctx.user.userId}::uuid)`;
  } catch (error: any) {
    console.error('[Auth] Failed to set tenant context for RLS:', error?.message);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Tenant database context is not configured',
    });
  }

  return opts.next({
    ctx: {
      ...ctx,
      user: ctx.user,
      tenantId: ctx.tenantId,
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
