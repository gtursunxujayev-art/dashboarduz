UPDATE "courses"
SET "category" = 'offline'
WHERE "category" IS NULL
   OR LENGTH(TRIM("category")) = 0
   OR "category" NOT IN ('online', 'offline', 'intensive', 'additional_service');

ALTER TABLE "courses"
  DROP CONSTRAINT IF EXISTS "courses_category_check";

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_category_check"
  CHECK ("category" IN ('online', 'offline', 'intensive', 'additional_service'));
