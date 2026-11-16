-- Drop indexes whose columns are a left prefix of another index or of a
-- unique constraint on the same table; Postgres uses the longer index for the
-- same lookups. Every dropped index and what covers it:
--   tenants(subdomain)                       -> tenants_subdomain_key (unique)
--   users(tenantId)                          -> users(tenantId, isActive)
--   users(username)                          -> users_username_key (unique)
--   users(telegramId)                        -> users_telegramId_key (unique)
--   integrations(tenantId)                   -> integrations(tenantId, type) unique
--   telegram_recipients(tenantId)            -> telegram_recipients(tenantId, started)
--   meta_ad_insights(tenantId)               -> meta_ad_insights(tenantId, date, ...) unique
--   meta_ad_insights(tenantId, date)         -> meta_ad_insights(tenantId, date, ...) unique
--   leads(tenantId)                          -> leads(tenantId, amocrmId) unique
--   contacts(tenantId)                       -> contacts(tenantId, phone)
--   calls(tenantId)                          -> calls(tenantId, provider, startedAt)
--   notifications(tenantId, status)          -> notifications(tenantId, status, createdAt)
--   webhook_events(tenantId)                 -> webhook_events(tenantId, source, idempotencyKey) unique
--   customers(tenantId)                      -> customers(tenantId, createdAt)
--   courses(tenantId)                        -> courses(tenantId, name) unique
--   tariffs(tenantId)                        -> tariffs(tenantId, courseId, name) unique
--   sub_tariffs(tenantId)                    -> sub_tariffs(tenantId, tariffId, name) unique
--   incomes(tenantId)                        -> incomes(tenantId, entryDate)
--   bonus_policy_versions(tenantId, effectiveMonth) -> identical unique key
--   corporate_call_durations(tenantId)       -> (tenantId, managerUserId, callDate) unique
--   attendance_events(tenantId)              -> attendance_events(tenantId, idempotencyKey) unique
--   attendance_day_summaries(tenantId)       -> attendance_day_summaries(tenantId, summaryDate)
-- Non-tenant lookups used by webhooks/auth (users email/phone, calls
-- callIdExternal/from/to, webhook_events source, ...) keep their indexes.
-- users(googleId) goes with the column in a later migration.
-- DROP INDEX takes a brief exclusive lock per table; no data change.

DROP INDEX IF EXISTS "tenants_subdomain_idx";
DROP INDEX IF EXISTS "users_tenantId_idx";
DROP INDEX IF EXISTS "users_username_idx";
DROP INDEX IF EXISTS "users_telegramId_idx";
DROP INDEX IF EXISTS "integrations_tenantId_idx";
DROP INDEX IF EXISTS "telegram_recipients_tenantId_idx";
DROP INDEX IF EXISTS "meta_ad_insights_tenantId_idx";
DROP INDEX IF EXISTS "meta_ad_insights_tenantId_date_idx";
DROP INDEX IF EXISTS "leads_tenantId_idx";
DROP INDEX IF EXISTS "contacts_tenantId_idx";
DROP INDEX IF EXISTS "calls_tenantId_idx";
DROP INDEX IF EXISTS "notifications_tenantId_status_idx";
DROP INDEX IF EXISTS "webhook_events_tenantId_idx";
DROP INDEX IF EXISTS "customers_tenantId_idx";
DROP INDEX IF EXISTS "courses_tenantId_idx";
DROP INDEX IF EXISTS "tariffs_tenantId_idx";
DROP INDEX IF EXISTS "sub_tariffs_tenantId_idx";
DROP INDEX IF EXISTS "incomes_tenantId_idx";
DROP INDEX IF EXISTS "bonus_policy_versions_tenantId_effectiveMonth_idx";
DROP INDEX IF EXISTS "corporate_call_durations_tenantId_idx";
DROP INDEX IF EXISTS "attendance_events_tenantId_idx";
DROP INDEX IF EXISTS "attendance_day_summaries_tenantId_idx";
