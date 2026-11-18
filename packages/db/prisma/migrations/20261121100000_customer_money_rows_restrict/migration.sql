-- A customer with money rows can no longer be deleted: incomes.customerId and income_adjustment_requests.customerId
-- change from ON DELETE CASCADE to a refusing rule. Before, deleting a customer silently deleted every sale,
-- repayment and refund/tariff request of that customer. The API (customer.deleteCustomers) already skips such
-- customers; this makes the database refuse it too. income_adjustment_requests.incomeId keeps CASCADE (deleting a
-- sale is an explicit money action that removes its requests with it).
--
-- NO ACTION rather than RESTRICT: both refuse a delete that would orphan a row, but NO ACTION checks at the end of
-- the statement, so a delete that removes the customer's incomes in the same statement (a tenant cascade) still
-- works, and Postgres reports it as foreign_key_violation (23503), which Prisma surfaces as P2003; RESTRICT raises
-- 23001, which Prisma does not map.
--
-- No data change. Same composite (tenantId, customerId) keys as 20261120120000; only the ON DELETE rule changes.
--
-- Locks: DROP/ADD CONSTRAINT takes a brief SHARE ROW EXCLUSIVE lock on incomes / income_adjustment_requests and on
-- customers (writes wait for milliseconds). The new keys are added NOT VALID and then validated, which scans the
-- child table under SHARE UPDATE EXCLUSIVE (reads and writes continue). Old and new keys are swapped inside this one
-- migration's transaction, so there is no unprotected window.

ALTER TABLE "incomes" DROP CONSTRAINT "incomes_tenantId_customerId_fkey";
ALTER TABLE "income_adjustment_requests" DROP CONSTRAINT "income_adjustment_requests_tenantId_customerId_fkey";

ALTER TABLE "incomes" ADD CONSTRAINT "incomes_tenantId_customerId_fkey"
  FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "income_adjustment_requests" ADD CONSTRAINT "income_adjustment_requests_tenantId_customerId_fkey"
  FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;

ALTER TABLE "incomes" VALIDATE CONSTRAINT "incomes_tenantId_customerId_fkey";
ALTER TABLE "income_adjustment_requests" VALIDATE CONSTRAINT "income_adjustment_requests_tenantId_customerId_fkey";
