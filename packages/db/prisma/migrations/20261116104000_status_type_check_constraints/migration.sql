-- CHECK constraints for status/type columns, following the existing
-- courses_category_check pattern. The allowed values are exactly the literals
-- the code writes (zod enums, constants and object literals in apps/api).
--
-- Existing data is never modified. Each constraint is added NOT VALID (no
-- scan, brief lock) and then validated. If existing rows hold a value outside
-- the list, validation fails and the constraint is dropped again with a
-- WARNING naming it, so the migration still succeeds; inspect with e.g.
--   SELECT "status", count(*) FROM integrations GROUP BY 1;
-- and re-add it after cleaning the data. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integrations_type_check') THEN
    ALTER TABLE "integrations" ADD CONSTRAINT "integrations_type_check" CHECK ("type" IN ('amocrm', 'telegram', 'google_sheets', 'voip_utel', 'faceid_attendance', 'meta_ads')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE "integrations" VALIDATE CONSTRAINT "integrations_type_check";
  EXCEPTION WHEN check_violation THEN
    ALTER TABLE "integrations" DROP CONSTRAINT "integrations_type_check";
    RAISE WARNING 'Skipped integrations_type_check: existing rows in integrations.type hold other values';
  END;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'integrations_status_check') THEN
    ALTER TABLE "integrations" ADD CONSTRAINT "integrations_status_check" CHECK ("status" IN ('pending', 'active', 'error', 'disconnected')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE "integrations" VALIDATE CONSTRAINT "integrations_status_check";
  EXCEPTION WHEN check_violation THEN
    ALTER TABLE "integrations" DROP CONSTRAINT "integrations_status_check";
    RAISE WARNING 'Skipped integrations_status_check: existing rows in integrations.status hold other values';
  END;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'incomes_type_check') THEN
    ALTER TABLE "incomes" ADD CONSTRAINT "incomes_type_check" CHECK ("type" IN ('new_sale', 'repayment')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE "incomes" VALIDATE CONSTRAINT "incomes_type_check";
  EXCEPTION WHEN check_violation THEN
    ALTER TABLE "incomes" DROP CONSTRAINT "incomes_type_check";
    RAISE WARNING 'Skipped incomes_type_check: existing rows in incomes.type hold other values';
  END;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'historical_import_sessions_status_check') THEN
    ALTER TABLE "historical_import_sessions" ADD CONSTRAINT "historical_import_sessions_status_check" CHECK ("status" IN ('prepared', 'running', 'cancelling', 'cancelled', 'failed', 'completed')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE "historical_import_sessions" VALIDATE CONSTRAINT "historical_import_sessions_status_check";
  EXCEPTION WHEN check_violation THEN
    ALTER TABLE "historical_import_sessions" DROP CONSTRAINT "historical_import_sessions_status_check";
    RAISE WARNING 'Skipped historical_import_sessions_status_check: existing rows in historical_import_sessions.status hold other values';
  END;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bonus_adjustments_status_check') THEN
    ALTER TABLE "bonus_adjustments" ADD CONSTRAINT "bonus_adjustments_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE "bonus_adjustments" VALIDATE CONSTRAINT "bonus_adjustments_status_check";
  EXCEPTION WHEN check_violation THEN
    ALTER TABLE "bonus_adjustments" DROP CONSTRAINT "bonus_adjustments_status_check";
    RAISE WARNING 'Skipped bonus_adjustments_status_check: existing rows in bonus_adjustments.status hold other values';
  END;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_status_check') THEN
    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_status_check" CHECK ("status" IN ('pending', 'sent', 'failed', 'retrying')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_status_check";
  EXCEPTION WHEN check_violation THEN
    ALTER TABLE "notifications" DROP CONSTRAINT "notifications_status_check";
    RAISE WARNING 'Skipped notifications_status_check: existing rows in notifications.status hold other values';
  END;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_events_action_check') THEN
    ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_action_check" CHECK ("action" IN ('IN', 'OUT')) NOT VALID;
  END IF;
  BEGIN
    ALTER TABLE "attendance_events" VALIDATE CONSTRAINT "attendance_events_action_check";
  EXCEPTION WHEN check_violation THEN
    ALTER TABLE "attendance_events" DROP CONSTRAINT "attendance_events_action_check";
    RAISE WARNING 'Skipped attendance_events_action_check: existing rows in attendance_events.action hold other values';
  END;
END $$;
