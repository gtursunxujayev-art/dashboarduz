-- Foreign keys for live references that had none. All are ON DELETE SET NULL.
--
-- Existing data: references to rows that no longer exist (orphans) are set to
-- NULL first; nothing else changes. Run this query beforehand to see how many
-- rows that touches (each UPDATE only affects orphaned values):
--   SELECT 'customers.profileCourseId', count(*) FROM customers c
--     WHERE c."profileCourseId" IS NOT NULL
--       AND NOT EXISTS (SELECT 1 FROM courses x WHERE x.id = c."profileCourseId");
--   (same pattern for the other columns below)
--
-- Locking: constraints are added NOT VALID (brief lock, no scan) and then
-- validated, which scans the table but does not block reads or writes.
-- Idempotent: every constraint is added only if missing.
-- Bonus snapshot/audit user and course columns stay without foreign keys on
-- purpose (history values), see the comments in schema.prisma.

UPDATE "customers" SET "profileCourseId" = NULL
WHERE "profileCourseId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "courses" ref WHERE ref."id" = "customers"."profileCourseId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_profileCourseId_fkey') THEN
    ALTER TABLE "customers"
      ADD CONSTRAINT "customers_profileCourseId_fkey"
      FOREIGN KEY ("profileCourseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "customers" VALIDATE CONSTRAINT "customers_profileCourseId_fkey";

UPDATE "customers" SET "profileTariffId" = NULL
WHERE "profileTariffId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "tariffs" ref WHERE ref."id" = "customers"."profileTariffId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_profileTariffId_fkey') THEN
    ALTER TABLE "customers"
      ADD CONSTRAINT "customers_profileTariffId_fkey"
      FOREIGN KEY ("profileTariffId") REFERENCES "tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "customers" VALIDATE CONSTRAINT "customers_profileTariffId_fkey";

UPDATE "customers" SET "profileSubTariffId" = NULL
WHERE "profileSubTariffId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "sub_tariffs" ref WHERE ref."id" = "customers"."profileSubTariffId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_profileSubTariffId_fkey') THEN
    ALTER TABLE "customers"
      ADD CONSTRAINT "customers_profileSubTariffId_fkey"
      FOREIGN KEY ("profileSubTariffId") REFERENCES "sub_tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "customers" VALIDATE CONSTRAINT "customers_profileSubTariffId_fkey";

UPDATE "customers" SET "historicalImportSessionId" = NULL
WHERE "historicalImportSessionId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "historical_import_sessions" ref WHERE ref."id" = "customers"."historicalImportSessionId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_historicalImportSessionId_fkey') THEN
    ALTER TABLE "customers"
      ADD CONSTRAINT "customers_historicalImportSessionId_fkey"
      FOREIGN KEY ("historicalImportSessionId") REFERENCES "historical_import_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "customers" VALIDATE CONSTRAINT "customers_historicalImportSessionId_fkey";

UPDATE "incomes" SET "historicalImportSessionId" = NULL
WHERE "historicalImportSessionId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "historical_import_sessions" ref WHERE ref."id" = "incomes"."historicalImportSessionId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incomes_historicalImportSessionId_fkey') THEN
    ALTER TABLE "incomes"
      ADD CONSTRAINT "incomes_historicalImportSessionId_fkey"
      FOREIGN KEY ("historicalImportSessionId") REFERENCES "historical_import_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "incomes" VALIDATE CONSTRAINT "incomes_historicalImportSessionId_fkey";

UPDATE "analytics_ai_reports" SET "userId" = NULL
WHERE "userId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "users" ref WHERE ref."id" = "analytics_ai_reports"."userId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_ai_reports_userId_fkey') THEN
    ALTER TABLE "analytics_ai_reports"
      ADD CONSTRAINT "analytics_ai_reports_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "analytics_ai_reports" VALIDATE CONSTRAINT "analytics_ai_reports_userId_fkey";

UPDATE "historical_import_sessions" SET "fallbackManagerUserId" = NULL
WHERE "fallbackManagerUserId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "users" ref WHERE ref."id" = "historical_import_sessions"."fallbackManagerUserId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'historical_import_sessions_fallbackManagerUserId_fkey') THEN
    ALTER TABLE "historical_import_sessions"
      ADD CONSTRAINT "historical_import_sessions_fallbackManagerUserId_fkey"
      FOREIGN KEY ("fallbackManagerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE "historical_import_sessions" VALIDATE CONSTRAINT "historical_import_sessions_fallbackManagerUserId_fkey";
