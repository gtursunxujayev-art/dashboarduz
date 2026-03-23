ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "profileCourseId" TEXT,
  ADD COLUMN IF NOT EXISTS "profileTariffId" TEXT,
  ADD COLUMN IF NOT EXISTS "profileSubTariffId" TEXT;

CREATE INDEX IF NOT EXISTS "customers_profileCourseId_idx"
  ON "customers" ("profileCourseId");

CREATE INDEX IF NOT EXISTS "customers_profileTariffId_idx"
  ON "customers" ("profileTariffId");

CREATE INDEX IF NOT EXISTS "customers_profileSubTariffId_idx"
  ON "customers" ("profileSubTariffId");
