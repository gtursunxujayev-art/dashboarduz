import type { DbClient } from '@dashboarduz/db';

import { getAmoReference } from '../integrations/amocrm-activity-snapshot-read';
import { type LeadFieldOption, normalizeIdentifier } from '../integrations/amocrm-live';

export const PIE_COLORS = [
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

export function toPieData(input: Map<string, number>) {
  return Array.from(input.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({
      name,
      value,
      color: PIE_COLORS[index % PIE_COLORS.length],
    }));
}

export function buildFieldLabelMap(options: LeadFieldOption[]): Map<string, string> {
  const labels = new Map<string, string>();

  for (const option of options) {
    labels.set(option.key, option.label);
  }

  return labels;
}

export async function collectCatalogFieldOptions(tenantId: string, db: DbClient): Promise<LeadFieldOption[]> {
  const context = await (await import('../integrations/amocrm-live')).getTenantAmoCRMContext(tenantId, db);

  if (!context) {
    return [];
  }

  try {
    const catalog = await getAmoReference(tenantId, 'lead_custom_fields', context, db);
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

export function isMappedValue(value: string | null, targetValues: string[]): boolean {
  if (!value) {
    return false;
  }

  const normalizedValue = value.trim().toLowerCase();

  return targetValues.some((target) => target.trim().toLowerCase() === normalizedValue);
}

export function normalizeCourseCategoryName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function classifyCourseCategory(
  courseName: string | null | undefined,
): 'online' | 'offline' | 'intensive' | 'additional_service' | 'other' {
  const normalized = normalizeCourseCategoryName(courseName);

  if (!normalized) {
    return 'other';
  }

  if (
    normalized.includes('online')
    || normalized.includes('onlayn')
    || normalized.includes('онлайн')
  ) {
    return 'online';
  }

  if (
    normalized.includes('offline')
    || normalized.includes('oflayn')
    || normalized.includes('офлайн')
  ) {
    return 'offline';
  }

  if (
    normalized.includes('intensive')
    || normalized.includes('intensiv')
    || normalized.includes('интенсив')
  ) {
    return 'intensive';
  }

  if (
    normalized.includes('additional_service')
    || normalized.includes('additional service')
    || normalized.includes("qo'shimcha")
    || normalized.includes('qoshimcha')
    || normalized.includes('talaba')
    || normalized.includes('korporativ')
    || normalized.includes("o'quv quroli")
    || normalized.includes('quroli')
    || normalized.includes('konsultatsiya')
    || normalized.includes("tog' darsi")
    || normalized.includes('sayohat')
    || normalized.includes('obuna')
  ) {
    return 'additional_service';
  }

  return 'other';
}

export function classifyCourseCategoryFromField(
  category: string | null | undefined,
): 'online' | 'offline' | 'intensive' | 'additional_service' | 'other' {
  const normalized = String(category || '').trim().toLowerCase();

  if (
    normalized === 'online'
    || normalized === 'offline'
    || normalized === 'intensive'
    || normalized === 'additional_service'
  ) {
    return normalized;
  }

  return classifyCourseCategory(category);
}
