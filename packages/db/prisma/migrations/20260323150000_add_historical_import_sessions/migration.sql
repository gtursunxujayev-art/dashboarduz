ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "legacyProfileImportKey" TEXT,
  ADD COLUMN IF NOT EXISTS "legacyProfileImportSource" TEXT,
  ADD COLUMN IF NOT EXISTS "historicalImportSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "legacyProfileMeta" JSONB;

ALTER TABLE "incomes"
  ADD COLUMN IF NOT EXISTS "legacyImportKey" TEXT,
  ADD COLUMN IF NOT EXISTS "legacyImportSource" TEXT,
  ADD COLUMN IF NOT EXISTS "historicalImportSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "legacyImportMeta" JSONB;

CREATE TABLE IF NOT EXISTS "historical_import_sessions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'prepared',
  "fallbackManagerUserId" TEXT,
  "sourceFiles" JSONB,
  "managerAliasMap" JSONB,
  "incomeRows" JSONB,
  "customerRows" JSONB,
  "preview" JSONB,
  "progress" JSONB,
  "failureReport" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "historical_import_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "customers_historicalImportSessionId_idx"
  ON "customers" ("historicalImportSessionId");

CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenantId_legacyProfileImportKey_key"
  ON "customers" ("tenantId", "legacyProfileImportKey");

CREATE INDEX IF NOT EXISTS "incomes_historicalImportSessionId_idx"
  ON "incomes" ("historicalImportSessionId");

CREATE UNIQUE INDEX IF NOT EXISTS "incomes_tenantId_legacyImportKey_key"
  ON "incomes" ("tenantId", "legacyImportKey");

CREATE INDEX IF NOT EXISTS "historical_import_sessions_tenantId_idx"
  ON "historical_import_sessions" ("tenantId");

CREATE INDEX IF NOT EXISTS "historical_import_sessions_createdByUserId_idx"
  ON "historical_import_sessions" ("createdByUserId");

CREATE INDEX IF NOT EXISTS "historical_import_sessions_status_idx"
  ON "historical_import_sessions" ("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'historical_import_sessions_tenantId_fkey'
  ) THEN
    ALTER TABLE "historical_import_sessions"
      ADD CONSTRAINT "historical_import_sessions_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'historical_import_sessions_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "historical_import_sessions"
      ADD CONSTRAINT "historical_import_sessions_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
