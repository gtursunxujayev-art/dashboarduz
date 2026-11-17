-- Webhook events without a tenant (unmatched deliveries: unknown account, bad signature, ...) become visible
-- only to the system role.
--
-- Before: the isolation policy let every tenant context read and write rows with "tenantId" IS NULL, so once
-- RLS is enforced any logged-in tenant could see other companies' unmatched webhook payloads.
-- After: a tenant context sees and writes only its own rows. NULL-tenant rows are reached only through the
-- dashboarduz_system role (DATABASE_SYSTEM_URL), whose "webhook_events_system_access" policy is created by
-- packages/db/scripts/rls-enforce.sql for every RLS table. Webhook receivers and the retention job already
-- use systemPrisma; the only tenant-scoped reader (FaceID integration status) filters by its own tenantId.
--
-- No data change. Catalog-only (DROP/CREATE POLICY): a brief ACCESS EXCLUSIVE lock on webhook_events while the
-- policy is swapped, no table scan. Has no effect until RLS is enforced (owner connections bypass policies).

ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_events_isolation_policy ON "webhook_events";
CREATE POLICY webhook_events_isolation_policy ON "webhook_events"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());
