import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context';
import { prisma } from '@dashboarduz/db';
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
export const publicProcedure = t.procedure;

// Protected procedure that requires authentication
export const protectedProcedure = t.procedure.use(async (opts) => {
  const { ctx } = opts;
  
  if (!ctx.user || !ctx.tenantId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
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
