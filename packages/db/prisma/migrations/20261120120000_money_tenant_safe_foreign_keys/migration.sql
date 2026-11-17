-- Tenant-safe references for the money tables: a child row can only point at a parent row of the SAME tenant.
--
-- Each parent gets a unique key ("tenantId", id) and each listed child -> parent foreign key is replaced by a
-- composite one on ("tenantId", <parent id>). Same ON DELETE behaviour as before. Covered:
--   incomes(customerId -> customers, managerUserId -> users)
--   income_adjustment_requests(incomeId -> incomes, customerId -> customers, requestedByUserId -> users)
--   bonus_snapshot_lines / bonus_snapshot_items / bonus_adjustments(snapshotId -> bonus_month_snapshots)
--   bonus_adjustment_audits / bonus_adjustment_applications(adjustmentId -> bonus_adjustments)
-- Optional references with ON DELETE SET NULL (incomes.relatedDebtIncomeId, courseId, tariffId, the course /
-- tariff / reviewer columns of income_adjustment_requests, bonus_month_snapshots.policyVersionId) stay
-- single-column: a composite SET NULL would also null "tenantId", and Prisma cannot express SET NULL on a subset
-- of the key columns.
--
-- No data change. Fails (and rolls back entirely) if an existing row points at a parent of another tenant; find
-- such rows with e.g.
--   SELECT i.id FROM incomes i JOIN customers c ON c.id = i."customerId" WHERE c."tenantId" <> i."tenantId";
--
-- Locks: each CREATE UNIQUE INDEX holds a SHARE lock on its table while it builds (writes to customers, users,
-- incomes, bonus_month_snapshots and bonus_adjustments wait; reads continue) - seconds at this data size. The
-- foreign keys are added NOT VALID (brief lock) and then validated, which scans the child table without blocking
-- writes. Old and new keys are swapped inside this one migration, so there is no unprotected window.

CREATE UNIQUE INDEX "customers_tenantId_id_key" ON "customers"("tenantId", "id");
CREATE UNIQUE INDEX "users_tenantId_id_key" ON "users"("tenantId", "id");
CREATE UNIQUE INDEX "incomes_tenantId_id_key" ON "incomes"("tenantId", "id");
CREATE UNIQUE INDEX "bonus_month_snapshots_tenantId_id_key" ON "bonus_month_snapshots"("tenantId", "id");
CREATE UNIQUE INDEX "bonus_adjustments_tenantId_id_key" ON "bonus_adjustments"("tenantId", "id");

ALTER TABLE "incomes" DROP CONSTRAINT "incomes_customerId_fkey";
ALTER TABLE "incomes" DROP CONSTRAINT "incomes_managerUserId_fkey";
ALTER TABLE "income_adjustment_requests" DROP CONSTRAINT "income_adjustment_requests_incomeId_fkey";
ALTER TABLE "income_adjustment_requests" DROP CONSTRAINT "income_adjustment_requests_customerId_fkey";
ALTER TABLE "income_adjustment_requests" DROP CONSTRAINT "income_adjustment_requests_requestedByUserId_fkey";
ALTER TABLE "bonus_snapshot_lines" DROP CONSTRAINT "bonus_snapshot_lines_snapshotId_fkey";
ALTER TABLE "bonus_snapshot_items" DROP CONSTRAINT "bonus_snapshot_items_snapshotId_fkey";
ALTER TABLE "bonus_adjustments" DROP CONSTRAINT "bonus_adjustments_snapshotId_fkey";
ALTER TABLE "bonus_adjustment_audits" DROP CONSTRAINT "bonus_adjustment_audits_adjustmentId_fkey";
ALTER TABLE "bonus_adjustment_applications" DROP CONSTRAINT "bonus_adjustment_applications_adjustmentId_fkey";

ALTER TABLE "incomes" ADD CONSTRAINT "incomes_tenantId_customerId_fkey"
  FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_tenantId_managerUserId_fkey"
  FOREIGN KEY ("tenantId", "managerUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "income_adjustment_requests" ADD CONSTRAINT "income_adjustment_requests_tenantId_incomeId_fkey"
  FOREIGN KEY ("tenantId", "incomeId") REFERENCES "incomes"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "income_adjustment_requests" ADD CONSTRAINT "income_adjustment_requests_tenantId_customerId_fkey"
  FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "income_adjustment_requests" ADD CONSTRAINT "income_adjustment_requests_tenantId_requestedByUserId_fkey"
  FOREIGN KEY ("tenantId", "requestedByUserId") REFERENCES "users"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "bonus_snapshot_lines" ADD CONSTRAINT "bonus_snapshot_lines_tenantId_snapshotId_fkey"
  FOREIGN KEY ("tenantId", "snapshotId") REFERENCES "bonus_month_snapshots"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "bonus_snapshot_items" ADD CONSTRAINT "bonus_snapshot_items_tenantId_snapshotId_fkey"
  FOREIGN KEY ("tenantId", "snapshotId") REFERENCES "bonus_month_snapshots"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "bonus_adjustments" ADD CONSTRAINT "bonus_adjustments_tenantId_snapshotId_fkey"
  FOREIGN KEY ("tenantId", "snapshotId") REFERENCES "bonus_month_snapshots"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "bonus_adjustment_audits" ADD CONSTRAINT "bonus_adjustment_audits_tenantId_adjustmentId_fkey"
  FOREIGN KEY ("tenantId", "adjustmentId") REFERENCES "bonus_adjustments"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "bonus_adjustment_applications" ADD CONSTRAINT "bonus_adjustment_applications_tenantId_adjustmentId_fkey"
  FOREIGN KEY ("tenantId", "adjustmentId") REFERENCES "bonus_adjustments"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

ALTER TABLE "incomes" VALIDATE CONSTRAINT "incomes_tenantId_customerId_fkey";
ALTER TABLE "incomes" VALIDATE CONSTRAINT "incomes_tenantId_managerUserId_fkey";
ALTER TABLE "income_adjustment_requests" VALIDATE CONSTRAINT "income_adjustment_requests_tenantId_incomeId_fkey";
ALTER TABLE "income_adjustment_requests" VALIDATE CONSTRAINT "income_adjustment_requests_tenantId_customerId_fkey";
ALTER TABLE "income_adjustment_requests" VALIDATE CONSTRAINT "income_adjustment_requests_tenantId_requestedByUserId_fkey";
ALTER TABLE "bonus_snapshot_lines" VALIDATE CONSTRAINT "bonus_snapshot_lines_tenantId_snapshotId_fkey";
ALTER TABLE "bonus_snapshot_items" VALIDATE CONSTRAINT "bonus_snapshot_items_tenantId_snapshotId_fkey";
ALTER TABLE "bonus_adjustments" VALIDATE CONSTRAINT "bonus_adjustments_tenantId_snapshotId_fkey";
ALTER TABLE "bonus_adjustment_audits" VALIDATE CONSTRAINT "bonus_adjustment_audits_tenantId_adjustmentId_fkey";
ALTER TABLE "bonus_adjustment_applications" VALIDATE CONSTRAINT "bonus_adjustment_applications_tenantId_adjustmentId_fkey";
