ALTER TABLE "income_adjustment_requests"
  ADD COLUMN IF NOT EXISTS "previousCourseId" TEXT,
  ADD COLUMN IF NOT EXISTS "previousTariffId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'income_adjustment_requests_previousCourseId_fkey') THEN
    ALTER TABLE "income_adjustment_requests"
      ADD CONSTRAINT "income_adjustment_requests_previousCourseId_fkey"
      FOREIGN KEY ("previousCourseId") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'income_adjustment_requests_previousTariffId_fkey') THEN
    ALTER TABLE "income_adjustment_requests"
      ADD CONSTRAINT "income_adjustment_requests_previousTariffId_fkey"
      FOREIGN KEY ("previousTariffId") REFERENCES "tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill requests whose income has not been changed by them yet.
UPDATE "income_adjustment_requests" r
SET "previousCourseId" = i."courseId",
    "previousTariffId" = i."tariffId"
FROM "incomes" i
WHERE r."incomeId" = i."id"
  AND r."status" IN ('pending', 'rejected')
  AND r."previousCourseId" IS NULL
  AND r."previousTariffId" IS NULL;
