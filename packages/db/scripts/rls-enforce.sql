-- =====================================================================
-- MANUAL, NOT AUTO-APPLIED: turns Row Level Security enforcement on.
-- =====================================================================
-- This file is deliberately outside prisma/migrations. `prisma migrate deploy`
-- never runs it. Read packages/db/README.md ("Row Level Security rollout")
-- before running it, and run it as the role that owns the tables (the role
-- `prisma migrate deploy` uses), for example:
--
--   psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/scripts/rls-enforce.sql
--
-- What it does (idempotent, safe to re-run after new migrations):
--   1. Creates two LOGIN roles without passwords:
--        dashboarduz_app     - used by DATABASE_URL; subject to RLS
--        dashboarduz_system  - used by DATABASE_SYSTEM_URL; sees all tenants
--                              through an explicit per-table system policy
--      Set their passwords yourself afterwards (ALTER ROLE ... PASSWORD ...);
--      never commit passwords.
--   2. Grants both roles DML on the application tables (not on
--      _prisma_migrations) and the same defaults for tables created later by
--      the owner.
--   3. Adds a "<table>_system_access" policy for dashboarduz_system on every
--      table that has RLS enabled.
--   4. Turns FORCE ROW LEVEL SECURITY on for every table that has RLS enabled,
--      but only if the owner running this script bypasses RLS (superuser or
--      BYPASSRLS). Otherwise FORCE would make future data migrations run by
--      the owner silently see zero rows, so the script stops with an error
--      before touching anything. Non-owner roles are subject to RLS with or
--      without FORCE; FORCE additionally covers accidental owner connections.
--
-- Rollback: packages/db/scripts/rls-enforce-rollback.sql
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION
      'Role % does not bypass RLS. FORCE ROW LEVEL SECURITY would hide rows from migrations it runs. Grant it BYPASSRLS (or run as a superuser) first, or remove step 4 consciously.',
      current_user;
  END IF;
END $$;

-- 1. Roles ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboarduz_app') THEN
    CREATE ROLE dashboarduz_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboarduz_system') THEN
    CREATE ROLE dashboarduz_system LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- 2. Grants -----------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO dashboarduz_app, dashboarduz_system;
GRANT USAGE ON SCHEMA app TO dashboarduz_app, dashboarduz_system;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO dashboarduz_app, dashboarduz_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dashboarduz_app, dashboarduz_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dashboarduz_app, dashboarduz_system;
REVOKE ALL ON TABLE public."_prisma_migrations" FROM dashboarduz_app, dashboarduz_system;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dashboarduz_app, dashboarduz_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO dashboarduz_app, dashboarduz_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA app
  GRANT EXECUTE ON FUNCTIONS TO dashboarduz_app, dashboarduz_system;

-- 3 + 4. System policy and FORCE on every RLS-enabled table ----------------
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
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_system_access', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO dashboarduz_system USING (true) WITH CHECK (true)',
      tbl || '_system_access',
      tbl
    );
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- Tables in public without RLS (should be none besides _prisma_migrations).
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ')
  INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity
    AND c.relname <> '_prisma_migrations';
  IF missing IS NOT NULL THEN
    RAISE WARNING 'Tables without RLS (not protected): %', missing;
  END IF;
END $$;

COMMIT;
