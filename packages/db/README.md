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

## Migrations in this change

All are safe on a live database with existing data and idempotent where
Postgres allows it. Each file's header says exactly what it does to data.

| Migration | What it does | Effect on existing data / locks |
| --- | --- | --- |
| `20261116100000_rls_transaction_local_context` | `app.set_tenant_context` becomes transaction-local by default (2-arg calls still work); every existing policy gets `WITH CHECK`; `user_auth_links` isolated by the owning user's tenant. | Catalog only. |
| `20261116100500_reconcile_startup_schema_patching` | Creates `corporate_call_durations` if missing (it was only created by the removed startup bootstrap); drops bootstrap-only indexes (`courses_category/startDate/endDate/isHiddenFromIncomeForm_idx`, `income_adjustment_requests_refundCardNumber_idx`); ensures `customers_historicalImportSessionId_idx`; drops `id`/`updatedAt` column defaults the schema does not declare. | No data change. Catalog only, except the index create if that index is missing (it exists wherever 20260323150000 ran). |
| `20261116101000_rls_policies_for_uncovered_tables` | Tenant isolation policies for `meta_ad_insights`, `analytics_ai_reports`, `historical_import_sessions`, `corporate_call_durations` and the four attendance tables. | Catalog only. |
| `20261116102000_add_missing_foreign_keys` | FKs (ON DELETE SET NULL) for customer profile course/tariff/sub-tariff, customer and income `historicalImportSessionId`, `analytics_ai_reports.userId`, `historical_import_sessions.fallbackManagerUserId`. | **Sets orphaned references to NULL** first. Constraints added NOT VALID, then validated (scan without blocking writes). |
| `20261116103000_meta_ad_insights_null_safe_unique` | `campaignId/adSetId/adId` NOT NULL DEFAULT ''; unique key recreated under a non-truncated name. | **Deletes duplicate insight rows** under the null-safe key (keeps the most recently updated), NULL → ''. `SET NOT NULL` scans under an exclusive lock (no rewrite). |
| `20261116104000_status_type_check_constraints` | CHECK constraints on integration type/status, income type, historical import status, bonus adjustment status, notification status, attendance action. | No data change. A constraint whose existing data does not fit is dropped again with a WARNING instead of failing. |
| `20261116105000_meta_ad_insights_decimal_money` | `spend/cpc/cpm` NUMERIC(18,4), `ctr` NUMERIC(12,6). | Values rounded to that scale. **Table rewrite** under an exclusive lock. |
| `20261116106000_drop_redundant_indexes` | Drops 22 indexes that are a left prefix of another index or unique key (list in the file). | Catalog only; brief lock per table. |
| `20261116107000_drop_user_google_id` | Drops unused `users.googleId` and its two indexes. | **Column values are lost** (expected to be empty; the file has the check query). |
| `20261116108000_clear_completed_historical_import_rows` | Nulls `incomeRows`/`customerRows` of historical import sessions in status `completed`. | **Deletes the stored raw spreadsheet rows** of completed imports only. |
| `20261118100000_call_manager_user_id` | Adds `calls.managerUserId` (FK to `users`, ON DELETE SET NULL) and index `(tenantId, managerUserId, startedAt)`; calls are attributed to managers by this column only. | **Backfills `managerUserId`** on existing calls (all providers): from `metadata.manager_user_id` (same tenant), else from `metadata.amocrm_user_id` via the one user mapped to that amoCRM user, else from the old Utel extension rule (100-150) against `users.utelManagerExternalId`. Rows none of these match stay NULL and are not counted. |
| `20261118110000_drop_utel_extension_mapping` | Drops `users.utelManagerExternalId` and its two indexes; recreates `integrations_type_check` without `voip_utel`. Runs after the backfill above. | **Stored extensions are lost** (the file has a query to copy them first). **Deletes `integrations` rows of type `voip_utel`.** `calls` rows with provider `utel` stay as history. |
| `20261120100000_contacts_amocrm_id_unique` | Adds `contacts.amocrmId` with a unique key `(tenantId, amocrmId)`; the amoCRM webhook upserts by it. | **Backfills `amocrmId`** from `externalIds.amocrm_id`. **Merges contacts of one tenant that share an amoCRM id**: keeps the most recently updated row, moves `leads.contactId` / `calls.contactId` to it, deletes the others. The unique index build holds a SHARE lock on `contacts` (writes wait; small table). Fails if a duplicate remains. |
| `20261120110000_webhook_events_null_tenant_system_only` | `webhook_events` rows with NULL tenant are no longer visible to tenant contexts; only `dashboarduz_system` reaches them (its `_system_access` policy from `rls-enforce.sql`). | No data change. Catalog only. No effect until RLS is enforced. |
| `20261120120000_money_tenant_safe_foreign_keys` | Unique `(tenantId, id)` on customers, users, incomes, bonus_month_snapshots, bonus_adjustments; the required money references (income → customer/manager, adjustment request → income/customer/requester, bonus lines/items/adjustments → snapshot, adjustment audits/applications → adjustment) become composite `(tenantId, …)` foreign keys, so a row cannot point at another tenant's parent. | No data change. **Fails** (rolls back) if an existing row already points across tenants. Unique index builds hold a SHARE lock (writes to those tables wait, seconds); FKs are added NOT VALID and validated without blocking writes. |
| `20261120130000_bonus_applied_percent_decimal` | `appliedPercent` of bonus snapshot lines/items: `double precision` → `NUMERIC(7,4)`. | **Rounds stored percents to 4 decimals** (bonus amounts are separate integers, unchanged). **Table rewrite** of both snapshot tables under an exclusive lock (small tables). |
| `20261120140000_status_check_constraints` | CHECKs: `calls.direction` ∈ inbound/outbound; `calls.status` ∈ completed/missed for provider `amocrm` (Utel history keeps its raw external status); `tenants.plan` ∈ free/pro/enterprise. | No data change. **Fails** (rolls back, naming the offending rows) if existing data does not fit, instead of skipping like 20261116104000. NOT VALID + VALIDATE: no write blocking. |
| `20261120150000_leads_tenant_created_at_index` | Index `leads(tenantId, createdAt)`. | `CREATE INDEX CONCURRENTLY` (single-statement file): writes are not blocked. |

## Tests

- `apps/api/src/__tests__/rls-policy-coverage.test.ts` (always runs): every
  model with `tenantId` has RLS and a tenant policy with `WITH CHECK`.
- `apps/api/src/__tests__/rls-isolation.integration.test.ts` runs only when
  `TEST_DATABASE_URL` is set. Point it at a **throwaway** database where
  `prisma migrate deploy` has run, as a superuser/BYPASSRLS owner. It runs
  `scripts/rls-enforce.sql` there and checks, as `dashboarduz_app` through
  `forTenant`, that tenant A cannot read or write tenant B and that the
  context does not leak between sequential or concurrent requests.
  Example: `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rls_test npx jest rls-isolation`
  (from `apps/api`).
- CI job **Integration tests with RLS enforced** (`.github/workflows/ci.yml`, `enforced-rls`) runs
  `rls-enforce.sql` on a throwaway Postgres, gives the two roles passwords and runs the isolation test and all
  money / concurrency integration tests with `DATABASE_URL` = `dashboarduz_app` and `DATABASE_SYSTEM_URL` =
  `dashboarduz_system` (set `TEST_DATABASE_APP_URL` / `TEST_DATABASE_SYSTEM_URL` to do the same locally).
  `rls-mode.integration.test.ts` fails it if the tests did not really run as those roles with FORCE on, or if
  any application table lacks RLS. A green job is the evidence that step 5 above is safe.
