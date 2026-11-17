-- CHECK constraints for the remaining status / type columns, with exactly the literal values the code writes:
--
--   calls."direction"                    'inbound', 'outbound'   (the amoCRM call sync; the removed Utel path also
--                                        only ever produced these two)
--   calls."status", provider 'amocrm'    'completed', 'missed'   (the amoCRM call sync is the only writer). Rows of
--                                        other providers (Utel history) keep Utel's raw status, which came from an
--                                        external system and is open-ended, so they are not constrained.
--   tenants."plan"                       'free', 'pro', 'enterprise' (TenantPlan in packages/shared; the code
--                                        creates 'free', the rate limiter reads all three)
--
-- Already constrained since 20260318170000_income_adjustments (left as they are):
--   incomes."lifecycleStatus"            'active', 'pending_refund', 'refunded'   (incomes_lifecycle_status_check)
--   income_adjustment_requests."status"  'pending', 'approved', 'rejected'        (..._status_check)
--   income_adjustment_requests."type"    'refund', 'tariff_change'                (..._type_check)
-- Not constrained: leads."status" holds amoCRM pipeline status ids (external, open-ended).
--
-- No data change. Unlike 20261116104000 this migration FAILS instead of skipping a constraint: it first looks for
-- rows outside the list and raises an error naming the constraint and the first offending rows (id and the
-- checked columns only). The whole migration then rolls back; fix those rows, mark it rolled back
-- (`prisma migrate resolve --rolled-back 20261120140000_status_check_constraints`) and deploy again.
--
-- Locks: each constraint is added NOT VALID (brief ACCESS EXCLUSIVE lock, no scan) and then validated, which
-- scans the table under SHARE UPDATE EXCLUSIVE (reads and writes continue).

CREATE OR REPLACE FUNCTION pg_temp.add_check(p_table text, p_name text, p_expr text, p_shown text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  bad text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = p_name) THEN
    RETURN;
  END IF;
  EXECUTE format(
    'SELECT string_agg(row_to_json(t)::text, '', '') FROM (SELECT %s FROM %I WHERE NOT (%s) LIMIT 20) t',
    p_shown, p_table, p_expr
  ) INTO bad;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add %: rows of % violate CHECK (%). First offending rows: %', p_name, p_table, p_expr, left(bad, 2000);
  END IF;
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', p_table, p_name, p_expr);
  EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', p_table, p_name);
END;
$$;

SELECT pg_temp.add_check('calls', 'calls_direction_check',
  $c$"direction" IN ('inbound', 'outbound')$c$, 'id, "provider", "direction"');
SELECT pg_temp.add_check('calls', 'calls_amocrm_status_check',
  $c$"provider" <> 'amocrm' OR "status" IN ('completed', 'missed')$c$, 'id, "provider", "status"');
SELECT pg_temp.add_check('tenants', 'tenants_plan_check',
  $c$"plan" IN ('free', 'pro', 'enterprise')$c$, 'id, "plan"');
