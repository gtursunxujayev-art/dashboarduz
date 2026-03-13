import { router, protectedProcedure } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

export const sellersRouter = router({
  // List all sellers with metrics
  list: protectedProcedure
    .query(async ({ ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      // Get all users with role "Agent" or "seller" in the tenant
      const sellers = await prisma.user.findMany({
        where: {
          tenantId: ctx.tenantId,
          roles: {
            hasSome: ['Agent', 'seller'], // Look for users with either role
          },
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          roles: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });

      // Get metrics for each seller
      const sellersWithMetrics = await Promise.all(
        sellers.map(async (seller: (typeof sellers)[number]) => {
          // Get leads assigned to this seller
          const leads = await prisma.lead.findMany({
            where: {
              tenantId: ctx.tenantId,
              responsibleUserId: seller.id,
            },
            select: {
              id: true,
              status: true,
              metadata: true,
              createdAt: true,
            },
          });

          // Get calls made by this seller (using metadata as fallback since agentId field doesn't exist)
          // Note: We'll need to check metadata for agentId or use a different approach
          const calls = await prisma.call.findMany({
            where: {
              tenantId: ctx.tenantId,
              // Since agentId field doesn't exist, we'll need to use metadata or another approach
              // For now, we'll get all calls and filter later if needed
            },
            select: {
              id: true,
              duration: true,
              status: true,
              direction: true,
              startedAt: true,
              metadata: true,
            },
          });

          // Filter calls by seller (check metadata for agentId)
          const sellerCalls = calls.filter((call: any) => {
            const metadata = call.metadata as any;
            return metadata?.agentId === seller.id;
          });

          // Calculate metrics
          const totalLeads = leads.length;
          const activeLeads = leads.filter((lead: any) => lead.status && !['lost', 'won'].includes(lead.status)).length;
          const wonLeads = leads.filter((lead: any) => lead.status === 'won').length;
          const lostLeads = leads.filter((lead: any) => lead.status === 'lost').length;
          
          // Calculate deal amount from metadata
          const totalDealAmount = leads.reduce((sum: number, lead: any) => {
            const metadata = lead.metadata as any;
            const dealAmount = metadata?.dealAmount || metadata?.amount || 0;
            return sum + (typeof dealAmount === 'number' ? dealAmount : 0);
          }, 0);
          
          const averageDealAmount = wonLeads > 0 ? totalDealAmount / wonLeads : 0;

          // Call metrics
          const totalCalls = sellerCalls.length;
          const inboundCalls = sellerCalls.filter((call: any) => call.direction === 'inbound').length;
          const outboundCalls = sellerCalls.filter((call: any) => call.direction === 'outbound').length;
          const totalCallDuration = sellerCalls.reduce((sum: number, call: any) => sum + (call.duration || 0), 0);
          const averageCallDuration = totalCalls > 0 ? totalCallDuration / totalCalls : 0;

          // Calculate conversion rate
          const conversionRate = totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0;

          return {
            ...seller,
            metrics: {
              totalLeads,
              activeLeads,
              wonLeads,
              lostLeads,
              conversionRate: parseFloat(conversionRate.toFixed(2)),
              totalDealAmount: parseFloat(totalDealAmount.toFixed(2)),
              averageDealAmount: parseFloat(averageDealAmount.toFixed(2)),
              totalCalls,
              inboundCalls,
              outboundCalls,
              totalCallDuration,
              averageCallDuration: parseFloat(averageCallDuration.toFixed(2)),
            },
          };
        })
      );

      return sellersWithMetrics;
    }),

  // Get seller details by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      if (!ctx.tenantId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      // Get seller
      const seller = await prisma.user.findFirst({
        where: {
          id: input.id,
          tenantId: ctx.tenantId,
          roles: {
            hasSome: ['Agent', 'seller'],
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          roles: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });

      if (!seller) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      // Get leads assigned to this seller
      const leads = await prisma.lead.findMany({
        where: {
          tenantId: ctx.tenantId,
          responsibleUserId: seller.id,
        },
        select: {
          id: true,
          title: true,
          status: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          contact: {
            select: {
              name: true,
              phone: true,
              email: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 50, // Limit to recent leads
      });

      // Get calls (using metadata as fallback)
      const allCalls = await prisma.call.findMany({
        where: {
          tenantId: ctx.tenantId,
        },
        select: {
          id: true,
          from: true,
          to: true,
          duration: true,
          status: true,
          direction: true,
          startedAt: true,
          metadata: true,
          lead: {
            select: {
              id: true,
              title: true,
            },
          },
        },
        orderBy: {
          startedAt: 'desc',
        },
        take: 50, // Limit to recent calls
      });

      // Filter calls by seller (check metadata for agentId)
      const sellerCalls = allCalls.filter((call: any) => {
        const metadata = call.metadata as any;
        return metadata?.agentId === seller.id;
      });

      // Calculate metrics
      const totalLeads = await prisma.lead.count({
        where: {
          tenantId: ctx.tenantId,
          responsibleUserId: seller.id,
        },
      });

      const activeLeads = await prisma.lead.count({
        where: {
          tenantId: ctx.tenantId,
          responsibleUserId: seller.id,
          status: {
            notIn: ['lost', 'won'],
          },
        },
      });

      const wonLeads = await prisma.lead.count({
        where: {
          tenantId: ctx.tenantId,
          responsibleUserId: seller.id,
          status: 'won',
        },
      });

      const lostLeads = await prisma.lead.count({
        where: {
          tenantId: ctx.tenantId,
          responsibleUserId: seller.id,
          status: 'lost',
        },
      });

      // Get deal amounts for won leads
      const wonLeadData = await prisma.lead.findMany({
        where: {
          tenantId: ctx.tenantId,
          responsibleUserId: seller.id,
          status: 'won',
        },
        select: {
          metadata: true,
        },
      });

      const totalDealAmount = wonLeadData.reduce((sum: number, lead: any) => {
        const metadata = lead.metadata as any;
        const dealAmount = metadata?.dealAmount || metadata?.amount || 0;
        return sum + (typeof dealAmount === 'number' ? dealAmount : 0);
      }, 0);

      const averageDealAmount = wonLeads > 0 ? totalDealAmount / wonLeads : 0;

      // Call metrics
      const totalCalls = sellerCalls.length;
      const inboundCalls = sellerCalls.filter((call: any) => call.direction === 'inbound').length;
      const outboundCalls = sellerCalls.filter((call: any) => call.direction === 'outbound').length;
      const totalCallDuration = sellerCalls.reduce((sum: number, call: any) => sum + (call.duration || 0), 0);
      const averageCallDuration = totalCalls > 0 ? totalCallDuration / totalCalls : 0;

      // Calculate conversion rate
      const conversionRate = totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0;

      return {
        seller,
        metrics: {
          totalLeads,
          activeLeads,
          wonLeads,
          lostLeads,
          conversionRate: parseFloat(conversionRate.toFixed(2)),
          totalDealAmount: parseFloat(totalDealAmount.toFixed(2)),
          averageDealAmount: parseFloat(averageDealAmount.toFixed(2)),
          totalCalls,
          inboundCalls,
          outboundCalls,
          totalCallDuration,
          averageCallDuration: parseFloat(averageCallDuration.toFixed(2)),
        },
        recentLeads: leads,
        recentCalls: sellerCalls,
      };
    }),
});
