ALTER TABLE "courses"
  ADD COLUMN IF NOT EXISTS "isHiddenFromIncomeForm" BOOLEAN;

UPDATE "courses"
SET "isHiddenFromIncomeForm" = FALSE
WHERE "isHiddenFromIncomeForm" IS NULL;

ALTER TABLE "courses"
  ALTER COLUMN "isHiddenFromIncomeForm" SET DEFAULT FALSE,
  ALTER COLUMN "isHiddenFromIncomeForm" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "courses_isHiddenFromIncomeForm_idx"
  ON "courses" ("isHiddenFromIncomeForm");
