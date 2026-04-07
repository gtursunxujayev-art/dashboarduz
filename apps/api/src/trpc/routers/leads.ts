import { router, protectedProcedure } from '../trpc';
import { createLeadSchema, updateLeadSchema, leadQuerySchema } from '@dashboarduz/shared';
import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { amocrmService, type AmoCRMLead } from '../../services/integrations/amocrm';
import {
  asObject,
  extractLeadValue,
  getTenantAmoCRMContext,
} from '../../services/integrations/amocrm-live';

const PRIVILEGED_ROLES = new Set(['Admin', 'Manager', 'TeamLeader', 'Finance']);

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

function parseAmoTimestamp(value: unknown): Date {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis);
  }

  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber)) {
      return parseAmoTimestamp(asNumber);
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function getPrimaryContact(lead: AmoCRMLead): { name: string | null; phone: string | null; email: string | null } | null {
  const contacts = Array.isArray(lead._embedded?.contacts) ? lead._embedded?.contacts : [];
  const firstContact = asObject(contacts[0]);
  if (!firstContact) {
    return null;
  }

  return {
    name: typeof firstContact.name === 'string' ? firstContact.name : null,
    phone: null,
    email: null,
  };
}

function buildStatusMap(pipelines: Awaited<ReturnType<typeof amocrmService.fetchPipelines>>): Map<string, string> {
  const statusMap = new Map<string, string>();
  const pipelineList = Array.isArray(pipelines?._embedded?.pipelines) ? pipelines._embedded.pipelines : [];

  for (const pipeline of pipelineList) {
    const statuses = Array.isArray(pipeline._embedded?.statuses) ? pipeline._embedded.statuses : [];
    for (const status of statuses) {
      if (status.id !== null && status.id !== undefined) {
        statusMap.set(String(status.id), String(status.name || status.id));
      }
    }
  }

  return statusMap;
}

function buildPipelineMap(pipelines: Awaited<ReturnType<typeof amocrmService.fetchPipelines>>): Map<string, string> {
  const pipelineMap = new Map<string, string>();
  const pipelineList = Array.isArray(pipelines?._embedded?.pipelines) ? pipelines._embedded.pipelines : [];

  for (const pipeline of pipelineList) {
    if (pipeline.id !== null && pipeline.id !== undefined) {
      pipelineMap.set(String(pipeline.id), String(pipeline.name || pipeline.id));
    }
  }

  return pipelineMap;
}

function mapLeadForUi(lead: AmoCRMLead, statusMap: Map<string, string>, pipelineMap: Map<string, string>, sourceFieldKey: string | null) {
  const contact = getPrimaryContact(lead);
  const pipelineId = lead.pipeline_id !== null && lead.pipeline_id !== undefined ? String(lead.pipeline_id) : null;
  const statusId = lead.status_id !== null && lead.status_id !== undefined ? String(lead.status_id) : null;

  return {
    id: String(lead.id || ''),
    title: lead.name || 'Untitled Lead',
    amocrmId: String(lead.id || ''),
    status: statusId ? (statusMap.get(statusId) || statusId) : null,
    pipelineId,
    pipelineName: pipelineId ? (pipelineMap.get(pipelineId) || pipelineId) : null,
    source: extractLeadValue(lead, sourceFieldKey) || '-',
    contact,
    createdAt: parseAmoTimestamp(lead.created_at),
    updatedAt: parseAmoTimestamp(lead.updated_at),
    metadata: lead,
  };
}

export const leadsRouter = router({
  list: protectedProcedure
    .input(leadQuerySchema)
    .query(async ({ input, ctx }) => {
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
      if (scope.isScoped && !scope.responsibleUserId) {
        return {
          data: [],
          pagination: {
            page: input.page,
            limit: input.limit,
            total: undefined,
            hasMore: false,
          },
        };
      }

      const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
      if (!amoContext) {
        return {
          data: [],
          pagination: {
            page: input.page,
            limit: input.limit,
            total: undefined,
            hasMore: false,
          },
        };
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      });
      const settings = asObject(tenant?.settings);
      const dashboardSettings = asObject(settings?.dashboard);
      const sourceFieldKey = typeof dashboardSettings?.sourceFieldKey === 'string' ? dashboardSettings.sourceFieldKey : null;

      const [pipelines, response] = await Promise.all([
        amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl),
        amocrmService.fetchLeads(
          amoContext.accessToken,
          '',
          {
            page: input.page,
            limit: Math.min(input.limit, 100),
            with: 'contacts',
            query: input.search || undefined,
            pipelineIds: input.pipelineIds && input.pipelineIds.length > 0
              ? input.pipelineIds
              : (amoContext.selectedPipelineIds || undefined),
            responsibleUserIds: scope.isScoped && scope.responsibleUserId ? [scope.responsibleUserId] : undefined,
          },
          amoContext.baseUrl,
        ),
      ]);

      const statusMap = buildStatusMap(pipelines);
      const pipelineMap = buildPipelineMap(pipelines);
      const leads = Array.isArray(response._embedded?.leads) ? response._embedded.leads : [];
      const mapped = leads.map((lead) => mapLeadForUi(lead, statusMap, pipelineMap, sourceFieldKey));

      return {
        data: mapped,
        pagination: {
          page: input.page,
          limit: input.limit,
          total: undefined,
          hasMore: Boolean(response._links?.next?.href),
        },
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const scope = await getAgentResponsibleScope(ctx.tenantId, ctx.user.userId, ctx.user.roles);
      if (scope.isScoped && !scope.responsibleUserId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
      }

      const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
      if (!amoContext) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AmoCRM integration is not connected for this tenant.',
        });
      }

      const [pipelines, lead] = await Promise.all([
        amocrmService.fetchPipelines(amoContext.accessToken, amoContext.baseUrl),
        amocrmService.fetchLeadById(
          amoContext.accessToken,
          input.id,
          { with: 'contacts' },
          amoContext.baseUrl,
        ),
      ]);

      if (scope.isScoped) {
        const responsibleUserId = lead.responsible_user_id !== null && lead.responsible_user_id !== undefined
          ? String(lead.responsible_user_id)
          : null;
        if (!responsibleUserId || responsibleUserId !== scope.responsibleUserId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
        }
      }

      const pipelineId = lead.pipeline_id !== null && lead.pipeline_id !== undefined ? String(lead.pipeline_id) : null;
      if (amoContext.selectedPipelineIds && (!pipelineId || !amoContext.selectedPipelineIds.includes(pipelineId))) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
      }

      const statusMap = buildStatusMap(pipelines);
      const pipelineMap = buildPipelineMap(pipelines);

      return {
        id: String(lead.id || ''),
        title: lead.name || 'Untitled Lead',
        amocrmId: String(lead.id || ''),
        status: lead.status_id !== null && lead.status_id !== undefined
          ? (statusMap.get(String(lead.status_id)) || String(lead.status_id))
          : null,
        pipelineId,
        pipelineName: pipelineId ? (pipelineMap.get(pipelineId) || pipelineId) : null,
        contact: getPrimaryContact(lead),
        createdAt: parseAmoTimestamp(lead.created_at),
        updatedAt: parseAmoTimestamp(lead.updated_at),
        metadata: lead,
      };
    }),

  create: protectedProcedure
    .input(createLeadSchema)
    .mutation(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Manual lead creation is disabled. Leads are managed in AmoCRM.',
      });
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().min(1),
      data: updateLeadSchema,
    }))
    .mutation(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Manual lead updates are disabled. Leads are managed in AmoCRM.',
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async () => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Manual lead deletion is disabled. Leads are managed in AmoCRM.',
      });
    }),
});
