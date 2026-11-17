-- Removes the Utel (VoIP) extension mapping and the voip_utel integration type.
-- Must run after 20261118100000_call_manager_user_id, whose backfill reads
-- users."utelManagerExternalId" to attribute older calls to managers.
--
-- Data change:
--   * users."utelManagerExternalId" is dropped with its two indexes: the stored
--     extensions are lost (nothing reads them any more; calls are attributed by
--     calls."managerUserId"). To keep a copy first:
--       SELECT "tenantId", "id", "utelManagerExternalId" FROM "users" WHERE "utelManagerExternalId" IS NOT NULL;
--   * integrations rows of type 'voip_utel' are deleted (the VoIP webhook is gone;
--     no other table references them).
--   * calls rows with provider 'utel' are NOT touched: they stay as history and no
--     report counts them.
-- Idempotent.

DROP INDEX IF EXISTS "users_tenantId_utelManagerExternalId_idx";
DROP INDEX IF EXISTS "users_utelManagerExternalId_idx";
ALTER TABLE "users" DROP COLUMN IF EXISTS "utelManagerExternalId";

DELETE FROM "integrations" WHERE "type" = 'voip_utel';

-- Same pattern as 20261116104000_status_type_check_constraints, without 'voip_utel'.
ALTER TABLE "integrations" DROP CONSTRAINT IF EXISTS "integrations_type_check";

DO $$
BEGIN
  ALTER TABLE "integrations" ADD CONSTRAINT "integrations_type_check" CHECK ("type" IN ('amocrm', 'telegram', 'google_sheets', 'faceid_attendance', 'meta_ads')) NOT VALID;
  BEGIN
    ALTER TABLE "integrations" VALIDATE CONSTRAINT "integrations_type_check";
  EXCEPTION WHEN check_violation THEN
    ALTER TABLE "integrations" DROP CONSTRAINT "integrations_type_check";
    RAISE WARNING 'Skipped integrations_type_check: existing rows in integrations.type hold other values';
  END;
END $$;
