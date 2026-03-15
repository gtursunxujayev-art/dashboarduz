import { prisma } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { amocrmService } from '../../services/integrations/amocrm';
import { decryptIntegrationTokens } from '../../services/security/encryption';
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

type FieldOption = {
  key: string;
  label: string;
  source: 'catalog' | 'metadata';
};

type LeadMetadata = Record<string, unknown> | null | undefined;

function normalizeIdentifier(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function humanizeKey(input: string): string {
  const normalized = input.replace(/[:_.]+/g, ' ').trim();
  if (!normalized) {
    return 'Unknown';
  }

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getRangeStart(range: DashboardRange, now: Date): Date {
  if (range === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  if (range === 'week') {
    const day = now.getDay(); // 0 Sunday ... 6 Saturday
    const daysSinceMonday = (day + 6) % 7;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
  }

  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function buildLeadRangeWhere(tenantId: string, start: Date, end: Date): Prisma.LeadWhereInput {
  return {
    tenantId,
    amocrmId: {
      not: null,
    },
    OR: [
      {
        externalCreatedAt: {
          gte: start,
          lte: end,
        },
      },
      {
        externalCreatedAt: null,
        createdAt: {
          gte: start,
          lte: end,
        },
      },
    ],
  };
}

function readMetadataKey(metadata: LeadMetadata, keyPath: string): unknown {
  const source = asObject(metadata);
  if (!source) {
    return null;
  }

  const path = keyPath.replace(/^metadata:/, '').split('.').filter(Boolean);
  let current: unknown = source;
  for (const part of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current ?? null;
}

function readCustomFieldValue(metadata: LeadMetadata, customKey: string): unknown {
  const source = asObject(metadata);
  const fields = Array.isArray(source?.custom_fields_values) ? source?.custom_fields_values : [];
  const target = customKey.replace(/^amocrm_custom:/, '');

  for (const field of fields as Array<Record<string, unknown>>) {
    const byCode = normalizeIdentifier(field.field_code);
    const byName = normalizeIdentifier(field.field_name);
    const byId = normalizeIdentifier(field.field_id);
    if (!target || (target !== byCode && target !== byName && target !== byId)) {
      continue;
    }

    const values = Array.isArray(field.values) ? field.values : [];
    const firstValue = (values[0] as Record<string, unknown> | undefined)?.value;
    return firstValue ?? null;
  }

  return null;
}

function toScalar(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
}

function extractLeadValue(metadata: LeadMetadata, fieldKey: string | null | undefined): string | null {
  if (!fieldKey) {
    return null;
  }

  if (fieldKey.startsWith('amocrm_custom:')) {
    return toScalar(readCustomFieldValue(metadata, fieldKey));
  }

  if (fieldKey.startsWith('metadata:')) {
    return toScalar(readMetadataKey(metadata, fieldKey));
  }

  return null;
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

function collectMetadataFieldOptions(metadataList: LeadMetadata[]): FieldOption[] {
  const options = new Map<string, FieldOption>();

  for (const metadata of metadataList) {
    const source = asObject(metadata);
    if (!source) {
      continue;
    }

    for (const [key, value] of Object.entries(source)) {
      if (key === 'custom_fields_values' || key === '_embedded') {
        continue;
      }

      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        const fieldKey = `metadata:${key}`;
        options.set(fieldKey, {
          key: fieldKey,
          label: humanizeKey(key),
          source: 'metadata',
        });
      }
    }

    const customFields = Array.isArray(source.custom_fields_values) ? source.custom_fields_values : [];
    for (const field of customFields as Array<Record<string, unknown>>) {
      const identifier = normalizeIdentifier(field.field_code || field.field_name || field.field_id);
      if (!identifier) {
        continue;
      }

      const fieldKey = `amocrm_custom:${identifier}`;
      const label = String(field.field_name || field.field_code || field.field_id || identifier);
      options.set(fieldKey, {
        key: fieldKey,
        label,
        source: 'metadata',
      });
    }
  }

  return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label));
}

async function collectCatalogFieldOptions(tenantId: string): Promise<FieldOption[]> {
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'amocrm',
      },
    },
    select: {
      status: true,
      tokensEncrypted: true,
      config: true,
    },
  });

  if (!integration || integration.status !== 'active' || !integration.tokensEncrypted) {
    return [];
  }

  try {
    const tokens = decryptIntegrationTokens<{ access_token?: string }>(integration.tokensEncrypted);
    if (!tokens.access_token) {
      return [];
    }

    const config = asObject(integration.config);
    const baseUrl = typeof config?.base_url === 'string' ? config.base_url : undefined;
    const catalog = await amocrmService.fetchLeadCustomFields(tokens.access_token, baseUrl);
    const fields = Array.isArray(catalog?._embedded?.custom_fields) ? catalog._embedded.custom_fields : [];

    const options: FieldOption[] = [];
    for (const field of fields as Array<Record<string, unknown>>) {
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

export const dashboardRouter = router({
  summary: protectedProcedure
    .input(z.object({ range: dashboardRangeSchema }))
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const rangeStart = getRangeStart(input.range, now);
      const rangeEnd = now;

      const [tenant, filteredLeads, totalCalls, pendingNotifications, activeIntegrations] = await Promise.all([
        prisma.tenant.findUnique({
          where: { id: ctx.tenantId },
          select: { settings: true },
        }),
        prisma.lead.findMany({
          where: buildLeadRangeWhere(ctx.tenantId, rangeStart, rangeEnd),
          select: {
            metadata: true,
          },
        }),
        prisma.call.count({
          where: {
            tenantId: ctx.tenantId,
            startedAt: {
              gte: rangeStart,
              lte: rangeEnd,
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
              lte: rangeEnd,
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

      const settings = asObject(tenant?.settings);
      const dashboardSettings = asObject(settings?.dashboard);
      const reasonFieldKey = typeof dashboardSettings?.reasonFieldKey === 'string' ? dashboardSettings.reasonFieldKey : null;
      const sourceFieldKey = typeof dashboardSettings?.sourceFieldKey === 'string' ? dashboardSettings.sourceFieldKey : null;

      const reasonCounts = new Map<string, number>();
      const sourceCounts = new Map<string, number>();

      for (const lead of filteredLeads) {
        const reasonValue = extractLeadValue(lead.metadata as LeadMetadata, reasonFieldKey);
        if (reasonValue) {
          reasonCounts.set(reasonValue, (reasonCounts.get(reasonValue) ?? 0) + 1);
        }

        if (sourceFieldKey) {
          const sourceValue = extractLeadValue(lead.metadata as LeadMetadata, sourceFieldKey) || 'Unknown source';
          sourceCounts.set(sourceValue, (sourceCounts.get(sourceValue) ?? 0) + 1);
        }
      }

      return {
        range: input.range,
        summary: {
          totalLeads: filteredLeads.length,
          totalCalls,
          pendingNotifications,
          activeIntegrations,
        },
        pieCharts: {
          nonQualifiedByReason: {
            fieldKey: reasonFieldKey,
            fieldLabel: reasonFieldKey ? humanizeKey(reasonFieldKey) : null,
            data: toPieData(reasonCounts),
          },
          newLeadsBySource: {
            fieldKey: sourceFieldKey,
            fieldLabel: sourceFieldKey ? humanizeKey(sourceFieldKey) : null,
            data: toPieData(sourceCounts),
          },
        },
        updatedAt: now.toISOString(),
      };
    }),

  fieldOptions: adminProcedure.query(async ({ ctx }) => {
    const metadataPromise = prisma.lead.findMany({
      where: { tenantId: ctx.tenantId },
      select: { metadata: true },
      orderBy: { updatedAt: 'desc' },
      take: 2000,
    });

    const [catalogOptions, metadataLeads] = await Promise.all([
      collectCatalogFieldOptions(ctx.tenantId),
      metadataPromise,
    ]);

    const merged = new Map<string, FieldOption>();
    for (const option of catalogOptions) {
      merged.set(option.key, option);
    }

    for (const option of collectMetadataFieldOptions(metadataLeads.map((lead) => lead.metadata as LeadMetadata))) {
      if (!merged.has(option.key)) {
        merged.set(option.key, option);
      }
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
    };
  }),
});
