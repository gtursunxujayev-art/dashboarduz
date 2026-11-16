-- RLS policies for the tenant tables that had none (found by diffing the
-- @@map names in schema.prisma against CREATE POLICY statements in the
-- migrations; apps/api/src/__tests__/rls-policy-coverage.test.ts keeps it
-- that way).
--
-- Like the other policies these are not enforced while the application
-- connects as the table owner without FORCE ROW LEVEL SECURITY, so applying
-- this changes no behaviour. Catalog-only; no data change.

ALTER TABLE "meta_ad_insights" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meta_ad_insights_isolation_policy ON "meta_ad_insights";
CREATE POLICY meta_ad_insights_isolation_policy ON "meta_ad_insights"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "analytics_ai_reports" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analytics_ai_reports_isolation_policy ON "analytics_ai_reports";
CREATE POLICY analytics_ai_reports_isolation_policy ON "analytics_ai_reports"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "historical_import_sessions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS historical_import_sessions_isolation_policy ON "historical_import_sessions";
CREATE POLICY historical_import_sessions_isolation_policy ON "historical_import_sessions"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "corporate_call_durations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS corporate_call_durations_isolation_policy ON "corporate_call_durations";
CREATE POLICY corporate_call_durations_isolation_policy ON "corporate_call_durations"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "attendance_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_events_isolation_policy ON "attendance_events";
CREATE POLICY attendance_events_isolation_policy ON "attendance_events"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "attendance_day_summaries" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_day_summaries_isolation_policy ON "attendance_day_summaries";
CREATE POLICY attendance_day_summaries_isolation_policy ON "attendance_day_summaries"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "attendance_adjustments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_adjustments_isolation_policy ON "attendance_adjustments";
CREATE POLICY attendance_adjustments_isolation_policy ON "attendance_adjustments"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());

ALTER TABLE "attendance_adjustment_audits" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attendance_adjustment_audits_isolation_policy ON "attendance_adjustment_audits";
CREATE POLICY attendance_adjustment_audits_isolation_policy ON "attendance_adjustment_audits"
  FOR ALL
  USING ("tenantId"::uuid = app.current_tenant_id())
  WITH CHECK ("tenantId"::uuid = app.current_tenant_id());
