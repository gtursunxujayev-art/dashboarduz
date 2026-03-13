-- Enable Row Level Security (RLS) on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_auth_links ENABLE ROW LEVEL SECURITY;

-- Create function to get current tenant ID from JWT
CREATE OR REPLACE FUNCTION app.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN current_setting('app.current_tenant', true)::uuid;
END;
$$;

-- Create function to get current user ID from JWT
CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN current_setting('app.current_user', true)::uuid;
END;
$$;

-- Tenants: Users can only see their own tenant
CREATE POLICY tenants_isolation_policy ON tenants
  FOR ALL USING (id = app.current_tenant_id());

-- Users: Users can only see users in their own tenant
CREATE POLICY users_isolation_policy ON users
  FOR ALL USING (tenant_id = app.current_tenant_id());

-- Integrations: Users can only see integrations in their own tenant
CREATE POLICY integrations_isolation_policy ON integrations
  FOR ALL USING (tenant_id = app.current_tenant_id());

-- Leads: Users can only see leads in their own tenant
CREATE POLICY leads_isolation_policy ON leads
  FOR ALL USING (tenant_id = app.current_tenant_id());

-- Contacts: Users can only see contacts in their own tenant
CREATE POLICY contacts_isolation_policy ON contacts
  FOR ALL USING (tenant_id = app.current_tenant_id());

-- Calls: Users can only see calls in their own tenant
CREATE POLICY calls_isolation_policy ON calls
  FOR ALL USING (tenant_id = app.current_tenant_id());

-- Notifications: Users can only see notifications in their own tenant
CREATE POLICY notifications_isolation_policy ON notifications
  FOR ALL USING (tenant_id = app.current_tenant_id());

-- Webhook Events: Users can only see webhook events in their own tenant (or global events)
CREATE POLICY webhook_events_isolation_policy ON webhook_events
  FOR ALL USING (
    tenant_id IS NULL 
    OR tenant_id = app.current_tenant_id()
  );

-- Audit Logs: Users can only see audit logs in their own tenant
CREATE POLICY audit_logs_isolation_policy ON audit_logs
  FOR ALL USING (tenant_id = app.current_tenant_id());

-- User Auth Links: Users can only see their own auth links
CREATE POLICY user_auth_links_isolation_policy ON user_auth_links
  FOR ALL USING (user_id = app.current_user_id());

-- Allow system user (for migrations, etc.)
CREATE ROLE system_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO system_user;

-- Create function to set tenant context (to be called from application)
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

-- Create function to clear tenant context
CREATE OR REPLACE FUNCTION app.clear_tenant_context()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.current_tenant', '', false);
  PERFORM set_config('app.current_user', '', false);
END;
$$;

-- Create indexes for better performance with RLS
CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_integrations_tenant_id ON integrations(tenant_id);
CREATE INDEX idx_leads_tenant_id ON leads(tenant_id);
CREATE INDEX idx_contacts_tenant_id ON contacts(tenant_id);
CREATE INDEX idx_calls_tenant_id ON calls(tenant_id);
CREATE INDEX idx_notifications_tenant_id ON notifications(tenant_id);
CREATE INDEX idx_webhook_events_tenant_id ON webhook_events(tenant_id);
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);

-- Create composite indexes for common query patterns
CREATE INDEX idx_leads_tenant_status ON leads(tenant_id, status);
CREATE INDEX idx_leads_tenant_created ON leads(tenant_id, created_at);
CREATE INDEX idx_calls_tenant_created ON calls(tenant_id, started_at);
CREATE INDEX idx_notifications_tenant_status ON notifications(tenant_id, status);

-- Add comment explaining RLS setup
COMMENT ON SCHEMA public IS 'Multi-tenant CRM Integrator with Row Level Security (RLS)';
COMMENT ON FUNCTION app.current_tenant_id() IS 'Returns the current tenant ID from JWT context';
COMMENT ON FUNCTION app.current_user_id() IS 'Returns the current user ID from JWT context';
COMMENT ON FUNCTION app.set_tenant_context(uuid, uuid) IS 'Sets the tenant and user context for RLS policies';
COMMENT ON FUNCTION app.clear_tenant_context() IS 'Clears the tenant and user context';