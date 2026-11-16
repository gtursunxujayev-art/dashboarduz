# @dashboarduz/db

Prisma schema, migrations and database clients.

## Clients

| Export | Use for | Connects with |
| --- | --- | --- |
| `forTenant(tenantId, userId)` | Everything done for a logged-in user. tRPC protected procedures get it as `ctx.db`. | `DATABASE_URL` |
| `systemPrisma` | Code with no user: webhooks, workers, schedulers, login/registration/OTP, health checks, scripts. | `DATABASE_SYSTEM_URL`, falling back to `DATABASE_URL` |

`forTenant` wraps every operation in a transaction that first runs
`set_config('app.current_tenant', …, true)` and `set_config('app.current_user', …, true)`.
The settings are transaction-local, so they cannot leak to the next request that
reuses a pooled connection, and they are in place for every query, including
batch `$transaction([...])` and interactive `$transaction(async (tx) => …)`
(set once at the start of that transaction). The cost is one extra statement
per query and one transaction per non-transactional query.

There is deliberately no generic `prisma` export any more: pick one of the two.

## Row Level Security rollout

RLS policies exist for every table with a `tenantId` (a unit test,
`apps/api/src/__tests__/rls-policy-coverage.test.ts`, fails if a model is
missing one). They are **not enforced yet**: the application connects as the
table owner, and policies do not apply to the owner unless the table has
`FORCE ROW LEVEL SECURITY`.

Enforcement is a manual step because it changes production behaviour. Order:

1. **Deploy the code** from this branch. It sets the context through
   `set_config` directly, so it works before and after the migrations.
2. **Apply migrations** as the owner role:
   `DATABASE_URL=<owner url> npm run db:migrate:deploy`.
   The new migrations only change catalog objects, constraints and indexes; see
   "Migrations in this change" below for what each one does to existing data.
3. **Check the owner can bypass RLS**:
   `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;`
   One of them must be true (Railway's `postgres` user is a superuser; on Neon
   check the owner role). Otherwise do not continue: with FORCE on, data
   migrations run by the owner would see zero rows.
4. **Run the enforcement script** as the owner:
   `psql "<owner url>" -v ON_ERROR_STOP=1 -f packages/db/scripts/rls-enforce.sql`.
   It creates the roles `dashboarduz_app` (subject to RLS) and
   `dashboarduz_system` (sees all tenants through an explicit
   `<table>_system_access` policy), grants them DML, and turns FORCE on.
   Then set passwords: `ALTER ROLE dashboarduz_app PASSWORD '…';` and the same
   for `dashboarduz_system` (keep them out of the repo).
5. **Switch the API and worker connection strings** (both services):
   - `DATABASE_SYSTEM_URL` = URL with `dashboarduz_system`
   - `DATABASE_URL` = URL with `dashboarduz_app`

   Set `DATABASE_SYSTEM_URL` first: until it is set, `systemPrisma` falls back
   to `DATABASE_URL`, and webhooks, workers, schedulers and login would run as
   the RLS-restricted role and see nothing.
   Keep running migrations with the owner URL (step 2), never with these.
6. **Smoke test**: log in, open dashboards for two tenants, trigger a webhook,
   let one scheduler run. A missing context shows up as empty results (reads)
   or `new row violates row-level security policy` (writes).
7. After every later migration that adds a table, re-run the enforcement
   script (it is idempotent) so the new table gets FORCE and a system policy.

### Rollback

- Fast: point `DATABASE_URL` back to the owner URL, unset
  `DATABASE_SYSTEM_URL`, redeploy. The owner bypasses RLS (checked in step 3),
  so neither the policies nor FORCE affect the application any more.
- Full: run `packages/db/scripts/rls-enforce-rollback.sql` as the owner. It
  turns FORCE off and removes the system policies; roles stay until dropped
  by hand.
- The migrations themselves need no rollback for this: they do not enforce
  anything on the owner.
