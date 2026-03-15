import { router, protectedProcedure } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';

const callsListSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  status: z.string().optional(),
});

const clickToCallSchema = z.object({
  from: z.string().min(3),
  to: z.string().min(3),
  callerId: z.string().optional(),
  recording: z.boolean().optional().default(true),
});

export const callsRouter = router({
  list: protectedProcedure
    .input(callsListSchema)
    .query(async ({ input, ctx }) => {
      const { page, limit, search, status } = input;
      const skip = (page - 1) * limit;

      const where: any = {
        tenantId: ctx.tenantId,
      };

      if (status) {
        where.status = status;
      }
      if (search) {
        where.OR = [
          { from: { contains: search, mode: 'insensitive' } },
          { to: { contains: search, mode: 'insensitive' } },
          { callIdExternal: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.call.findMany({
          where,
          orderBy: { startedAt: 'desc' },
          skip,
          take: limit,
          include: {
            lead: {
              select: { id: true, title: true, status: true },
            },
          },
        }),
        prisma.call.count({ where }),
      ]);

      return {
        data,
        pagination: {
          page,
          limit,
          total,
          hasMore: skip + data.length < total,
        },
      };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const call = await prisma.call.findFirst({
        where: {
          id: input.id,
          tenantId: ctx.tenantId,
        },
        include: {
          lead: true,
        },
      });

      if (!call) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Call not found' });
      }

      return call;
    }),

  clickToCall: protectedProcedure
    .input(clickToCallSchema)
    .mutation(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Click-to-call is disabled in webhook-only UTeL mode.',
      });
    }),
});
