-- Bonus reconciliation safety.
--
-- 1. At most one PENDING bonus adjustment per (snapshotId, groupKey). Reconcile updates "the" pending adjustment of a
--    group; two concurrent reconciles could each create one, and a second pending row was never updated or deleted
--    again (it could be approved on top of the first). Existing duplicates are merged first: per group the most
--    recently updated pending row is kept, the audit history of the others is moved to it, and the others are
--    deleted (pending rows have no applications; the next reconcile recomputes the kept row's amount anyway).
--    The index is partial (WHERE status = 'pending'); approved and rejected history is unaffected.
-- 2. bonus_reconcile_requests: a durable "reconcile still owed" marker, written in the money transaction and deleted
--    after a successful reconcile; the worker's sweeper retries what is left. Tenant RLS like every tenant table.
--
-- Data change: deletes duplicate pending bonus_adjustments rows (only when duplicates exist; the count is reported
-- with RAISE NOTICE) after re-pointing their bonus_adjustment_audits rows. No other rows change.
--
-- Locks: the merge takes row locks on the duplicate rows; CREATE UNIQUE INDEX holds a SHARE lock on
-- bonus_adjustments while it builds (writes to that small table wait, reads continue). CREATE TABLE locks nothing
-- existing beyond a brief reference lock on tenants for the foreign key.

DO $$
DECLARE
  merged integer;
BEGIN
  WITH ranked AS (
    SELECT id,
           first_value(id) OVER (PARTITION BY "snapshotId", "groupKey" ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC) AS keep_id
    FROM bonus_adjustments
    WHERE status = 'pending'
  ), dupes AS (
    SELECT id, keep_id FROM ranked WHERE id <> keep_id
  ), moved AS (
    UPDATE bonus_adjustment_audits a SET "adjustmentId" = d.keep_id FROM dupes d WHERE a."adjustmentId" = d.id
    RETURNING a.id
  ), deleted AS (
    DELETE FROM bonus_adjustments b USING dupes d WHERE b.id = d.id
    RETURNING b.id
  )
  SELECT count(*) INTO merged FROM deleted;

  IF merged > 0 THEN
    RAISE NOTICE 'bonus_adjustments: merged % duplicate pending adjustment(s)', merged;
  END IF;
END $$;

CREATE UNIQUE INDEX "bonus_adjustments_pending_snapshotId_groupKey_key"
  ON "bonus_adjustments"("snapshotId", "groupKey") WHERE status = 'pending';

CREATE TABLE "bonus_reconcile_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bonus_reconcile_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bonus_reconcile_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "bonus_reconcile_requests_tenantId_createdAt_idx" ON "bonus_reconcile_requests"("tenantId", "createdAt");
CREATE INDEX "bonus_reconcile_requests_createdAt_idx" ON "bonus_reconcile_requests"("createdAt");

ALTER TABLE "bonus_reconcile_requests" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bonus_reconcile_requests_isolation_policy ON "bonus_reconcile_requests";
CREATE POLICY bonus_reconcile_requests_isolation_policy ON "bonus_reconcile_requests"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());
