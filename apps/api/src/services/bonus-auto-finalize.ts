import { prisma } from '@dashboarduz/db';
import {
  finalizeBonusMonth,
  getTashkentMonthKey,
  getTashkentMonthStart,
  SYSTEM_FINALIZER_USER_ID,
} from './bonus-engine';
import { log, LogLevel } from './observability';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

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
    prisma.tenant.findMany({ select: { id: true } }),
    prisma.bonusMonthSnapshot.findMany({ where: { month }, select: { tenantId: true } }),
  ]);
  const alreadyFinalized = new Set(finalized.map((snapshot) => snapshot.tenantId));
  let count = 0;
  for (const tenant of tenants) {
    if (alreadyFinalized.has(tenant.id)) continue;
    try {
      await finalizeBonusMonth({ tenantId: tenant.id, month, userId: SYSTEM_FINALIZER_USER_ID });
      count += 1;
      log(LogLevel.INFO, 'Bonus month auto-finalized', { tenantId: tenant.id, month: getTashkentMonthKey(month) });
    } catch (error: any) {
      // A parallel worker may have finalized it first (unique tenant+month); anything else is retried next hour.
      log(LogLevel.WARN, 'Bonus month auto-finalize failed', {
        tenantId: tenant.id,
        month: getTashkentMonthKey(month),
        error: error?.message || String(error),
      });
    }
  }
  return count;
}

export function startBonusAutoFinalizeScheduler(): void {
  if (timer) return;
  const run = () => {
    autoFinalizePreviousBonusMonth().catch((error: any) => {
      log(LogLevel.WARN, 'Bonus auto-finalize run failed', { error: error?.message || String(error) });
    });
  };
  run();
  timer = setInterval(run, CHECK_INTERVAL_MS);
}

export function stopBonusAutoFinalizeScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
