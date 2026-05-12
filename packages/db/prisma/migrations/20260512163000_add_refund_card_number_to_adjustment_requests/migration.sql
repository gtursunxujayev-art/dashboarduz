ALTER TABLE "income_adjustment_requests"
ADD COLUMN IF NOT EXISTS "refundCardNumber" VARCHAR(16);

CREATE INDEX IF NOT EXISTS "income_adjustment_requests_refundCardNumber_idx"
  ON "income_adjustment_requests" ("refundCardNumber");
