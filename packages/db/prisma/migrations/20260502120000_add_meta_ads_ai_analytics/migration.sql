CREATE TABLE IF NOT EXISTS "meta_ad_insights" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "accountId" TEXT NOT NULL,
  "campaignId" TEXT,
  "campaignName" TEXT,
  "adSetId" TEXT,
  "adSetName" TEXT,
  "adId" TEXT,
  "adName" TEXT,
  "impressions" INTEGER NOT NULL DEFAULT 0,
  "clicks" INTEGER NOT NULL DEFAULT 0,
  "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cpc" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "leads" INTEGER NOT NULL DEFAULT 0,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "meta_ad_insights_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "analytics_ai_reports" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "range" TEXT NOT NULL,
  "dateFrom" TIMESTAMP(3) NOT NULL,
  "dateTo" TIMESTAMP(3) NOT NULL,
  "focus" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL DEFAULT 'sales-intelligence-v1',
  "model" TEXT,
  "inputSummary" JSONB,
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "analytics_ai_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "meta_ad_insights_tenantId_date_accountId_campaignId_adSetId_adId_key"
  ON "meta_ad_insights"("tenantId", "date", "accountId", "campaignId", "adSetId", "adId");
CREATE INDEX IF NOT EXISTS "meta_ad_insights_tenantId_idx" ON "meta_ad_insights"("tenantId");
CREATE INDEX IF NOT EXISTS "meta_ad_insights_date_idx" ON "meta_ad_insights"("date");
CREATE INDEX IF NOT EXISTS "meta_ad_insights_accountId_idx" ON "meta_ad_insights"("accountId");
CREATE INDEX IF NOT EXISTS "meta_ad_insights_campaignId_idx" ON "meta_ad_insights"("campaignId");

CREATE INDEX IF NOT EXISTS "analytics_ai_reports_tenantId_idx" ON "analytics_ai_reports"("tenantId");
CREATE INDEX IF NOT EXISTS "analytics_ai_reports_userId_idx" ON "analytics_ai_reports"("userId");
CREATE INDEX IF NOT EXISTS "analytics_ai_reports_createdAt_idx" ON "analytics_ai_reports"("createdAt");
CREATE INDEX IF NOT EXISTS "analytics_ai_reports_dateFrom_dateTo_idx" ON "analytics_ai_reports"("dateFrom", "dateTo");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_ad_insights_tenantId_fkey'
  ) THEN
    ALTER TABLE "meta_ad_insights"
      ADD CONSTRAINT "meta_ad_insights_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'analytics_ai_reports_tenantId_fkey'
  ) THEN
    ALTER TABLE "analytics_ai_reports"
      ADD CONSTRAINT "analytics_ai_reports_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
