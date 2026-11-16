-- RLS hardening, part 1 (safe to apply on a live database).
--
-- * app.set_tenant_context() becomes transaction-local by default, so a context
--   set inside a transaction can no longer leak to the next request that reuses
--   the pooled connection. The 2-argument call form keeps working.
-- * Every existing isolation policy gets an explicit WITH CHECK clause so rows
--   cannot be inserted or moved into another tenant.
-- * user_auth_links is isolated by the owning user's tenant instead of by the
--   current user only (admins manage links of other users in their tenant).
--
-- Nothing here changes behaviour for the current connection role: as long as the
-- application connects as the table owner and FORCE ROW LEVEL SECURITY is off,
-- policies are not applied. Enforcement is a separate, manual step
-- (packages/db/scripts/rls-enforce.sql, see packages/db/README.md).
-- Only catalog changes; no table rewrite, no data change.

CREATE SCHEMA IF NOT EXISTS app;

DROP FUNCTION IF EXISTS app.set_tenant_context(uuid, uuid);
DROP FUNCTION IF EXISTS app.set_tenant_context(uuid, uuid, boolean);

CREATE FUNCTION app.set_tenant_context(
  tenant_uuid uuid,
  user_uuid uuid DEFAULT NULL,
  is_local boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.current_tenant', COALESCE(tenant_uuid::text, ''), is_local);
  PERFORM set_config('app.current_user', COALESCE(user_uuid::text, ''), is_local);
END;
$$;

COMMENT ON FUNCTION app.set_tenant_context(uuid, uuid, boolean) IS
  'Sets tenant/user context for RLS policies. Transaction-local unless is_local = false.';

CREATE OR REPLACE FUNCTION app.clear_tenant_context()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.current_tenant', '', false);
  PERFORM set_config('app.current_user', '', false);
END;
$$;

-- Tenant-keyed tables that already had a policy: recreate with WITH CHECK.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_isolation_policy ON "users";
CREATE POLICY users_isolation_policy ON "users"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integrations_isolation_policy ON "integrations";
CREATE POLICY integrations_isolation_policy ON "integrations"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "telegram_recipients" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS telegram_recipients_isolation_policy ON "telegram_recipients";
CREATE POLICY telegram_recipients_isolation_policy ON "telegram_recipients"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS leads_isolation_policy ON "leads";
CREATE POLICY leads_isolation_policy ON "leads"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contacts_isolation_policy ON "contacts";
CREATE POLICY contacts_isolation_policy ON "contacts"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "calls" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calls_isolation_policy ON "calls";
CREATE POLICY calls_isolation_policy ON "calls"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_isolation_policy ON "notifications";
CREATE POLICY notifications_isolation_policy ON "notifications"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_isolation_policy ON "audit_logs";
CREATE POLICY audit_logs_isolation_policy ON "audit_logs"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customers_isolation_policy ON "customers";
CREATE POLICY customers_isolation_policy ON "customers"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS courses_isolation_policy ON "courses";
CREATE POLICY courses_isolation_policy ON "courses"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "tariffs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tariffs_isolation_policy ON "tariffs";
CREATE POLICY tariffs_isolation_policy ON "tariffs"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "sub_tariffs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sub_tariffs_isolation_policy ON "sub_tariffs";
CREATE POLICY sub_tariffs_isolation_policy ON "sub_tariffs"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "incomes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS incomes_isolation_policy ON "incomes";
CREATE POLICY incomes_isolation_policy ON "incomes"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "income_adjustment_requests" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS income_adjustment_requests_isolation_policy ON "income_adjustment_requests";
CREATE POLICY income_adjustment_requests_isolation_policy ON "income_adjustment_requests"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "bonus_policy_versions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bonus_policy_versions_isolation_policy ON "bonus_policy_versions";
CREATE POLICY bonus_policy_versions_isolation_policy ON "bonus_policy_versions"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "bonus_month_snapshots" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bonus_month_snapshots_isolation_policy ON "bonus_month_snapshots";
CREATE POLICY bonus_month_snapshots_isolation_policy ON "bonus_month_snapshots"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "bonus_snapshot_lines" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bonus_snapshot_lines_isolation_policy ON "bonus_snapshot_lines";
CREATE POLICY bonus_snapshot_lines_isolation_policy ON "bonus_snapshot_lines"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "bonus_snapshot_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bonus_snapshot_items_isolation_policy ON "bonus_snapshot_items";
CREATE POLICY bonus_snapshot_items_isolation_policy ON "bonus_snapshot_items"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "bonus_adjustments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bonus_adjustments_isolation_policy ON "bonus_adjustments";
CREATE POLICY bonus_adjustments_isolation_policy ON "bonus_adjustments"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "bonus_adjustment_audits" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bonus_adjustment_audits_isolation_policy ON "bonus_adjustment_audits";
CREATE POLICY bonus_adjustment_audits_isolation_policy ON "bonus_adjustment_audits"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "bonus_adjustment_applications" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bonus_adjustment_applications_isolation_policy ON "bonus_adjustment_applications";
CREATE POLICY bonus_adjustment_applications_isolation_policy ON "bonus_adjustment_applications"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenants_isolation_policy ON "tenants";
CREATE POLICY tenants_isolation_policy ON "tenants"
  FOR ALL
  USING ("id"::uuid = app.current_tenant_id())
  WITH CHECK ("id"::uuid = app.current_tenant_id());

-- Webhook events without a tenant (unmatched deliveries) stay visible to every
-- tenant context, as before; writes may only target the current tenant or NULL.
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_events_isolation_policy ON "webhook_events";
CREATE POLICY webhook_events_isolation_policy ON "webhook_events"
  FOR ALL
  USING ("tenantId" IS NULL OR "tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId" IS NULL OR "tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "user_auth_links" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_auth_links_isolation_policy ON "user_auth_links";
CREATE POLICY user_auth_links_isolation_policy ON "user_auth_links"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "users" u
      WHERE u."id" = "user_auth_links"."userId"
        AND u."tenantId"::uuid = app.current_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "users" u
      WHERE u."id" = "user_auth_links"."userId"
        AND u."tenantId"::uuid = app.current_tenant_id()
    )
  );
