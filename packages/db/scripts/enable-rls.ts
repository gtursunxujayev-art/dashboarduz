// Enable Row Level Security (RLS) migration script
// Run this after deploying the schema to enable RLS policies

import { PrismaClient } from '@prisma/client';
import { logger } from '../../../src/lib/logger';

const prisma = new PrismaClient();

async function enableRLS() {
  try {
    logger.info('Starting RLS migration...');

    // Enable RLS on all tables
    const tables = [
      'tenants',
      'users',
      'user_auth_links',
      'integrations',
      'leads',
      'contacts',
      'calls',
      'notifications',
      'webhook_events',
      'audit_logs'
    ];

    for (const table of tables) {
      logger.info(`Enabling RLS on table: ${table}`);
      await prisma.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    }

    // Create policies for each table
    logger.info('Creating RLS policies...');
    
    // Tenants: users can only see their own tenant
    await prisma.$executeRawUnsafe(`
      DROP POLICY IF EXISTS tenant_isolation_policy ON tenants;
      CREATE POLICY tenant_isolation_policy ON tenants
          USING (id = current_setting('app.current_tenant_id')::uuid);
    `);

    // Users: users can only see users in their own tenant
    await prisma.$executeRawUnsafe(`
      DROP POLICY IF EXISTS user_isolation_policy ON users;
      CREATE POLICY user_isolation_policy ON users
          USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
    `);

    // User auth links: users can only see their own auth links
    await prisma.$executeRawUnsafe(`
      DROP POLICY IF EXISTS user_auth_links_isolation_policy ON user_auth_links;
      CREATE POLICY user_auth_links_isolation_policy ON user_auth_links
          USING (user_id IN (
              SELECT id FROM users WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
          ));
    `);

    // Integrations: users can only see integrations in their own tenant
    await prisma.$executeRawUnsafe(`
      DROP POLICY IF EXISTS integrations_isolation_policy ON integrations;
      CREATE POLICY integrations_isolation_policy ON integrations
          USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
    `);

    // Leads: users can only see leads in their own tenant
    await prisma.$executeRawUnsafe(`
      DROP POLICY IF EXISTS leads_isolation_policy ON leads;
      CREATE POLICY leads_isolation_policy ON leads
          USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
    `);

    // Contacts: users can only see contacts in their own tenant
    await prisma.$executeRawUnsafe(`
      DROP POLICY IF EXISTS contacts_isolation_policy ON contacts;
      CREATE POLICY contacts_isolation_policy ON contacts
          USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
    `);

    // Calls: users can only see calls in their own tenant
    await prisma.$executeRawUnsafe(`
      DROP POLICY IF EXISTS calls_isolation_policy ON calls;
      CREATE POLICY calls_isolation_policy ON calls
          USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
    `);

    // Notifications: users can only see notifications in their own tenant
    await prisma.$executeRawUnsafe(`
      DROP POLICY IF EXISTS notifications_isolation_policy ON notifications;
      CREATE POLICY notifications_isolation_policy ON notifications
          USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
    `);

    // Webhook events: users can only see webhook events in their own tenant
    await prisma.$executeRawUnsafe(`
      DROP POLICY IF EXISTS webhook_events_isolation_policy ON webhook_events;
      CREATE POLICY webhook_events_isolation_policy ON webhook_events
          USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
    `);

    // Audit logs: users can only see audit logs in their own tenant
    await prisma.$executeRawUnsafe(`
      DROP POLICY IF EXISTS audit_logs_isolation_policy ON audit_logs;
      CREATE POLICY audit_logs_isolation_policy ON audit_logs
          USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
    `);

    // Create function to set current tenant context
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION set_current_tenant(tenant_id uuid)
      RETURNS void AS $$
      BEGIN
          PERFORM set_config('app.current_tenant_id', tenant_id::text, false);
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create function to get current tenant
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION get_current_tenant()
      RETURNS uuid AS $$
      BEGIN
          RETURN current_setting('app.current_tenant_id')::uuid;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Grant execute permissions
    await prisma.$executeRawUnsafe(`
      GRANT EXECUTE ON FUNCTION set_current_tenant(uuid) TO public;
      GRANT EXECUTE ON FUNCTION get_current_tenant() TO public;
    `);

    // Create indexes for better performance with RLS
    logger.info('Creating indexes for RLS performance...');
    
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_integrations_tenant_id ON integrations(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_leads_tenant_id ON leads(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_contacts_tenant_id ON contacts(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_calls_tenant_id ON calls(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_notifications_tenant_id ON notifications(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_webhook_events_tenant_id ON webhook_events(tenant_id);',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);'
    ];

    for (const indexSql of indexes) {
      await prisma.$executeRawUnsafe(indexSql);
    }

    logger.info('RLS migration completed successfully');
    
  } catch (error: any) {
    logger.error({ error: error.message }, 'RLS migration failed');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration if called directly
if (require.main === module) {
  enableRLS()
    .then(() => {
      console.log('RLS migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('RLS migration failed:', error);
      process.exit(1);
    });
}

export { enableRLS };