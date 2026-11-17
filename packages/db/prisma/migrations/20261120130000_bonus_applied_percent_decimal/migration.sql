-- bonus_snapshot_lines.appliedPercent and bonus_snapshot_items.appliedPercent: double precision -> NUMERIC(7,4).
--
-- The percent stored in a frozen bonus snapshot is shown and exported; as a float it could read back as
-- 7.499999999. Data change: values are rounded to 4 decimal places (7.5 becomes 7.5000). The bonus amounts are
-- separate integer columns and do not change. A value outside +-999.9999 makes the migration fail (a percent is
-- never above 100).
--
-- Locks: ALTER COLUMN TYPE rewrites both tables under an ACCESS EXCLUSIVE lock (reads and writes of bonus
-- snapshots wait). They hold a few rows per agent and finalized month, so this takes moments.

ALTER TABLE "bonus_snapshot_lines"
  ALTER COLUMN "appliedPercent" SET DATA TYPE DECIMAL(7,4) USING round("appliedPercent"::numeric, 4);
ALTER TABLE "bonus_snapshot_items"
  ALTER COLUMN "appliedPercent" SET DATA TYPE DECIMAL(7,4) USING round("appliedPercent"::numeric, 4);
