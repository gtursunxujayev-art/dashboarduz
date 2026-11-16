-- Moves everything the API/worker used to patch at startup
-- (apps/api/src/services/db/schema-compatibility.ts, removed in this change)
-- into a migration, and reconciles the remaining drift between the migration
-- history and schema.prisma so `prisma migrate diff` is clean.
--
-- Idempotent: safe on databases where the startup bootstrap already ran
-- (production) and on fresh databases. No table rewrites: CREATE TABLE only
-- when missing, DROP DEFAULT and DROP INDEX are catalog-only, and the only
-- index created on an existing table (customers.historicalImportSessionId)
-- already exists in every database that ran migration 20260323150000.
-- Data: none changed.

-- 1. corporate_call_durations was only ever created by the startup bootstrap.
CREATE TABLE IF NOT EXISTS "corporate_call_durations" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "managerUserId" TEXT NOT NULL,
  "callDate" TIMESTAMP(3) NOT NULL,
  "durationSeconds" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "corporate_call_durations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "corporate_call_durations_tenantId_managerUserId_callDate_key"
  ON "corporate_call_durations" ("tenantId", "managerUserId", "callDate");
CREATE INDEX IF NOT EXISTS "corporate_call_durations_tenantId_idx"
  ON "corporate_call_durations" ("tenantId");
CREATE INDEX IF NOT EXISTS "corporate_call_durations_managerUserId_idx"
  ON "corporate_call_durations" ("managerUserId");
CREATE INDEX IF NOT EXISTS "corporate_call_durations_callDate_idx"
  ON "corporate_call_durations" ("callDate");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'corporate_call_durations_tenantId_fkey') THEN
    ALTER TABLE "corporate_call_durations"
      ADD CONSTRAINT "corporate_call_durations_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'corporate_call_durations_managerUserId_fkey') THEN
    ALTER TABLE "corporate_call_durations"
      ADD CONSTRAINT "corporate_call_durations_managerUserId_fkey"
      FOREIGN KEY ("managerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 2. Indexes the bootstrap created that are in neither the migrations nor the
--    schema. courses is a small per-tenant catalog always read by tenantId, so
--    single-column indexes on category / startDate / endDate /
--    isHiddenFromIncomeForm are never chosen. Nothing filters
--    income_adjustment_requests by refundCardNumber (a card number should not
--    be indexed anyway).
DROP INDEX IF EXISTS "courses_category_idx";
DROP INDEX IF EXISTS "courses_startDate_idx";
DROP INDEX IF EXISTS "courses_endDate_idx";
DROP INDEX IF EXISTS "courses_isHiddenFromIncomeForm_idx";
DROP INDEX IF EXISTS "income_adjustment_requests_refundCardNumber_idx";

-- 3. Index created by 20260323150000 but missing from schema.prisma (now
--    declared there; it backs the historical-import foreign key added later).
CREATE INDEX IF NOT EXISTS "customers_historicalImportSessionId_idx"
  ON "customers" ("historicalImportSessionId");

-- 4. Column defaults the init migration declared but the schema does not:
--    Prisma always supplies id (uuid()) and updatedAt (@updatedAt), and no
--    raw INSERT in the code relies on them.
ALTER TABLE "tenants" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "user_auth_links" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "integrations" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "contacts" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "calls" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "notifications" ALTER COLUMN "id" DROP DEFAULT, ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "webhook_events" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "audit_logs" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "historical_import_sessions" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "meta_ad_insights" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "telegram_recipients" ALTER COLUMN "updatedAt" DROP DEFAULT;
