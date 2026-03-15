import { prisma } from '@dashboarduz/db';
import { decryptIntegrationTokens } from '../security/encryption';

export type FieldOptionSource = 'catalog' | 'system';

export type LeadFieldOption = {
  key: string;
  label: string;
  source: FieldOptionSource;
};

export type TenantAmoCRMContext = {
  integrationId: string;
  accessToken: string;
  baseUrl?: string;
  config: Record<string, unknown>;
  selectedPipelineIds: string[] | null;
};

export function normalizeIdentifier(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function humanizeKey(input: string): string {
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

export function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function getSelectedPipelineIds(config: unknown): string[] | null {
  const source = asObject(config);
  if (!source || !Object.prototype.hasOwnProperty.call(source, 'selectedPipelineIds')) {
    return null;
  }

  if (!Array.isArray(source.selectedPipelineIds)) {
    return null;
  }

  return source.selectedPipelineIds
    .map((value) => String(value).trim())
    .filter(Boolean);
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item).trim())
    .filter(Boolean);
}

export function readMetadataKey(sourceValue: unknown, keyPath: string): unknown {
  const source = asObject(sourceValue);
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

export function readCustomFieldValue(sourceValue: unknown, customKey: string): unknown {
  const source = asObject(sourceValue);
  const fields = Array.isArray(source?.custom_fields_values) ? source.custom_fields_values : [];
  const target = customKey.replace(/^amocrm_custom:/, '');

  for (const field of fields as Array<Record<string, unknown>>) {
    const byCode = normalizeIdentifier(field.field_code);
    const byName = normalizeIdentifier(field.field_name);
    const byId = normalizeIdentifier(field.field_id);
    if (!target || (target !== byCode && target !== byName && target !== byId)) {
      continue;
    }

    const values = Array.isArray(field.values) ? field.values : [];
    const rawValues = values
      .map((value) => (value as Record<string, unknown> | undefined)?.value)
      .filter((value) => value !== null && value !== undefined);

    if (rawValues.length === 0) {
      return null;
    }

    return rawValues.length === 1 ? rawValues[0] : rawValues;
  }

  return null;
}

function toScalar(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => toScalar(item))
      .filter(Boolean) as string[];
    return normalized.length > 0 ? normalized.join(', ') : null;
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

export function extractLeadValue(leadPayload: unknown, fieldKey: string | null | undefined): string | null {
  if (!fieldKey) {
    return null;
  }

  if (fieldKey.startsWith('amocrm_custom:')) {
    return toScalar(readCustomFieldValue(leadPayload, fieldKey));
  }

  if (fieldKey.startsWith('metadata:')) {
    return toScalar(readMetadataKey(leadPayload, fieldKey));
  }

  return null;
}

export function getSystemLeadFieldOptions(): LeadFieldOption[] {
  return [
    { key: 'metadata:name', label: 'Lead Name', source: 'system' },
    { key: 'metadata:pipeline_id', label: 'Pipeline ID', source: 'system' },
    { key: 'metadata:status_id', label: 'Status ID', source: 'system' },
    { key: 'metadata:loss_reason_id', label: 'Loss Reason ID', source: 'system' },
    { key: 'metadata:source_id', label: 'Source ID', source: 'system' },
    { key: 'metadata:responsible_user_id', label: 'Responsible User ID', source: 'system' },
  ];
}

export async function getTenantAmoCRMContext(tenantId: string): Promise<TenantAmoCRMContext | null> {
  const integration = await prisma.integration.findUnique({
    where: {
      tenantId_type: {
        tenantId,
        type: 'amocrm',
      },
    },
    select: {
      id: true,
      status: true,
      tokensEncrypted: true,
      config: true,
    },
  });

  if (!integration || integration.status !== 'active' || !integration.tokensEncrypted) {
    return null;
  }

  const tokens = decryptIntegrationTokens<{ access_token?: string }>(integration.tokensEncrypted);
  if (!tokens.access_token) {
    return null;
  }

  const config = asObject(integration.config) || {};
  const baseUrl = typeof config.base_url === 'string' ? config.base_url : undefined;

  return {
    integrationId: integration.id,
    accessToken: tokens.access_token,
    baseUrl,
    config,
    selectedPipelineIds: getSelectedPipelineIds(config),
  };
}
