-- =====================================================================
-- MANUAL, NOT AUTO-APPLIED: rolls back packages/db/scripts/rls-enforce.sql.
-- =====================================================================
-- First point DATABASE_URL (and DATABASE_SYSTEM_URL, or unset it) back at the
-- owner role and redeploy, then run as the owner:
--
--   psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/rls-enforce-rollback.sql
--
-- Turns FORCE off and removes the system policies. The roles and their grants
-- are kept (harmless while unused); drop them by hand if wanted:
--   DROP OWNED BY dashboarduz_app, dashboarduz_system;
--   DROP ROLE dashboarduz_app; DROP ROLE dashboarduz_system;
-- Tenant isolation policies stay in place; they do not apply to the owner.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
    ORDER BY c.relname
  LOOP
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_system_access', tbl);
  END LOOP;
END $$;

COMMIT;
