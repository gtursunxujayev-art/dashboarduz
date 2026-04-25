CREATE TABLE IF NOT EXISTS "attendance_events" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "externalUserId" TEXT,
  "externalPhone" TEXT,
  "firstName" TEXT,
  "lastName" TEXT,
  "externalRole" TEXT,
  "eventType" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "localDate" TEXT NOT NULL,
  "localTime" TEXT,
  "source" TEXT NOT NULL DEFAULT 'FACE_ID',
  "branchName" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "lateMinutes" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT,
  "rawPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "attendance_day_summaries" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "summaryDate" TEXT NOT NULL,
  "workedSeconds" INTEGER NOT NULL DEFAULT 0,
  "requiredSeconds" INTEGER NOT NULL DEFAULT 32400,
  "missingSeconds" INTEGER NOT NULL DEFAULT 0,
  "lateMinutes" INTEGER NOT NULL DEFAULT 0,
  "lateCount" INTEGER NOT NULL DEFAULT 0,
  "absence" BOOLEAN NOT NULL DEFAULT false,
  "unmatchedInCount" INTEGER NOT NULL DEFAULT 0,
  "unmatchedOutCount" INTEGER NOT NULL DEFAULT 0,
  "anomalyCount" INTEGER NOT NULL DEFAULT 0,
  "firstInAt" TIMESTAMP(3),
  "lastOutAt" TIMESTAMP(3),
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "attendance_day_summaries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "attendance_adjustments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "eventId" TEXT,
  "summaryDate" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "attendance_adjustment_audits" (
  "id" TEXT NOT NULL,
  "adjustmentId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "attendance_adjustment_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_events_tenantId_idempotencyKey_key"
  ON "attendance_events"("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "attendance_events_tenantId_idx" ON "attendance_events"("tenantId");
CREATE INDEX IF NOT EXISTS "attendance_events_userId_idx" ON "attendance_events"("userId");
CREATE INDEX IF NOT EXISTS "attendance_events_localDate_idx" ON "attendance_events"("localDate");
CREATE INDEX IF NOT EXISTS "attendance_events_eventAt_idx" ON "attendance_events"("eventAt");
CREATE INDEX IF NOT EXISTS "attendance_events_eventType_action_idx" ON "attendance_events"("eventType", "action");

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_day_summaries_tenantId_userId_summaryDate_key"
  ON "attendance_day_summaries"("tenantId", "userId", "summaryDate");
CREATE INDEX IF NOT EXISTS "attendance_day_summaries_tenantId_idx" ON "attendance_day_summaries"("tenantId");
CREATE INDEX IF NOT EXISTS "attendance_day_summaries_userId_idx" ON "attendance_day_summaries"("userId");
CREATE INDEX IF NOT EXISTS "attendance_day_summaries_summaryDate_idx" ON "attendance_day_summaries"("summaryDate");
CREATE INDEX IF NOT EXISTS "attendance_day_summaries_tenantId_summaryDate_idx"
  ON "attendance_day_summaries"("tenantId", "summaryDate");

CREATE INDEX IF NOT EXISTS "attendance_adjustments_tenantId_idx" ON "attendance_adjustments"("tenantId");
CREATE INDEX IF NOT EXISTS "attendance_adjustments_userId_idx" ON "attendance_adjustments"("userId");
CREATE INDEX IF NOT EXISTS "attendance_adjustments_eventId_idx" ON "attendance_adjustments"("eventId");
CREATE INDEX IF NOT EXISTS "attendance_adjustments_summaryDate_idx" ON "attendance_adjustments"("summaryDate");
CREATE INDEX IF NOT EXISTS "attendance_adjustments_createdByUserId_idx" ON "attendance_adjustments"("createdByUserId");

CREATE INDEX IF NOT EXISTS "attendance_adjustment_audits_tenantId_idx" ON "attendance_adjustment_audits"("tenantId");
CREATE INDEX IF NOT EXISTS "attendance_adjustment_audits_adjustmentId_idx" ON "attendance_adjustment_audits"("adjustmentId");
CREATE INDEX IF NOT EXISTS "attendance_adjustment_audits_actorUserId_idx" ON "attendance_adjustment_audits"("actorUserId");
CREATE INDEX IF NOT EXISTS "attendance_adjustment_audits_createdAt_idx" ON "attendance_adjustment_audits"("createdAt");

ALTER TABLE "attendance_events"
  ADD CONSTRAINT "attendance_events_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_events"
  ADD CONSTRAINT "attendance_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_day_summaries"
  ADD CONSTRAINT "attendance_day_summaries_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_day_summaries"
  ADD CONSTRAINT "attendance_day_summaries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendance_adjustments"
  ADD CONSTRAINT "attendance_adjustments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_adjustments"
  ADD CONSTRAINT "attendance_adjustments_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_adjustments"
  ADD CONSTRAINT "attendance_adjustments_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "attendance_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance_adjustments"
  ADD CONSTRAINT "attendance_adjustments_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attendance_adjustment_audits"
  ADD CONSTRAINT "attendance_adjustment_audits_adjustmentId_fkey"
  FOREIGN KEY ("adjustmentId") REFERENCES "attendance_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_adjustment_audits"
  ADD CONSTRAINT "attendance_adjustment_audits_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_adjustment_audits"
  ADD CONSTRAINT "attendance_adjustment_audits_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
