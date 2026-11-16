-- Retention: historical import sessions kept the full uploaded spreadsheets
-- (incomeRows, customerRows; up to 5,000 rows each) after the import had
-- finished. The import module is disabled by policy (every procedure throws
-- before touching a session), so there is no runtime code to change; this
-- one-time cleanup releases the space.
--
-- Existing data: incomeRows and customerRows are set to NULL for sessions
-- with status 'completed' only. Their rows were imported into customers and
-- incomes (which keep legacyImportKey/legacyImportMeta). preview, progress,
-- failureReport and all other session fields are kept, and sessions in any
-- other status (prepared, running, cancelling, cancelled, failed) are not
-- touched. Preview:
--   SELECT count(*) FROM historical_import_sessions
--   WHERE status = 'completed' AND ("incomeRows" IS NOT NULL OR "customerRows" IS NOT NULL);

UPDATE "historical_import_sessions"
SET "incomeRows" = NULL,
    "customerRows" = NULL
WHERE "status" = 'completed'
  AND ("incomeRows" IS NOT NULL OR "customerRows" IS NOT NULL);
