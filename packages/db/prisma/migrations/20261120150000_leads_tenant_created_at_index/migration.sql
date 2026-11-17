-- Index leads ("tenantId", "createdAt") for per-tenant lists and counts by creation date.
-- Built CONCURRENTLY, so writes to leads are not blocked while it builds. Keep this file a single statement:
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block. If the build is interrupted it can leave an
-- INVALID index behind; drop it (DROP INDEX CONCURRENTLY "leads_tenantId_createdAt_idx") and deploy again.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_tenantId_createdAt_idx" ON "leads"("tenantId", "createdAt");
