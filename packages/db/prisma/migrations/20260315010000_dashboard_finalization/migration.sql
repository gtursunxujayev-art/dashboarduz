-- Dashboard finalization: lead external timestamps + provider-agnostic calls.

ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "externalCreatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "externalUpdatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "leads_externalCreatedAt_idx" ON "leads"("externalCreatedAt");

ALTER TABLE "calls"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'unknown';

DROP INDEX IF EXISTS "calls_tenantId_callIdExternal_key";
CREATE UNIQUE INDEX IF NOT EXISTS "calls_tenantId_provider_callIdExternal_key"
  ON "calls"("tenantId", "provider", "callIdExternal");

CREATE INDEX IF NOT EXISTS "calls_provider_idx" ON "calls"("provider");
