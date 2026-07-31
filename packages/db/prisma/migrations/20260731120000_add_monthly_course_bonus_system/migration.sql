CREATE TABLE "bonus_policy_versions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "effectiveMonth" TIMESTAMP(3) NOT NULL,
  "policy" JSONB NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bonus_policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bonus_month_snapshots" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "month" TIMESTAMP(3) NOT NULL,
  "policyVersionId" TEXT,
  "policy" JSONB NOT NULL,
  "sourceDigest" TEXT NOT NULL,
  "totalBonusAmount" INTEGER NOT NULL DEFAULT 0,
  "finalizedByUserId" TEXT NOT NULL,
  "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bonus_month_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bonus_snapshot_lines" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "groupKey" TEXT NOT NULL,
  "agentUserId" TEXT NOT NULL,
  "courseId" TEXT,
  "category" TEXT NOT NULL,
  "calculationMode" TEXT NOT NULL,
  "qualifyingAmount" INTEGER NOT NULL,
  "appliedPercent" DOUBLE PRECISION NOT NULL,
  "bonusAmount" INTEGER NOT NULL,
  "sourceCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bonus_snapshot_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bonus_snapshot_items" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceIncomeId" TEXT NOT NULL,
  "sourceSaleId" TEXT NOT NULL,
  "agentUserId" TEXT NOT NULL,
  "courseId" TEXT,
  "category" TEXT NOT NULL,
  "calculationMode" TEXT NOT NULL,
  "eventDate" TIMESTAMP(3) NOT NULL,
  "baseAmount" INTEGER NOT NULL,
  "appliedPercent" DOUBLE PRECISION NOT NULL,
  "bonusAmount" INTEGER NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bonus_snapshot_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bonus_adjustments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "groupKey" TEXT NOT NULL,
  "agentUserId" TEXT NOT NULL,
  "courseId" TEXT,
  "category" TEXT NOT NULL,
  "deltaAmount" INTEGER NOT NULL,
  "outstandingAmount" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "sourceDigest" TEXT NOT NULL,
  "payoutMonth" TIMESTAMP(3),
  "reviewedByUserId" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bonus_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bonus_adjustment_audits" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "adjustmentId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bonus_adjustment_audits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bonus_adjustment_applications" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "adjustmentId" TEXT NOT NULL,
  "payrollMonth" TIMESTAMP(3) NOT NULL,
  "amount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bonus_adjustment_applications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bonus_policy_versions_tenantId_effectiveMonth_key" ON "bonus_policy_versions"("tenantId", "effectiveMonth");
CREATE INDEX "bonus_policy_versions_tenantId_effectiveMonth_idx" ON "bonus_policy_versions"("tenantId", "effectiveMonth");
CREATE UNIQUE INDEX "bonus_month_snapshots_tenantId_month_key" ON "bonus_month_snapshots"("tenantId", "month");
CREATE INDEX "bonus_month_snapshots_tenantId_finalizedAt_idx" ON "bonus_month_snapshots"("tenantId", "finalizedAt");
CREATE UNIQUE INDEX "bonus_snapshot_lines_snapshotId_groupKey_key" ON "bonus_snapshot_lines"("snapshotId", "groupKey");
CREATE INDEX "bonus_snapshot_lines_tenantId_agentUserId_idx" ON "bonus_snapshot_lines"("tenantId", "agentUserId");
CREATE INDEX "bonus_snapshot_lines_tenantId_courseId_idx" ON "bonus_snapshot_lines"("tenantId", "courseId");
CREATE UNIQUE INDEX "bonus_snapshot_items_snapshotId_sourceKey_key" ON "bonus_snapshot_items"("snapshotId", "sourceKey");
CREATE INDEX "bonus_snapshot_items_tenantId_eventDate_idx" ON "bonus_snapshot_items"("tenantId", "eventDate");
CREATE INDEX "bonus_snapshot_items_tenantId_agentUserId_eventDate_idx" ON "bonus_snapshot_items"("tenantId", "agentUserId", "eventDate");
CREATE INDEX "bonus_snapshot_items_tenantId_courseId_eventDate_idx" ON "bonus_snapshot_items"("tenantId", "courseId", "eventDate");
CREATE INDEX "bonus_adjustments_tenantId_status_createdAt_idx" ON "bonus_adjustments"("tenantId", "status", "createdAt");
CREATE INDEX "bonus_adjustments_tenantId_agentUserId_payoutMonth_idx" ON "bonus_adjustments"("tenantId", "agentUserId", "payoutMonth");
CREATE INDEX "bonus_adjustments_snapshotId_groupKey_idx" ON "bonus_adjustments"("snapshotId", "groupKey");
CREATE INDEX "bonus_adjustment_audits_tenantId_createdAt_idx" ON "bonus_adjustment_audits"("tenantId", "createdAt");
CREATE INDEX "bonus_adjustment_audits_adjustmentId_createdAt_idx" ON "bonus_adjustment_audits"("adjustmentId", "createdAt");
CREATE UNIQUE INDEX "bonus_adjustment_applications_adjustmentId_payrollMonth_key" ON "bonus_adjustment_applications"("adjustmentId", "payrollMonth");
CREATE INDEX "bonus_adjustment_applications_tenantId_payrollMonth_idx" ON "bonus_adjustment_applications"("tenantId", "payrollMonth");

ALTER TABLE "bonus_policy_versions" ADD CONSTRAINT "bonus_policy_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bonus_month_snapshots" ADD CONSTRAINT "bonus_month_snapshots_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bonus_month_snapshots" ADD CONSTRAINT "bonus_month_snapshots_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "bonus_policy_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bonus_snapshot_lines" ADD CONSTRAINT "bonus_snapshot_lines_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "bonus_month_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bonus_snapshot_items" ADD CONSTRAINT "bonus_snapshot_items_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "bonus_month_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bonus_adjustments" ADD CONSTRAINT "bonus_adjustments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bonus_adjustments" ADD CONSTRAINT "bonus_adjustments_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "bonus_month_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bonus_adjustment_audits" ADD CONSTRAINT "bonus_adjustment_audits_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bonus_adjustment_audits" ADD CONSTRAINT "bonus_adjustment_audits_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "bonus_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bonus_adjustment_applications" ADD CONSTRAINT "bonus_adjustment_applications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bonus_adjustment_applications" ADD CONSTRAINT "bonus_adjustment_applications_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "bonus_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bonus_policy_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bonus_month_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bonus_snapshot_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bonus_snapshot_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bonus_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bonus_adjustment_audits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bonus_adjustment_applications" ENABLE ROW LEVEL SECURITY;

CREATE POLICY bonus_policy_versions_isolation_policy ON "bonus_policy_versions" FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());
CREATE POLICY bonus_month_snapshots_isolation_policy ON "bonus_month_snapshots" FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());
CREATE POLICY bonus_snapshot_lines_isolation_policy ON "bonus_snapshot_lines" FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());
CREATE POLICY bonus_snapshot_items_isolation_policy ON "bonus_snapshot_items" FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());
CREATE POLICY bonus_adjustments_isolation_policy ON "bonus_adjustments" FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());
CREATE POLICY bonus_adjustment_audits_isolation_policy ON "bonus_adjustment_audits" FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());
CREATE POLICY bonus_adjustment_applications_isolation_policy ON "bonus_adjustment_applications" FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());
