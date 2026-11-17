import { AsyncLocalStorage } from 'node:async_hooks';

import { PrismaClient, type Prisma } from '@prisma/client';

/**
 * Database clients.
 *
 * - `forTenant(tenantId, userId)` returns a client whose every query runs in a
 *   transaction that first sets the Row Level Security context
 *   (`app.current_tenant` / `app.current_user`) with transaction-local
 *   `set_config(..., true)`. Use it for everything done on behalf of a
 *   logged-in user (tRPC exposes it as `ctx.db`).
 * - `systemPrisma` is the unscoped client for code that has no user: webhooks,
 *   workers, schedulers, login/registration and health checks. It connects with
 *   `DATABASE_SYSTEM_URL` when set (a role that bypasses RLS once enforcement
 *   is turned on, see packages/db/README.md), otherwise with `DATABASE_URL`.
 *
 * Tenant-scoped clients connect with `DATABASE_URL`.
 */

const logLevels: ('query' | 'error' | 'warn')[] =
  process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'];

function createClient(datasourceUrl?: string): PrismaClient {
  return new PrismaClient({
    log: logLevels,
    ...(datasourceUrl ? { datasourceUrl } : {}),
  });
}

const globalForPrisma = globalThis as unknown as {
  systemPrisma: PrismaClient | undefined;
  tenantBasePrisma: PrismaClient | undefined;
};

const systemUrl = process.env.DATABASE_SYSTEM_URL?.trim() || undefined;

/** Unscoped client for code paths with no logged-in user. */
export const systemPrisma: PrismaClient = globalForPrisma.systemPrisma ?? createClient(systemUrl);

/** Connection used underneath tenant-scoped clients (DATABASE_URL). */
const tenantBasePrisma: PrismaClient =
  globalForPrisma.tenantBasePrisma ?? (systemUrl ? createClient() : systemPrisma);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.systemPrisma = systemPrisma;
  globalForPrisma.tenantBasePrisma = tenantBasePrisma;
}

/** A tenant-scoped client. Same API as PrismaClient. */
export type TenantPrismaClient = PrismaClient;

/** Any client a data helper can run queries on: a full client or an interactive transaction. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

type RawCapable = Pick<PrismaClient, '$executeRaw'>;

// Set while a scoped batch `$transaction([...])` is executing, so the per-query
// wrapper does not open a nested transaction for the batch's own items.
const batchScope = new AsyncLocalStorage<boolean>();

function setTenantContextLocal(client: RawCapable, tenantId: string, userId: string | null) {
  return client.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true), set_config('app.current_user', ${userId ?? ''}, true)`;
}

export interface ForTenantOptions {
  /** Underlying client to use (tests). Defaults to the DATABASE_URL client. */
  client?: PrismaClient;
  /** Force the RLS context on or off; defaults to {@link isRlsContextEnabled}. */
  setContext?: boolean;
}

/**
 * Whether tenant clients set the RLS context. Setting it makes every single query a
 * `BEGIN; set_config; query; COMMIT` transaction (4+ round trips and a held connection), which
 * only buys anything once the app connects as the RLS-restricted role. Per the rollout in
 * README.md that happens only after `DATABASE_SYSTEM_URL` is set, so it is on from then on.
 * `DB_RLS_CONTEXT=on|off` overrides.
 */
export function isRlsContextEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.DB_RLS_CONTEXT?.trim().toLowerCase();
  if (flag === 'on' || flag === 'true' || flag === '1') return true;
  if (flag === 'off' || flag === 'false' || flag === '0') return false;
  return Boolean(env.DATABASE_SYSTEM_URL?.trim());
}

/**
 * Returns a client that runs every operation with the RLS context of `tenantId`
 * (and optionally `userId`) set transaction-locally, so the context can neither
 * be missing for a query nor leak to the next request on a pooled connection.
 *
 * - Single operations run as `BEGIN; set_config(...); <query>; COMMIT`.
 * - Batch `$transaction([...])` sets the context once at the start of the batch.
 * - Interactive `$transaction(async (tx) => ...)` sets the context at the start
 *   of that transaction; `tx` is a plain transaction client already in context.
 */
export function forTenant(
  tenantId: string,
  userId?: string | null,
  options: ForTenantOptions = {},
): TenantPrismaClient {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new Error('forTenant requires a tenantId');
  }

  const base = options.client ?? tenantBasePrisma;
  const user = userId && userId.trim().length > 0 ? userId : null;
  // An explicit test client exercises the RLS path unless told otherwise.
  const setContext = options.setContext ?? (options.client ? true : isRlsContextEnabled());

  if (!setContext) {
    // RLS is not enforced on this connection: queries go straight through, no wrapper transaction.
    return base;
  }

  const extended = base.$extends({
    name: 'tenant-scope',
    query: {
      async $allOperations({ args, query }) {
        if (batchScope.getStore() === true) {
          return query(args);
        }
        const [, result] = await base.$transaction([
          setTenantContextLocal(base, tenantId, user),
          query(args),
        ]);
        return result;
      },
    },
  });

  const scopedTransaction = (arg: unknown, txOptions?: unknown): Promise<unknown> => {
    if (typeof arg === 'function') {
      const callback = arg as (tx: unknown) => Promise<unknown>;
      return base.$transaction(async (tx) => {
        await setTenantContextLocal(tx, tenantId, user);
        return callback(tx);
      }, txOptions as Parameters<PrismaClient['$transaction']>[1]);
    }

    if (!Array.isArray(arg)) {
      return Promise.reject(new Error('$transaction expects an array or a callback'));
    }

    return batchScope.run(true, async () => {
      const results = await base.$transaction(
        [setTenantContextLocal(base, tenantId, user), ...(arg as never[])],
        txOptions as { isolationLevel?: never } | undefined,
      );
      return results.slice(1);
    });
  };

  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (prop === '$transaction') {
        return scopedTransaction;
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  }) as unknown as TenantPrismaClient;
}

// Export Prisma namespace types for downstream typing helpers.
export type { Prisma } from '@prisma/client';
