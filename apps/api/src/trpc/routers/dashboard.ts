import { prisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { amocrmService } from '../../services/integrations/amocrm';
import {
  asObject,
  asStringArray,
  extractLeadValue,
  getSystemLeadFieldOptions,
  getTenantAmoCRMContext,
  humanizeKey,
  normalizeIdentifier,
  type LeadFieldOption,
} from '../../services/integrations/amocrm-live';
import { adminProcedure, protectedProcedure, router } from '../trpc';

const dashboardRangeSchema = z.enum(['today', 'week', 'month']);

const PIE_COLORS = [
  '#22C55E',
  '#3B82F6',
  '#A855F7',
  '#F97316',
  '#EF4444',
  '#EAB308',
  '#14B8A6',
  '#EC4899',
  '#6366F1',
  '#84CC16',
] as const;

type DashboardRange = z.infer<typeof dashboardRangeSchema>;

function getRangeStart(range: DashboardRange, now: Date): Date {
  if (range === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (range === 'week') {
    const day = now.getDay();
    const daysSinceMonday = (day + 6) % 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  }

  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function toPieData(input: Map<string, number>) {
  return Array.from(input.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({
      name,
      value,
      color: PIE_COLORS[index % PIE_COLORS.length],
    }));
}

function buildFieldLabelMap(options: LeadFieldOption[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const option of options) {
    labels.set(option.key, option.label);
  }
  return labels;
}

async function collectCatalogFieldOptions(tenantId: string): Promise<LeadFieldOption[]> {
  const context = await getTenantAmoCRMContext(tenantId);
  if (!context) {
    return [];
  }

  try {
    const catalog = await amocrmService.fetchLeadCustomFields(context.accessToken, context.baseUrl);
    const fields = Array.isArray(catalog?._embedded?.custom_fields) ? catalog._embedded.custom_fields : [];

    const options: LeadFieldOption[] = [];
    for (const field of fields) {
      const identifier = normalizeIdentifier(field.code || field.name || field.id);
      if (!identifier) {
        continue;
      }

      options.push({
        key: `amocrm_custom:${identifier}`,
        label: String(field.name || field.code || field.id || identifier),
        source: 'catalog',
      });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

function isMappedValue(value: string | null, targetValues: string[]): boolean {
  if (!value) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();
  return targetValues.some((target) => target.trim().toLowerCase() === normalizedValue);
}

export const dashboardRouter = router({
  summary: protectedProcedure
    .input(z.object({ range: dashboardRangeSchema, pipelineIds: z.array(z.string()).optional() }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const rangeStart = getRangeStart(input.range, now);
      const tenant = await prisma.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { settings: true },
      });

      if (!tenant) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
      }

      const settings = asObject(tenant.settings);
      const dashboardSettings = asObject(settings?.dashboard);
      const reasonFieldKey = typeof dashboardSettings?.reasonFieldKey === 'string' ? dashboardSettings.reasonFieldKey : null;
      const sourceFieldKey = typeof dashboardSettings?.sourceFieldKey === 'string' ? dashboardSettings.sourceFieldKey : null;
      const qualifiedValues = asStringArray(dashboardSettings?.qualifiedValues);
      const nonQualifiedValues = asStringArray(dashboardSettings?.nonQualifiedValues);
      const qualifiedStageIds = asStringArray(dashboardSettings?.qualifiedStageIds);

      const [amoContext, catalogOptions] = await Promise.all([
        getTenantAmoCRMContext(ctx.tenantId),
        collectCatalogFieldOptions(ctx.tenantId),
      ]);
      const fieldLabelMap = buildFieldLabelMap([...getSystemLeadFieldOptions(), ...catalogOptions]);
      const selectedPipelineIds = input.pipelineIds && input.pipelineIds.length > 0
        ? input.pipelineIds
        : (amoContext?.selectedPipelineIds ?? null);
      const leads = amoContext
        ? await amocrmService.fetchAllLeads(
            amoContext.accessToken,
            {
              pipelineIds: selectedPipelineIds,
              createdAtFrom: rangeStart,
              createdAtTo: now,
              limit: 250,
            },
            amoContext.baseUrl,
          )
        : [];

      const [totalCalls, pendingNotifications, activeIntegrations] = await Promise.all([
        prisma.call.count({
          where: {
            tenantId: ctx.tenantId,
            startedAt: {
              gte: rangeStart,
              lte: now,
            },
          },
        }),
        prisma.notification.count({
          where: {
            tenantId: ctx.tenantId,
            status: {
              in: ['pending', 'retrying'],
            },
            createdAt: {
              gte: rangeStart,
              lte: now,
            },
          },
        }),
        prisma.integration.count({
          where: {
            tenantId: ctx.tenantId,
            status: 'active',
          },
        }),
      ]);

      const reasonCounts = new Map<string, number>();
      const sourceCounts = new Map<string, number>();
      let qualifiedLeads = 0;
      let nonQualifiedLeads = 0;

      for (const lead of leads) {
        const reasonValue = extractLeadValue(lead, reasonFieldKey);
        const stageId = lead.status_id !== null && lead.status_id !== undefined ? String(lead.status_id) : null;
        const isQualifiedByStage = stageId ? qualifiedStageIds.includes(stageId) : false;
        const isQualified = qualifiedStageIds.length > 0
          ? isQualifiedByStage
          : isMappedValue(reasonValue, qualifiedValues);
        const isNonQualified = nonQualifiedValues.length > 0
          ? isMappedValue(reasonValue, nonQualifiedValues)
          : (!isQualified && Boolean(reasonValue));

        if (isQualified) {
          qualifiedLeads += 1;
        }

        if (isNonQualified) {
          nonQualifiedLeads += 1;
          if (reasonValue) {
            reasonCounts.set(reasonValue, (reasonCounts.get(reasonValue) ?? 0) + 1);
          }
        }

        if (sourceFieldKey) {
          const sourceValue = extractLeadValue(lead, sourceFieldKey) || 'Unknown source';
          sourceCounts.set(sourceValue, (sourceCounts.get(sourceValue) ?? 0) + 1);
        }
      }

      return {
        range: input.range,
        selectedPipelineIds: selectedPipelineIds || [],
        summary: {
          totalLeads: leads.length,
          qualifiedLeads,
          nonQualifiedLeads,
          totalCalls,
          pendingNotifications,
          activeIntegrations,
        },
        pieCharts: {
          nonQualifiedByReason: {
            fieldKey: reasonFieldKey,
            fieldLabel: reasonFieldKey ? (fieldLabelMap.get(reasonFieldKey) || humanizeKey(reasonFieldKey)) : null,
            data: toPieData(reasonCounts),
          },
          newLeadsBySource: {
            fieldKey: sourceFieldKey,
            fieldLabel: sourceFieldKey ? (fieldLabelMap.get(sourceFieldKey) || humanizeKey(sourceFieldKey)) : null,
            data: toPieData(sourceCounts),
          },
        },
        updatedAt: now.toISOString(),
      };
    }),

  fieldOptions: adminProcedure.query(async ({ ctx }) => {
    const catalogOptions = await collectCatalogFieldOptions(ctx.tenantId);
    const merged = new Map<string, LeadFieldOption>();

    for (const option of getSystemLeadFieldOptions()) {
      merged.set(option.key, option);
    }

    for (const option of catalogOptions) {
      merged.set(option.key, option);
    }

    return {
      options: Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }),

  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { settings: true },
    });

    if (!tenant) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tenant not found' });
    }

    const settings = asObject(tenant.settings);
    const dashboardSettings = asObject(settings?.dashboard);

    return {
      reasonFieldKey: typeof dashboardSettings?.reasonFieldKey === 'string' ? dashboardSettings.reasonFieldKey : null,
      sourceFieldKey: typeof dashboardSettings?.sourceFieldKey === 'string' ? dashboardSettings.sourceFieldKey : null,
      qualifiedStageIds: asStringArray(dashboardSettings?.qualifiedStageIds),
      qualifiedValues: asStringArray(dashboardSettings?.qualifiedValues),
      nonQualifiedValues: asStringArray(dashboardSettings?.nonQualifiedValues),
    };
  }),

  reasonValueOptions: adminProcedure
    .input(z.object({ fieldKey: z.string().optional(), pipelineIds: z.array(z.string()).optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!input?.fieldKey) {
        return { values: [] as string[] };
      }

      const amoContext = await getTenantAmoCRMContext(ctx.tenantId);
      if (!amoContext) {
        return { values: [] as string[] };
      }

      const selectedPipelineIds = input.pipelineIds && input.pipelineIds.length > 0
        ? input.pipelineIds
        : (amoContext.selectedPipelineIds || null);

      const leads = await amocrmService.fetchAllLeads(
        amoContext.accessToken,
        {
          pipelineIds: selectedPipelineIds,
          limit: 250,
        },
        amoContext.baseUrl,
      );

      const values = new Set<string>();
      for (const lead of leads) {
        const value = extractLeadValue(lead, input.fieldKey);
        if (value) {
          values.add(value);
        }
      }

      return {
        values: Array.from(values).sort((a, b) => a.localeCompare(b)),
      };
    }),
});
