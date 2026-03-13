-- Enable Row Level Security (RLS) and create policies for multi-tenant isolation
-- Run this migration after deploying the schema

-- Enable RLS on all tenant-scoped tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_auth_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create policies for each table

-- Tenants: users can only see their own tenant
CREATE POLICY tenant_isolation_policy ON tenants
    USING (id = current_setting('app.current_tenant_id')::uuid);

-- Users: users can only see users in their own tenant
CREATE POLICY user_isolation_policy ON users
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- User auth links: users can only see their own auth links
CREATE POLICY user_auth_links_isolation_policy ON user_auth_links
    USING (user_id IN (
        SELECT id FROM users WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
    ));

-- Integrations: users can only see integrations in their own tenant
CREATE POLICY integrations_isolation_policy ON integrations
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Leads: users can only see leads in their own tenant
CREATE POLICY leads_isolation_policy ON leads
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Contacts: users can only see contacts in their own tenant
CREATE POLICY contacts_isolation_policy ON contacts
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Calls: users can only see calls in their own tenant
CREATE POLICY calls_isolation_policy ON calls
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Notifications: users can only see notifications in their own tenant
CREATE POLICY notifications_isolation_policy ON notifications
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Webhook events: users can only see webhook events in their own tenant
CREATE POLICY webhook_events_isolation_policy ON webhook_events
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Audit logs: users can only see audit logs in their own tenant
CREATE POLICY audit_logs_isolation_policy ON audit_logs
    USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Create function to set current tenant context
CREATE OR REPLACE FUNCTION set_current_tenant(tenant_id uuid)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_tenant_id', tenant_id::text, false);
END;
$$ LANGUAGE plpgsql;

-- Create function to get current tenant
CREATE OR REPLACE FUNCTION get_current_tenant()
RETURNS uuid AS $$
BEGIN
    RETURN current_setting('app.current_tenant_id')::uuid;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION set_current_tenant(uuid) TO public;
GRANT EXECUTE ON FUNCTION get_current_tenant() TO public;

-- Create index for better performance with RLS
CREATE INDEX idx_users_tenant_id ON users(tenant_id);
CREATE INDEX idx_integrations_tenant_id ON integrations(tenant_id);
CREATE INDEX idx_leads_tenant_id ON leads(tenant_id);
CREATE INDEX idx_contacts_tenant_id ON contacts(tenant_id);
CREATE INDEX idx_calls_tenant_id ON calls(tenant_id);
CREATE INDEX idx_notifications_tenant_id ON notifications(tenant_id);
CREATE INDEX idx_webhook_events_tenant_id ON webhook_events(tenant_id);
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);

-- Test data isolation (run in test environment)
-- INSERT INTO test_rls_isolation() VALUES (); -- Create test function if needed

COMMENT ON TABLE tenants IS 'Tenant isolation enforced via RLS policies';
COMMENT ON TABLE users IS 'User data isolated by tenant_id via RLS';
COMMENT ON TABLE integrations IS 'Integration data isolated by tenant_id via RLS';
COMMENT ON TABLE leads IS 'Lead data isolated by tenant_id via RLS';
COMMENT ON TABLE contacts IS 'Contact data isolated by tenant_id via RLS';
COMMENT ON TABLE calls IS 'Call data isolated by tenant_id via RLS';
COMMENT ON TABLE notifications IS 'Notification data isolated by tenant_id via RLS';
COMMENT ON TABLE webhook_events IS 'Webhook event data isolated by tenant_id via RLS';
COMMENT ON TABLE audit_logs IS 'Audit log data isolated by tenant_id via RLS';