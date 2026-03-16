-- Add optional sub-tariff catalog under tariffs.

CREATE TABLE IF NOT EXISTS "sub_tariffs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "tariffId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sub_tariffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sub_tariffs_tenantId_tariffId_name_key"
  ON "sub_tariffs"("tenantId", "tariffId", "name");
CREATE INDEX IF NOT EXISTS "sub_tariffs_tenantId_idx" ON "sub_tariffs"("tenantId");
CREATE INDEX IF NOT EXISTS "sub_tariffs_tariffId_idx" ON "sub_tariffs"("tariffId");

ALTER TABLE "sub_tariffs"
  ADD CONSTRAINT "sub_tariffs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sub_tariffs"
  ADD CONSTRAINT "sub_tariffs_tariffId_fkey"
  FOREIGN KEY ("tariffId") REFERENCES "tariffs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sub_tariffs" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sub_tariffs_isolation_policy ON "sub_tariffs";
CREATE POLICY sub_tariffs_isolation_policy ON "sub_tariffs"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());
