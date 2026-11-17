-- amoCRM activity snapshot: tasks, lead events and reference data (users, pipelines, lead custom
-- fields) copied by a background job, so pages read them from the database instead of amoCRM.
--
-- Additive only: three new tables with their indexes and tenant RLS policies. No existing table,
-- column, index or row is changed. Safe to apply on its own with
--   prisma db execute --file <this file>  and  prisma migrate resolve --applied <this name>
-- (production shares this database with another app and has other migrations pending).

CREATE TABLE IF NOT EXISTS "amocrm_tasks" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId" TEXT NOT NULL,
    "amocrmId" TEXT NOT NULL,
    "responsibleUserId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completeTill" TIMESTAMP(3),
    "externalCreatedAt" TIMESTAMP(3),
    "externalUpdatedAt" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "amocrm_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "amocrm_tasks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "amocrm_tasks_tenantId_amocrmId_key" ON "amocrm_tasks"("tenantId", "amocrmId");
CREATE INDEX IF NOT EXISTS "amocrm_tasks_tenantId_responsibleUserId_isCompleted_completeTill_idx"
  ON "amocrm_tasks"("tenantId", "responsibleUserId", "isCompleted", "completeTill");

CREATE TABLE IF NOT EXISTS "amocrm_events" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId" TEXT NOT NULL,
    "amocrmId" TEXT NOT NULL,
    "type" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdBy" TEXT,
    "externalCreatedAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    CONSTRAINT "amocrm_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "amocrm_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "amocrm_events_tenantId_amocrmId_key" ON "amocrm_events"("tenantId", "amocrmId");
CREATE INDEX IF NOT EXISTS "amocrm_events_tenantId_externalCreatedAt_idx" ON "amocrm_events"("tenantId", "externalCreatedAt");
CREATE INDEX IF NOT EXISTS "amocrm_events_tenantId_createdBy_externalCreatedAt_idx"
  ON "amocrm_events"("tenantId", "createdBy", "externalCreatedAt");

CREATE TABLE IF NOT EXISTS "amocrm_reference" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "amocrm_reference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "amocrm_reference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "amocrm_reference_tenantId_kind_key" ON "amocrm_reference"("tenantId", "kind");

-- Tenant isolation, like every other tenant table (not enforced while the app connects as owner).
ALTER TABLE "amocrm_tasks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amocrm_tasks_isolation_policy ON "amocrm_tasks";
CREATE POLICY amocrm_tasks_isolation_policy ON "amocrm_tasks"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "amocrm_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amocrm_events_isolation_policy ON "amocrm_events";
CREATE POLICY amocrm_events_isolation_policy ON "amocrm_events"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "amocrm_reference" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amocrm_reference_isolation_policy ON "amocrm_reference";
CREATE POLICY amocrm_reference_isolation_policy ON "amocrm_reference"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());
