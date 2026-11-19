
import { createLeadSchema, updateLeadSchema, leadQuerySchema } from '@dashboarduz/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { resolveCallerDataScope } from '../../lib/access';
import { parseAmoTimestamp } from '../../lib/amocrm';
import { asObject } from '../../lib/object';
import { amocrmService, type AmoCRMLead } from '../../services/integrations/amocrm';
import { getAmoReference } from '../../services/integrations/amocrm-activity-snapshot-read';
import { fetchSnapshotLeadById, getAmoLeadPage } from '../../services/integrations/amocrm-lead-snapshot-read';
import {
  extractLeadValue,
  getTenantAmoCRMContext,
} from '../../services/integrations/amocrm-live';
import { SNAPSHOT_WINDOW_DAYS } from '../../services/integrations/amocrm-snapshot-window';
import { router, protectedProcedure } from '../trpc';

/** Whether a lead with this amoCRM responsible user is visible in the caller's scope (`null` ids = everyone). */
export function isLeadResponsibleInScope(amoResponsibleIds: readonly string[] | null, responsibleUserId: string | null): boolean {
  if (amoResponsibleIds === null) return true;

  return Boolean(responsibleUserId) && amoResponsibleIds.includes(responsibleUserId as string);
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
      const scope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);

      if (scope.amoResponsibleIds && scope.amoResponsibleIds.length === 0) {
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

      const amoContext = await getTenantAmoCRMContext(ctx.tenantId, ctx.db);

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

      const tenant = await ctx.db.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      });
      const settings = asObject(tenant?.settings);
      const dashboardSettings = asObject(settings?.dashboard);
      const sourceFieldKey = typeof dashboardSettings?.sourceFieldKey === 'string' ? dashboardSettings.sourceFieldKey : null;

      const [pipelines, response] = await Promise.all([
        getAmoReference(ctx.tenantId, 'pipelines', amoContext, ctx.db),
        // Snapshot (last 62 days plus every open lead) without search; a search asks amoCRM.
        getAmoLeadPage(
          ctx.tenantId,
          {
            page: input.page,
            limit: Math.min(input.limit, 100),
            query: input.search || undefined,
            pipelineIds: input.pipelineIds && input.pipelineIds.length > 0
              ? input.pipelineIds
              : (amoContext.selectedPipelineIds || undefined),
            responsibleUserIds: scope.amoResponsibleIds ?? undefined,
          },
          amoContext,
          ctx.db,
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
        /** 'snapshot': recent and open leads only (older ones are found by searching). */
        source: response.source,
        snapshotWindowDays: SNAPSHOT_WINDOW_DAYS,
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const scope = await resolveCallerDataScope(ctx.tenantId, ctx.user.userId, ctx.user.roles, ctx.db);

      if (scope.amoResponsibleIds && scope.amoResponsibleIds.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
      }

      const amoContext = await getTenantAmoCRMContext(ctx.tenantId, ctx.db);

      if (!amoContext) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'AmoCRM integration is not connected for this tenant.',
        });
      }

      const [pipelines, snapshotLead] = await Promise.all([
        getAmoReference(ctx.tenantId, 'pipelines', amoContext, ctx.db),
        fetchSnapshotLeadById(ctx.tenantId, input.id, ctx.db),
      ]);
      // A lead created since the last snapshot refresh is not stored yet; read that one live.
      const lead = snapshotLead ?? await amocrmService.fetchLeadById(
        amoContext.accessToken,
        input.id,
        { with: 'contacts' },
        amoContext.baseUrl,
      );

      const responsibleUserId = lead.responsible_user_id !== null && lead.responsible_user_id !== undefined
        ? String(lead.responsible_user_id)
        : null;

      if (!isLeadResponsibleInScope(scope.amoResponsibleIds, responsibleUserId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lead not found' });
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
    .mutation(() => {
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
    .mutation(() => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Manual lead updates are disabled. Leads are managed in AmoCRM.',
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(() => {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Manual lead deletion is disabled. Leads are managed in AmoCRM.',
      });
    }),
});
