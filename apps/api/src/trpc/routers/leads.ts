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
    .mutation(async ({ input, ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      return await prisma.lead.create({
        data: {
          tenantId: ctx.tenantId,
          ...input,
        },
        include: {
          contact: true,
        },
      });
    }),

  // Update lead
  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      data: updateLeadSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      // Verify lead belongs to tenant
      const existing = await prisma.lead.findFirst({
        where: {
          id: input.id,
          tenantId: ctx.tenantId,
        },
      });

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
      }

      return await prisma.lead.update({
        where: { id: input.id },
        data: input.data,
        include: {
          contact: true,
        },
      });
    }),

  // Delete lead
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      await prisma.lead.deleteMany({
        where: {
          id: input.id,
          tenantId: ctx.tenantId,
        },
      });

      return { success: true };
    }),
});
