ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "utelManagerExternalId" TEXT;

CREATE INDEX IF NOT EXISTS "users_utelManagerExternalId_idx"
  ON "users"("utelManagerExternalId");
