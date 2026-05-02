import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context';
import { prisma } from '@dashboarduz/db';
import { Prisma } from '@prisma/client';
import superjson from 'superjson';

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

const baseProcedure = t.procedure.use(async (opts) => {
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
