-- Calls are attributed to a manager by "managerUserId" instead of by the manager's
-- Utel PBX extension (users."utelManagerExternalId", extensions 100-150). This
-- migration adds the column and backfills it; the extension column is dropped by a
-- later migration, so the backfill can still read it here.
--
-- Data change: sets calls."managerUserId" on existing rows (all providers). Nothing
-- else is modified. Rows that none of the three rules below can attribute keep NULL
-- and are not counted for any manager. Re-running is harmless (only NULLs are filled).

ALTER TABLE "calls" ADD COLUMN IF NOT EXISTS "managerUserId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_managerUserId_fkey') THEN
    ALTER TABLE "calls" ADD CONSTRAINT "calls_managerUserId_fkey"
      FOREIGN KEY ("managerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "calls_tenantId_managerUserId_startedAt_idx"
  ON "calls"("tenantId", "managerUserId", "startedAt");

-- 1. amoCRM imports store the mapped user at import time in metadata.manager_user_id.
UPDATE "calls" c
SET "managerUserId" = u."id"
FROM "users" u
WHERE c."managerUserId" IS NULL
  AND c."metadata" ? 'manager_user_id'
  AND u."id" = c."metadata"->>'manager_user_id'
  AND u."tenantId" = c."tenantId";

-- 2. amoCRM imports made before the manager was mapped carry only metadata.amocrm_user_id:
--    use the user now mapped to that amoCRM user, when exactly one user in the tenant is.
WITH amo_owner AS (
  SELECT "tenantId", btrim("amocrmResponsibleUserId") AS amo_id, min("id") AS user_id
  FROM "users"
  WHERE btrim(coalesce("amocrmResponsibleUserId", '')) <> ''
  GROUP BY 1, 2
  HAVING count(*) = 1
)
UPDATE "calls" c
SET "managerUserId" = o.user_id
FROM amo_owner o
WHERE c."managerUserId" IS NULL
  AND o."tenantId" = c."tenantId"
  AND o.amo_id = btrim(c."metadata"->>'amocrm_user_id');

-- 3. Everything else (Utel webhook rows, and amoCRM rows the rules above missed): the old
--    extension rule. The call's extension is the first of metadata
--    normalized_extension/extension/ext/internal/line, then the manager-side party for the
--    direction (outbound: from, inbound: to), then from, then to; only digits, and only
--    100-150 counts. It is matched to the user whose utelManagerExternalId has the same
--    digits in the same tenant (active users first, then the oldest).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'utelManagerExternalId'
  ) THEN
    WITH parts AS (
      SELECT
        c."id",
        c."tenantId",
        lower(coalesce(c."direction", '')) AS dir,
        regexp_replace(coalesce(
          nullif(c."metadata"->>'normalized_extension', ''),
          nullif(c."metadata"->>'extension', ''),
          nullif(c."metadata"->>'ext', ''),
          nullif(c."metadata"->>'internal', ''),
          nullif(c."metadata"->>'line', ''),
          ''), '\D', '', 'g') AS m,
        regexp_replace(coalesce(c."from", ''), '\D', '', 'g') AS f,
        regexp_replace(coalesce(c."to", ''), '\D', '', 'g') AS t
      FROM "calls" c
      WHERE c."managerUserId" IS NULL
    ),
    valid AS (
      SELECT
        "id", "tenantId", dir,
        CASE WHEN m ~ '^[0-9]{1,9}$' AND m::int BETWEEN 100 AND 150 THEN m END AS m,
        CASE WHEN f ~ '^[0-9]{1,9}$' AND f::int BETWEEN 100 AND 150 THEN f END AS f,
        CASE WHEN t ~ '^[0-9]{1,9}$' AND t::int BETWEEN 100 AND 150 THEN t END AS t
      FROM parts
    ),
    call_ext AS (
      SELECT "id", "tenantId",
        coalesce(
          m,
          CASE WHEN dir = 'outbound' THEN coalesce(f, t) WHEN dir = 'inbound' THEN coalesce(t, f) END,
          f,
          t
        ) AS ext
      FROM valid
    ),
    ext_owner AS (
      SELECT DISTINCT ON ("tenantId", ext) "tenantId", ext, "id" AS user_id
      FROM (
        SELECT "tenantId", "id", "isActive", "createdAt",
          regexp_replace("utelManagerExternalId", '\D', '', 'g') AS ext
        FROM "users"
        WHERE "utelManagerExternalId" IS NOT NULL
      ) u
      WHERE ext ~ '^[0-9]{1,9}$' AND ext::int BETWEEN 100 AND 150
      ORDER BY "tenantId", ext, "isActive" DESC, "createdAt" ASC, "id" ASC
    )
    UPDATE "calls" c
    SET "managerUserId" = o.user_id
    FROM call_ext e
    JOIN ext_owner o ON o."tenantId" = e."tenantId" AND o.ext = e.ext
    WHERE c."id" = e."id";
  END IF;
END $$;
