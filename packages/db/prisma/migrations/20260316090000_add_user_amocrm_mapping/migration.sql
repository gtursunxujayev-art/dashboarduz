-- Add AmoCRM responsible manager mapping to users.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "amocrmResponsibleUserId" TEXT;

CREATE INDEX IF NOT EXISTS "users_amocrmResponsibleUserId_idx"
  ON "users"("amocrmResponsibleUserId");
