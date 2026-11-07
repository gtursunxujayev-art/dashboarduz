// Which provider's rows in the `calls` table the dashboards count: Utel webhooks (default) or calls imported from amoCRM.
// Only one is counted at a time — Utel calls are usually also logged in amoCRM, so adding both would double them.
import { prisma } from '@dashboarduz/db';

import { buildCacheKey, getOrSet, invalidateCache } from './cache';

export type CallsSource = 'utel' | 'amocrm';

export const UTEL_CALL_PROVIDER = 'utel';
export const AMOCRM_CALL_PROVIDER = 'amocrm';

/** Key in the amoCRM integration config that holds the chosen source. */
export const CALLS_SOURCE_CONFIG_KEY = 'calls_source';

export function readCallsSource(config: unknown): CallsSource {
  const value = config && typeof config === 'object' ? (config as Record<string, unknown>)[CALLS_SOURCE_CONFIG_KEY] : null;

  return value === 'amocrm' ? 'amocrm' : 'utel';
}

function callsProviderCacheKey(tenantId: string): string {
  return buildCacheKey('callsProvider', { t: tenantId });
}

/** The `Call.provider` value every call count should filter on for this tenant. */
export async function getCallsProvider(tenantId: string): Promise<string> {
  return getOrSet(callsProviderCacheKey(tenantId), 60, async () => {
    const integration = await prisma.integration.findUnique({
      where: { tenantId_type: { tenantId, type: 'amocrm' } },
      select: { status: true, config: true },
    });

    if (integration?.status === 'active' && readCallsSource(integration.config) === 'amocrm') {
      return AMOCRM_CALL_PROVIDER;
    }

    return UTEL_CALL_PROVIDER;
  });
}

export async function invalidateCallsProvider(tenantId: string): Promise<void> {
  await invalidateCache(callsProviderCacheKey(tenantId));
}

/**
 * Filter for queries that used to count every provider: amoCRM rows only when amoCRM is the source,
 * otherwise everything except amoCRM rows (so other webhook providers keep counting as before).
 */
export async function getCallsProviderFilter(tenantId: string): Promise<string | { not: string }> {
  const provider = await getCallsProvider(tenantId);

  return provider === AMOCRM_CALL_PROVIDER ? provider : { not: AMOCRM_CALL_PROVIDER };
}
