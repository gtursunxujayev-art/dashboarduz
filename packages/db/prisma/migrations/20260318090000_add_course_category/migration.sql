-- Add explicit course category for sales grouping.
ALTER TABLE "courses"
  ADD COLUMN IF NOT EXISTS "category" TEXT;

UPDATE "courses"
SET "category" = CASE
  WHEN LOWER("name") LIKE '%online%' OR LOWER("name") LIKE '%onlayn%' THEN 'online'
  WHEN LOWER("name") LIKE '%offline%' OR LOWER("name") LIKE '%oflayn%' THEN 'offline'
  WHEN LOWER("name") LIKE '%intensive%' OR LOWER("name") LIKE '%intensiv%' THEN 'intensive'
  ELSE 'offline'
END
WHERE "category" IS NULL OR LENGTH(TRIM("category")) = 0;

ALTER TABLE "courses"
  ALTER COLUMN "category" SET DEFAULT 'offline',
  ALTER COLUMN "category" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'courses_category_check'
  ) THEN
    ALTER TABLE "courses"
      ADD CONSTRAINT "courses_category_check"
      CHECK ("category" IN ('online', 'offline', 'intensive'));
  END IF;
END $$;
