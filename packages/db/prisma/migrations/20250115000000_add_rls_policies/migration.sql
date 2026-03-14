-- Canonical RLS setup for multi-tenant isolation

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.set_tenant_context(tenant_uuid uuid, user_uuid uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.current_tenant', tenant_uuid::text, false);
  IF user_uuid IS NOT NULL THEN
    PERFORM set_config('app.current_user', user_uuid::text, false);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app.clear_tenant_context()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.current_tenant', '', false);
  PERFORM set_config('app.current_user', '', false);
END;
$$;

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calls" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_auth_links" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_isolation_policy ON "tenants";
CREATE POLICY tenants_isolation_policy ON "tenants"
  FOR ALL USING ("id"::uuid = app.current_tenant_id());

DROP POLICY IF EXISTS users_isolation_policy ON "users";
CREATE POLICY users_isolation_policy ON "users"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());

DROP POLICY IF EXISTS integrations_isolation_policy ON "integrations";
CREATE POLICY integrations_isolation_policy ON "integrations"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());

DROP POLICY IF EXISTS leads_isolation_policy ON "leads";
CREATE POLICY leads_isolation_policy ON "leads"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());

DROP POLICY IF EXISTS contacts_isolation_policy ON "contacts";
CREATE POLICY contacts_isolation_policy ON "contacts"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());

DROP POLICY IF EXISTS calls_isolation_policy ON "calls";
CREATE POLICY calls_isolation_policy ON "calls"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());

DROP POLICY IF EXISTS notifications_isolation_policy ON "notifications";
CREATE POLICY notifications_isolation_policy ON "notifications"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());

DROP POLICY IF EXISTS webhook_events_isolation_policy ON "webhook_events";
CREATE POLICY webhook_events_isolation_policy ON "webhook_events"
  FOR ALL USING (
    "tenantId" IS NULL
    OR "tenantId"::uuid = app.current_tenant_id()
  );

DROP POLICY IF EXISTS audit_logs_isolation_policy ON "audit_logs";
CREATE POLICY audit_logs_isolation_policy ON "audit_logs"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());

DROP POLICY IF EXISTS user_auth_links_isolation_policy ON "user_auth_links";
CREATE POLICY user_auth_links_isolation_policy ON "user_auth_links"
  FOR ALL USING ("userId"::uuid = app.current_user_id());

COMMENT ON FUNCTION app.set_tenant_context(uuid, uuid) IS 'Sets tenant/user context for RLS policies';
