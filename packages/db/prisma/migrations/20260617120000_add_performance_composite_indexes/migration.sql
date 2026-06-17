-- Composite indexes for high-traffic dashboard, finance, customer, and course-sales filters.
-- All indexes are additive and match tenant-scoped query patterns used by API routes.

CREATE INDEX IF NOT EXISTS "users_tenantId_isActive_idx"
ON "users"("tenantId", "isActive");

CREATE INDEX IF NOT EXISTS "users_tenantId_amocrmResponsibleUserId_idx"
ON "users"("tenantId", "amocrmResponsibleUserId");

CREATE INDEX IF NOT EXISTS "users_tenantId_utelManagerExternalId_idx"
ON "users"("tenantId", "utelManagerExternalId");

CREATE INDEX IF NOT EXISTS "meta_ad_insights_tenantId_date_idx"
ON "meta_ad_insights"("tenantId", "date");

CREATE INDEX IF NOT EXISTS "meta_ad_insights_tenantId_accountId_date_idx"
ON "meta_ad_insights"("tenantId", "accountId", "date");

CREATE INDEX IF NOT EXISTS "calls_tenantId_provider_startedAt_idx"
ON "calls"("tenantId", "provider", "startedAt");

CREATE INDEX IF NOT EXISTS "calls_tenantId_startedAt_idx"
ON "calls"("tenantId", "startedAt");

CREATE INDEX IF NOT EXISTS "notifications_tenantId_status_createdAt_idx"
ON "notifications"("tenantId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "customers_tenantId_createdAt_idx"
ON "customers"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "customers_tenantId_profileCourseId_idx"
ON "customers"("tenantId", "profileCourseId");

CREATE INDEX IF NOT EXISTS "customers_tenantId_profileTariffId_idx"
ON "customers"("tenantId", "profileTariffId");

CREATE INDEX IF NOT EXISTS "customers_tenantId_profileSubTariffId_idx"
ON "customers"("tenantId", "profileSubTariffId");

CREATE INDEX IF NOT EXISTS "incomes_tenantId_entryDate_idx"
ON "incomes"("tenantId", "entryDate");

CREATE INDEX IF NOT EXISTS "incomes_tenantId_lifecycleStatus_entryDate_idx"
ON "incomes"("tenantId", "lifecycleStatus", "entryDate");

CREATE INDEX IF NOT EXISTS "incomes_tenantId_type_lifecycleStatus_entryDate_idx"
ON "incomes"("tenantId", "type", "lifecycleStatus", "entryDate");

CREATE INDEX IF NOT EXISTS "incomes_tenantId_managerUserId_entryDate_idx"
ON "incomes"("tenantId", "managerUserId", "entryDate");

CREATE INDEX IF NOT EXISTS "incomes_tenantId_managerUserId_lifecycleStatus_entryDate_idx"
ON "incomes"("tenantId", "managerUserId", "lifecycleStatus", "entryDate");

CREATE INDEX IF NOT EXISTS "incomes_tenantId_courseId_tariffId_entryDate_idx"
ON "incomes"("tenantId", "courseId", "tariffId", "entryDate");

CREATE INDEX IF NOT EXISTS "incomes_tenantId_relatedDebtIncomeId_lifecycleStatus_idx"
ON "incomes"("tenantId", "relatedDebtIncomeId", "lifecycleStatus");
