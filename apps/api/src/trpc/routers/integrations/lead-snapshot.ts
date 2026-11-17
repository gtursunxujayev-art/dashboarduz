import { TRPCError } from '@trpc/server';

import { logger } from '../../../lib/logger';
import {
  isLeadSnapshotRefreshRunning,
  LEAD_SNAPSHOT_REFRESH_INTERVAL_MS,
  readLeadSnapshotState,
  refreshTenantLeadSnapshot,
} from '../../../services/integrations/amocrm-lead-snapshot';
import { rateLimiter } from '../../../services/security/rate-limiter';
import { adminProcedure, protectedProcedure } from '../../trpc';

/** Manual refreshes per tenant per window (the hourly refresh does not count). */
const MANUAL_REFRESH_LIMIT = { maxRequests: 3, windowMs: 10 * 60 * 1000, keyPrefix: 'amocrm-lead-snapshot' };
/** How long the mutation waits for the refresh before answering; a longer one keeps running. */
const MANUAL_REFRESH_WAIT_MS = 20_000;

export const leadSnapshotProcedures = {
  /** When the tenant's amoCRM lead snapshot was last refreshed, for the dashboard's refresh button. */
  getAmoLeadSnapshotStatus: protectedProcedure.query(async ({ ctx }) => {
    const integration = await ctx.db.integration.findUnique({
      where: { tenantId_type: { tenantId: ctx.tenantId, type: 'amocrm' } },
      select: { status: true, config: true },
    });
    const state = readLeadSnapshotState(integration?.config);

    return {
      connected: integration?.status === 'active',
      lastRefreshedAt: state.lastRefreshedAt,
      lastError: state.lastError,
      leadCount: state.leadCount,
      refreshing: integration?.status === 'active' ? await isLeadSnapshotRefreshRunning(ctx.tenantId) : false,
      refreshIntervalMinutes: LEAD_SNAPSHOT_REFRESH_INTERVAL_MS / 60_000,
    };
  }),

  /** Admin-only "refresh now": pulls amoCRM leads into the snapshot right away. */
  refreshAmoLeadSnapshot: adminProcedure.mutation(async ({ ctx }) => {
    const limit = await rateLimiter.isAllowed(ctx.tenantId, 'amocrm:lead-snapshot-refresh', MANUAL_REFRESH_LIMIT);

    if (!limit.allowed) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: "Ma'lumotlar yaqinda yangilandi. Birozdan keyin qayta urinib ko'ring.",
      });
    }

    const refresh = refreshTenantLeadSnapshot(ctx.tenantId);

    // The refresh records its own failure in the snapshot state; don't leave the promise unhandled.
    refresh.catch((error) => {
      logger.warn({ tenantId: ctx.tenantId, error: String((error as Error | undefined)?.message || error) }, 'Manual amoCRM lead snapshot refresh failed');
    });

    let timer: NodeJS.Timeout | undefined;
    const waited = await Promise.race([
      refresh.then((outcome) => ({ kind: 'done' as const, outcome }), (error: unknown) => ({ kind: 'failed' as const, error })),
      new Promise<{ kind: 'pending' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'pending' }), MANUAL_REFRESH_WAIT_MS);
      }),
    ]);

    clearTimeout(timer);

    if (waited.kind === 'pending') return { status: 'running' as const, refreshedAt: null };
    if (waited.kind === 'failed') {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: "amoCRM ma'lumotlarini yangilab bo'lmadi. Keyinroq qayta urinib ko'ring.",
      });
    }
    if (waited.outcome.status === 'not_connected') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'amoCRM ulanmagan.' });
    }
    if (waited.outcome.status === 'already_running') return { status: 'running' as const, refreshedAt: null };

    await ctx.db.auditLog.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.user.userId,
        action: 'integration_sync',
        resource: 'integration',
        metadata: { type: 'amocrm', target: 'lead_snapshot', mode: waited.outcome.result.mode, fetched: waited.outcome.result.fetched },
      },
    });

    return { status: 'refreshed' as const, refreshedAt: waited.outcome.result.refreshedAt };
  }),
};
