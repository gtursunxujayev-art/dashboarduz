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
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'users',
    'integrations',
    'telegram_recipients',
    'leads',
    'contacts',
    'calls',
    'notifications',
    'audit_logs',
    'customers',
    'courses',
    'tariffs',
    'sub_tariffs',
    'incomes',
    'income_adjustment_requests',
    'bonus_policy_versions',
    'bonus_month_snapshots',
    'bonus_snapshot_lines',
    'bonus_snapshot_items',
    'bonus_adjustments',
    'bonus_adjustment_audits',
    'bonus_adjustment_applications'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', tbl || '_isolation_policy', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING ("tenantId"::uuid = app.current_tenant_id()) WITH CHECK ("tenantId"::uuid = app.current_tenant_id())',
      tbl || '_isolation_policy',
      tbl
    );
  END LOOP;
END $$;

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
