-- users.googleId is never written or read by the code (Google login was never
-- implemented). Dropping it removes the column, its unique index and its
-- plain index.
--
-- Existing data: any values in the column are lost. Check first with
--   SELECT count(*) FROM users WHERE "googleId" IS NOT NULL;
-- (expected 0). DROP COLUMN is catalog-only (no table rewrite).

DROP INDEX IF EXISTS "users_googleId_idx";
DROP INDEX IF EXISTS "users_googleId_key";
ALTER TABLE "users" DROP COLUMN IF EXISTS "googleId";
