-- Enable RLS policies for customer-income domain tables.

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tariffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incomes" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_isolation_policy ON "customers";
CREATE POLICY customers_isolation_policy ON "customers"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());

DROP POLICY IF EXISTS courses_isolation_policy ON "courses";
CREATE POLICY courses_isolation_policy ON "courses"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());

DROP POLICY IF EXISTS tariffs_isolation_policy ON "tariffs";
CREATE POLICY tariffs_isolation_policy ON "tariffs"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());

DROP POLICY IF EXISTS incomes_isolation_policy ON "incomes";
CREATE POLICY incomes_isolation_policy ON "incomes"
  FOR ALL USING ("tenantId"::uuid = app.current_tenant_id());
