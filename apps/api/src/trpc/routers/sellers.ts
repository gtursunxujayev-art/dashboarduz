import { router, protectedProcedure } from '../trpc';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { amocrmService, type AmoCRMLead, type AmoCRMUser } from '../../services/integrations/amocrm';
import { getTenantAmoCRMContext } from '../../services/integrations/amocrm-live';

const WON_STATUS_ID = '142';
const LOST_STATUS_ID = '143';
const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'Finance']);

function asString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function parseAmoDate(value: unknown): Date {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis);
  }

  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      return parseAmoDate(asNumber);
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date(0);
}

function getDealAmount(lead: AmoCRMLead): number {
  const maybePrice = (lead as Record<string, unknown>).price;
  if (typeof maybePrice === 'number' && Number.isFinite(maybePrice)) {
    return maybePrice;
  }
  if (typeof maybePrice === 'string') {
    const parsed = Number(maybePrice);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function getLeadResponsibleId(lead: AmoCRMLead): string | null {
  return asString(lead.responsible_user_id);
}

function isWonLead(lead: AmoCRMLead): boolean {
  return asString(lead.status_id) === WON_STATUS_ID;
}

function isLostLead(lead: AmoCRMLead): boolean {
  if (asString(lead.status_id) === LOST_STATUS_ID) {
    return true;
  }
  return lead.loss_reason_id !== undefined && lead.loss_reason_id !== null;
}

function toManagerRole(user: AmoCRMUser): string[] {
  return user.rights?.is_admin ? ['Manager'] : ['Agent'];
}

async function getAgentResponsibleScope(tenantId: string, userId: string, roles: string[]) {
  const isAgentOnly = roles.includes('Agent') && !roles.some((role) => PRIVILEGED_ROLES.has(role));
  if (!isAgentOnly) {
    return { isScoped: false, responsibleUserId: null as string | null };
  }

  let currentUser: { amocrmResponsibleUserId: string | null } | null = null;
  try {
    currentUser = await prisma.user.findFirst({
      where: {
        id: userId,
        tenantId,
        isActive: true,
      },
      select: {
        amocrmResponsibleUserId: true,
      },
    });
  } catch (error: any) {
    if (!String(error?.message || '').includes('amocrmResponsibleUserId')) {
      throw error;
    }
  }

  return {
    isScoped: true,
    responsibleUserId: currentUser?.amocrmResponsibleUserId || null,
  };
}

function buildMetrics(leads: AmoCRMLead[], calls: Array<{ duration: number | null; direction: string; status: string }>) {
  const totalLeads = leads.length;
  const wonLeads = leads.filter(isWonLead).length;
  const lostLeads = leads.filter(isLostLead).length;
  const activeLeads = Math.max(totalLeads - wonLeads - lostLeads, 0);
  const conversionRate = totalLeads > 0 ? (wonLeads / totalLeads) * 100 : 0;

  const totalDealAmount = leads.reduce((sum, lead) => sum + getDealAmount(lead), 0);
  const averageDealAmount = wonLeads > 0 ? totalDealAmount / wonLeads : 0;

  const totalCalls = calls.length;
  const inboundCalls = calls.filter((call) => call.direction === 'inbound').length;
  const outboundCalls = calls.filter((call) => call.direction === 'outbound').length;
  const totalCallDuration = calls.reduce((sum, call) => sum + (call.duration || 0), 0);
  const averageCallDuration = totalCalls > 0 ? totalCallDuration / totalCalls : 0;

  return {
    totalLeads,
    activeLeads,
    wonLeads,
    lostLeads,
    conversionRate: Number(conversionRate.toFixed(2)),
    totalDealAmount: Number(totalDealAmount.toFixed(2)),
    averageDealAmount: Number(averageDealAmount.toFixed(2)),
    totalCalls,
    inboundCalls,
    outboundCalls,
    totalCallDuration,
    averageCallDuration: Number(averageCallDuration.toFixed(2)),
  };
}

export const sellersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
    const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
    if (!amoContext) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'AmoCRM integration is not connected.',
      });
    }

    const [amocrmUsers, allLeads] = await Promise.all([
      amocrmService.fetchAllUsers(amoContext.accessToken, { limit: 250 }, amoContext.baseUrl),
      amocrmService.fetchAllLeads(
        amoContext.accessToken,
        {
          pipelineIds: amoContext.selectedPipelineIds,
          limit: 250,
        },
        amoContext.baseUrl,
      ),
    ]);

    const managers = amocrmUsers
      .filter((user) => user.is_active !== false)
      .filter((user) => {
        if (!scope.isScoped) {
          return true;
        }
        return asString(user.id) === scope.responsibleUserId;
      });

    const managerIds = new Set(
      managers
        .map((manager) => asString(manager.id))
        .filter(Boolean) as string[],
    );

    const leadsByManager = new Map<string, AmoCRMLead[]>();
    for (const lead of allLeads) {
      const responsibleUserId = getLeadResponsibleId(lead);
      if (!responsibleUserId || !managerIds.has(responsibleUserId)) {
        continue;
      }
      const current = leadsByManager.get(responsibleUserId) || [];
      current.push(lead);
      leadsByManager.set(responsibleUserId, current);
    }

    const calls = managerIds.size > 0
      ? await prisma.call.findMany({
          where: {
            tenantId: ctx.tenantId,
            lead: {
              responsibleUserId: {
                in: Array.from(managerIds),
              },
            },
          },
          select: {
            duration: true,
            direction: true,
            status: true,
            lead: {
              select: {
                responsibleUserId: true,
              },
            },
          },
        })
      : [];

    const callsByManager = new Map<string, Array<{ duration: number | null; direction: string; status: string }>>();
    for (const call of calls) {
      const managerId = asString(call.lead?.responsibleUserId);
      if (!managerId) {
        continue;
      }
      const current = callsByManager.get(managerId) || [];
      current.push({
        duration: call.duration,
        direction: call.direction,
        status: call.status,
      });
      callsByManager.set(managerId, current);
    }

    return managers
      .map((manager) => {
        const managerId = asString(manager.id) || '';
        const leads = leadsByManager.get(managerId) || [];
        const managerCalls = callsByManager.get(managerId) || [];

        return {
          id: managerId,
          name: manager.name || manager.login || `Manager ${managerId}`,
          email: manager.email || null,
          phone: null,
          roles: toManagerRole(manager),
          lastLoginAt: null,
          createdAt: new Date(0),
          metrics: buildMetrics(leads, managerCalls),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
      if (scope.isScoped && input.id !== scope.responsibleUserId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
      if (!amoContext) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AmoCRM integration is not connected.',
        });
      }

      const [amocrmUsers, leads, calls] = await Promise.all([
        amocrmService.fetchAllUsers(amoContext.accessToken, { limit: 250 }, amoContext.baseUrl),
        amocrmService.fetchAllLeads(
          amoContext.accessToken,
          {
            pipelineIds: amoContext.selectedPipelineIds,
            responsibleUserIds: [input.id],
            with: 'contacts',
            limit: 250,
          },
          amoContext.baseUrl,
        ),
        prisma.call.findMany({
          where: {
            tenantId: ctx.tenantId,
            lead: {
              responsibleUserId: input.id,
            },
          },
          select: {
            id: true,
            from: true,
            to: true,
            duration: true,
            status: true,
            direction: true,
            startedAt: true,
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
          take: 50,
        }),
      ]);

      const sellerUser = amocrmUsers.find((user) => asString(user.id) === input.id);
      if (!sellerUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Seller not found' });
      }

      const metrics = buildMetrics(
        leads,
        calls.map((call) => ({
          duration: call.duration,
          direction: call.direction,
          status: call.status,
        })),
      );

      const recentLeads = leads
        .slice()
        .sort((a, b) => parseAmoDate(b.created_at).getTime() - parseAmoDate(a.created_at).getTime())
        .slice(0, 50)
        .map((lead) => {
          const firstContact = Array.isArray(lead._embedded?.contacts) ? lead._embedded?.contacts[0] : null;
          const contact = firstContact && typeof firstContact === 'object'
            ? {
                name: asString((firstContact as Record<string, unknown>).name),
                phone: null,
                email: null,
              }
            : null;

          return {
            id: asString(lead.id) || '',
            title: lead.name || 'Untitled lead',
            status: asString(lead.status_id),
            metadata: lead,
            createdAt: parseAmoDate(lead.created_at),
            updatedAt: parseAmoDate(lead.updated_at),
            contact,
          };
        });

      return {
        seller: {
          id: input.id,
          name: sellerUser.name || sellerUser.login || `Manager ${input.id}`,
          email: sellerUser.email || null,
          phone: null,
          roles: toManagerRole(sellerUser),
          lastLoginAt: null,
          createdAt: new Date(0),
        },
        metrics,
        recentLeads,
        recentCalls: calls,
      };
    }),
});
