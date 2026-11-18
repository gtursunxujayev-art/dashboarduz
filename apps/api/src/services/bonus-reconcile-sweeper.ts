import { forTenant, systemPrisma } from '@dashboarduz/db';

import { thrownText } from '../lib/errors';
import { createIntervalJob } from '../lib/interval-job';
import { logger } from '../lib/logger';

import { runRequestedBonusReconcile } from './customer-income/sale-chain';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** Markers younger than this belong to a request that is still reconciling right after its money change. */
const MIN_AGE_MS = 2 * 60 * 1000;

/**
 * Retries finalized-bonus reconciliations that a money change asked for but that did not complete (the reconcile
 * after the commit failed, or the process stopped before it ran). One run per tenant with open markers; a run that
 * fails again leaves the markers with the attempt recorded. Safe to run concurrently with request-time reconciles:
 * reconcileBonusMonth holds a per-month advisory lock and only clears the markers it read.
 */
export async function sweepBonusReconcileRequests(now = new Date()): Promise<{ tenants: number; failed: number }> {
  const stale = await systemPrisma.bonusReconcileRequest.findMany({
    where: { createdAt: { lt: new Date(now.getTime() - MIN_AGE_MS) } },
    select: { tenantId: true },
    distinct: ['tenantId'],
  });
  let failed = 0;

  for (const { tenantId } of stale) {
    const ok = await runRequestedBonusReconcile({ tenantId, actorUserId: null, context: { source: 'bonus-reconcile-sweeper' }, db: forTenant(tenantId) });

    if (!ok) failed += 1;
  }

  return { tenants: stale.length, failed };
}

const job = createIntervalJob({
  intervalMs: SWEEP_INTERVAL_MS,
  run: sweepBonusReconcileRequests,
  onError: (error) => {
    logger.warn({ error: thrownText(error) }, 'Bonus reconcile sweep failed');
  },
});

export function startBonusReconcileSweeper(): void {
  job.start();
}

export function stopBonusReconcileSweeper(): void {
  job.stop();
}
