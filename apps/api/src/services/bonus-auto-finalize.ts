import { systemPrisma } from '@dashboarduz/db';
import { TASHKENT_OFFSET_MS } from '@dashboarduz/shared';

import { createIntervalJob } from '../lib/interval-job';
import { logger } from '../lib/logger';

import {
  finalizeBonusMonth,
  getTashkentMonthKey,
  getTashkentMonthStart,
  SYSTEM_FINALIZER_USER_ID,
} from './bonus-engine';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Start of the previous Tashkent calendar month relative to `now`. */
export function getPreviousTashkentMonthStart(now: Date): Date {
  const currentMonthStart = getTashkentMonthStart(now);
  const shifted = new Date(currentMonthStart.getTime() + TASHKENT_OFFSET_MS);

  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1) - TASHKENT_OFFSET_MS);
}

/**
 * Freezes last month's bonus for every tenant that has not finalized it yet. Once frozen, later edits to that month
 * (refunds, tariff changes, backdated payments) show up as bonus adjustments to approve instead of silently moving money.
 */
export async function autoFinalizePreviousBonusMonth(now = new Date()): Promise<number> {
  const month = getPreviousTashkentMonthStart(now);
  const [tenants, finalized] = await Promise.all([
    systemPrisma.tenant.findMany({ select: { id: true } }),
    systemPrisma.bonusMonthSnapshot.findMany({ where: { month }, select: { tenantId: true } }),
  ]);
  const alreadyFinalized = new Set(finalized.map((snapshot) => snapshot.tenantId));
  let count = 0;

  for (const tenant of tenants) {
    if (alreadyFinalized.has(tenant.id)) continue;
    try {
      await finalizeBonusMonth({ tenantId: tenant.id, month, userId: SYSTEM_FINALIZER_USER_ID, db: systemPrisma });
      count += 1;
      logger.info({ tenantId: tenant.id, month: getTashkentMonthKey(month) }, 'Bonus month auto-finalized');
    } catch (error: unknown) {
      // A parallel worker may have finalized it first (unique tenant+month); anything else is retried next hour.
      logger.warn({
        tenantId: tenant.id,
        month: getTashkentMonthKey(month),
        error: (error as { message?: string } | null)?.message || String(error),
      }, 'Bonus month auto-finalize failed');
    }
  }

  return count;
}

const job = createIntervalJob({
  intervalMs: CHECK_INTERVAL_MS,
  run: autoFinalizePreviousBonusMonth,
  onError: (error) => {
    logger.warn({ error: (error as { message?: string } | null)?.message || String(error) }, 'Bonus auto-finalize run failed');
  },
});

export function startBonusAutoFinalizeScheduler(): void {
  job.start();
}

export function stopBonusAutoFinalizeScheduler(): void {
  job.stop();
}
