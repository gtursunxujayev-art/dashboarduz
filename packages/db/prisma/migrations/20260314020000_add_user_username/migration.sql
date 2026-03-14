-- Add username field for password-based login
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users" ("username");
CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users" ("username");
