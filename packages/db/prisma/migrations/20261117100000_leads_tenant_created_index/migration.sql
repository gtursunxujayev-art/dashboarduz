-- The amoCRM lead snapshot is read per tenant by created date (dashboard ranges).
CREATE INDEX IF NOT EXISTS "leads_tenantId_externalCreatedAt_idx" ON "leads"("tenantId", "externalCreatedAt");
