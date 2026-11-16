import { logger } from '../../lib/logger';

type SummarySourceStatusKey = 'amoContext' | 'catalog' | 'leads' | 'activity' | 'corporateCalls';

type SummarySourceStatusEntry = {
  ok: boolean;
  retried: boolean;
  reason: string | null;
  state: 'ok' | 'partial' | 'unavailable' | 'timeout' | 'mapping_missing';
};

type SummarySourceStatus = Record<SummarySourceStatusKey, SummarySourceStatusEntry>;

export function createSummarySourceStatus(): SummarySourceStatus {
  return {
    amoContext: { ok: true, retried: false, reason: null, state: 'ok' },
    catalog: { ok: true, retried: false, reason: null, state: 'ok' },
    leads: { ok: true, retried: false, reason: null, state: 'ok' },
    activity: { ok: true, retried: false, reason: null, state: 'ok' },
    corporateCalls: { ok: true, retried: false, reason: null, state: 'ok' },
  };
}

function detectSummarySourceReason(error: unknown, fallback: string): string {
  const message = String((error as Error | undefined)?.message || '');

  if (message.includes('Failed to decrypt integration tokens')) {
    return 'decrypt_failed';
  }
  if (message.toLowerCase().includes('timeout')) {
    return 'timeout';
  }
  const lower = message.toLowerCase();

  if (!lower.startsWith('failed to fetch amocrm') && (lower.includes('network') || lower.includes('fetch failed'))) {
    return 'network_error';
  }

  return fallback;
}

export async function runSummarySourceWithRetry<T>(params: {
  key: SummarySourceStatusKey;
  status: SummarySourceStatus;
  logContext: { tenantId: string; userId: string };
  reasonFallback: string;
  fallback: T;
  run: () => Promise<T>;
}): Promise<T> {
  const { key, status, logContext, reasonFallback, fallback, run } = params;

  try {
    return await run();
  } catch (firstError) {
    status[key].retried = true;
    try {
      return await run();
    } catch (secondError) {
      const reason = detectSummarySourceReason(secondError || firstError, reasonFallback);

      status[key].ok = false;
      status[key].reason = reason;
      status[key].state = reason === 'timeout' ? 'timeout' : 'unavailable';
      logger.warn({
        ...logContext,
        reason,
        error: String((secondError as Error | undefined)?.message || (firstError as Error | undefined)?.message || secondError || firstError),
      }, `Dashboard summary source degraded: ${key}`);

      return fallback;
    }
  }
}
