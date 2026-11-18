-- Makes sure the seven CHECK constraints of 20261116104000_status_type_check_constraints (integrations_type_check as
-- redefined by 20261118110000_drop_utel_extension_mapping) really exist and are validated.
--
-- Those migrations DROPPED a constraint with only a WARNING when existing rows did not fit, and still succeeded, so a
-- database can be fully migrated and yet miss a constraint. This migration (they are applied and are not edited):
--   * leaves a constraint that exists and is validated alone;
--   * validates one that exists but is NOT VALID;
--   * re-adds a missing one.
-- Before adding or validating it looks for rows outside the allowed values and, if there are any, FAILS with an error
-- naming the constraint and the first offending rows (id and the checked column only). The whole migration then rolls
-- back: fix those rows, run `prisma migrate resolve --rolled-back 20261121120000_enforce_skipped_check_constraints`
-- and deploy again. On a database where every constraint is in place it changes nothing.
--
-- No data change. Locks: ADD CONSTRAINT ... NOT VALID takes a brief ACCESS EXCLUSIVE lock (no scan); VALIDATE scans
-- the table under SHARE UPDATE EXCLUSIVE (reads and writes continue). The pre-check is a plain SELECT.

CREATE OR REPLACE FUNCTION pg_temp.enforce_check(p_table text, p_name text, p_expr text, p_shown text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  bad text;
  validated boolean;
BEGIN
  SELECT c.convalidated INTO validated
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE c.conname = p_name AND t.relname = p_table;

  IF validated THEN
    RETURN;
  END IF;
  EXECUTE format(
    'SELECT string_agg(row_to_json(t)::text, '', '') FROM (SELECT %s FROM %I WHERE NOT (%s) LIMIT 20) t',
    p_shown, p_table, p_expr
  ) INTO bad;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot enforce %: rows of % violate CHECK (%). First offending rows: %', p_name, p_table, p_expr, left(bad, 2000);
  END IF;
  IF validated IS NULL THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', p_table, p_name, p_expr);
  END IF;
  EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', p_table, p_name);
END;
$$;

SELECT pg_temp.enforce_check('integrations', 'integrations_type_check',
  $c$"type" IN ('amocrm', 'telegram', 'google_sheets', 'faceid_attendance', 'meta_ads')$c$, 'id, "type"');
SELECT pg_temp.enforce_check('integrations', 'integrations_status_check',
  $c$"status" IN ('pending', 'active', 'error', 'disconnected')$c$, 'id, "status"');
SELECT pg_temp.enforce_check('incomes', 'incomes_type_check',
  $c$"type" IN ('new_sale', 'repayment')$c$, 'id, "type"');
SELECT pg_temp.enforce_check('historical_import_sessions', 'historical_import_sessions_status_check',
  $c$"status" IN ('prepared', 'running', 'cancelling', 'cancelled', 'failed', 'completed')$c$, 'id, "status"');
SELECT pg_temp.enforce_check('bonus_adjustments', 'bonus_adjustments_status_check',
  $c$"status" IN ('pending', 'approved', 'rejected')$c$, 'id, "status"');
SELECT pg_temp.enforce_check('notifications', 'notifications_status_check',
  $c$"status" IN ('pending', 'sent', 'failed', 'retrying')$c$, 'id, "status"');
SELECT pg_temp.enforce_check('attendance_events', 'attendance_events_action_check',
  $c$"action" IN ('IN', 'OUT')$c$, 'id, "action"');
