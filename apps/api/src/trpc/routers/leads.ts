import { router, protectedProcedure } from '../trpc';
import { createLeadSchema, updateLeadSchema, leadQuerySchema } from '@dashboarduz/shared';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

export const leadsRouter = router({
  // List leads with pagination
  list: protectedProcedure
    .input(leadQuerySchema)
    .query(async ({ input, ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      const { page = 1, limit = 20, status, contactId, search, cursor } = input;
      const skip = (page - 1) * limit;

      const where: any = {
        tenantId: ctx.tenantId,
        amocrmId: {
          not: null,
        },
      };

      if (status) where.status = status;
      if (contactId) where.contactId = contactId;
      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { amocrmId: { contains: search } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            contact: true,
          },
        }),
        prisma.lead.count({ where }),
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

  // Get lead by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      const lead = await prisma.lead.findFirst({
        where: {
          id: input.id,
          tenantId: ctx.tenantId,
          amocrmId: {
            not: null,
          },
        },
        include: {
          contact: true,
          calls: true,
        },
      });

      if (!lead) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
      }

      return lead;
    }),

  // Create lead
  create: protectedProcedure
    .input(createLeadSchema)
    .mutation(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Manual lead creation is disabled. Leads are ingestion-only from AmoCRM.',
      });
    }),

  // Update lead
  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      data: updateLeadSchema,
    }))
    .mutation(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Manual lead updates are disabled. Leads are ingestion-only from AmoCRM.',
      });
    }),

  // Delete lead
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Manual lead deletion is disabled. Leads are ingestion-only from AmoCRM.',
      });
    }),
});
