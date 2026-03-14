-- Add password hash field for password-based authentication
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
